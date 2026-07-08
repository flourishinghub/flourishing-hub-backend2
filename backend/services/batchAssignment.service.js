import { prisma } from "../database/prisma.js";
import { parseWorkbookRows, createWorkbookBuffer } from "../utils/excel.js";
import { ApiError } from "../utils/ApiError.js";
import { StatusCodes } from "http-status-codes";

const norm = (v) => (v === undefined || v === null ? null : String(v).trim() || null);
const normLower = (v) => norm(v)?.toLowerCase() ?? null;
const normInt = (v) => { const n = parseInt(v); return isNaN(n) ? null : n; };

const normalizeKey = (k) => k.trim().toLowerCase().replace(/[\s._\-/]+/g, '');

const getCol = (row, keys) => {
  const normKeys = new Set(keys.map(normalizeKey));
  const found = Object.entries(row).find(([col]) => normKeys.has(normalizeKey(col)));
  if (found && found[1] !== undefined && found[1] !== null && String(found[1]).trim() !== '') return found[1];
  return null;
};

export const uploadBatchAssignment = async ({ fileBuffer, fileName }) => {
  if (!fileBuffer) throw new ApiError(StatusCodes.BAD_REQUEST, "File is required");

  const rows = await parseWorkbookRows(fileBuffer, { fileName });
  if (!rows.length) throw new ApiError(StatusCodes.BAD_REQUEST, "No data rows found in file");

  const results = { total: rows.length, matched: 0, stored: 0, skipped: 0, errors: [] };

  // Parse + validate every row first (no DB calls yet).
  const parsedRows = rows.map((row, i) => {
    const email = normLower(getCol(row, ['email', 'Email', 'EMAIL']));
    const rollNumber = norm(getCol(row, ['roll_no', 'rollno', 'roll_number', 'rollnumber', 'Roll No', 'Roll No.', 'Roll Number', 'RollNo', 'ROLL_NO', 'rollno.']));
    const batchCode = norm(getCol(row, ['batch_code', 'batchcode', 'batch', 'Batch', 'Batch Code', 'BATCH', 'BATCH_CODE']));
    const name = norm(getCol(row, ['name', 'Name', 'NAME', 'Student Name', 'student_name']));
    const department = norm(getCol(row, ['department', 'dept', 'Department', 'DEPT', 'Dept']));
    const programme = norm(getCol(row, ['programme', 'program', 'Programme', 'Program', 'PROGRAMME']));
    const yearOfStudy = normInt(getCol(row, ['year', 'year_of_study', 'yearofstudy', 'Year', 'Year of Study']));
    const section = norm(getCol(row, ['section', 'Section', 'SECTION']));

    return { rowNumber: i + 2, email, rollNumber, batchCode, name, department, programme, yearOfStudy, section };
  });

  const validRows = [];
  for (const row of parsedRows) {
    if (!row.batchCode) {
      results.errors.push({ row: row.rowNumber, message: "batch_code is required" });
      results.skipped++;
      continue;
    }
    if (!row.email && !row.rollNumber) {
      results.errors.push({ row: row.rowNumber, message: "email or roll_no is required" });
      results.skipped++;
      continue;
    }
    validRows.push(row);
  }

  if (validRows.length === 0) {
    return results;
  }

  // Fetch every user and existing BatchAssignment row that could possibly match, in
  // two bulk queries up front — instead of up to 4 sequential DB round-trips per row.
  const emails = [...new Set(validRows.map((r) => r.email).filter(Boolean))];
  const rollNumbers = [...new Set(validRows.map((r) => r.rollNumber).filter(Boolean))];

  const [existingUsers, existingAssignments] = await Promise.all([
    prisma.user.findMany({
      where: {
        OR: [
          ...(emails.length ? [{ email: { in: emails } }] : []),
          ...(rollNumbers.length ? [{ studentProfile: { rollNumber: { in: rollNumbers } } }] : [])
        ]
      },
      include: { studentProfile: true }
    }),
    prisma.batchAssignment.findMany({
      where: {
        OR: [
          ...(emails.length ? [{ email: { in: emails } }] : []),
          ...(rollNumbers.length ? [{ rollNumber: { in: rollNumbers } }] : [])
        ]
      }
    })
  ]);

  const userByEmail = new Map(existingUsers.filter((u) => u.email).map((u) => [u.email.toLowerCase(), u]));
  const userByRollNumber = new Map(
    existingUsers.filter((u) => u.studentProfile?.rollNumber).map((u) => [u.studentProfile.rollNumber, u])
  );
  const assignmentByEmail = new Map(existingAssignments.filter((a) => a.email).map((a) => [a.email, a]));
  const assignmentByRollNumber = new Map(existingAssignments.filter((a) => a.rollNumber).map((a) => [a.rollNumber, a]));

  for (const row of validRows) {
    const { rowNumber, email, rollNumber, batchCode, name, department, programme, yearOfStudy, section } = row;

    try {
      const existingUser = (email && userByEmail.get(email)) || (rollNumber && userByRollNumber.get(rollNumber)) || null;
      const existingAssignment = (email && assignmentByEmail.get(email)) || (rollNumber && assignmentByRollNumber.get(rollNumber)) || null;

      let savedAssignment;

      if (existingUser?.studentProfile) {
        // Student already signed up — update their profile and the BatchAssignment
        // reference row atomically (both writes succeed together, or neither does).
        const [, assignment] = await prisma.$transaction([
          prisma.studentProfile.update({
            where: { id: existingUser.studentProfile.id },
            data: {
              cohort: batchCode,
              ...(department ? { department } : {}),
              ...(yearOfStudy !== null ? { yearOfStudy } : {}),
              ...(section !== null ? { section } : {}),
            }
          }),
          existingAssignment
            ? prisma.batchAssignment.update({
                where: { id: existingAssignment.id },
                data: { email, rollNumber, batchCode, name, department, programme, yearOfStudy, section, isMatched: true, matchedUserId: existingUser.id }
              })
            : prisma.batchAssignment.create({
                data: { email, rollNumber, batchCode, name, department, programme, yearOfStudy, section, isMatched: true, matchedUserId: existingUser.id }
              })
        ]);
        savedAssignment = assignment;
        results.matched++;
      } else {
        // Student hasn't signed up yet — store for later
        savedAssignment = existingAssignment
          ? await prisma.batchAssignment.update({
              where: { id: existingAssignment.id },
              data: { email, rollNumber, batchCode, name, department, programme, yearOfStudy, section, isMatched: false, matchedUserId: null }
            })
          : await prisma.batchAssignment.create({
              data: { email, rollNumber, batchCode, name, department, programme, yearOfStudy, section, isMatched: false }
            });
        results.stored++;
      }

      // Keep the in-memory lookup fresh so duplicate email/roll_no rows later in the
      // same file update this record instead of racing to create a duplicate.
      if (email) assignmentByEmail.set(email, savedAssignment);
      if (rollNumber) assignmentByRollNumber.set(rollNumber, savedAssignment);
    } catch (err) {
      results.errors.push({ row: rowNumber, message: err.message });
      results.skipped++;
    }
  }

  return results;
};

// Called from auth.service.js when student registers
export const autoAssignCohortOnSignup = async (userId, email, rollNumber) => {
  try {
    const assignment = await prisma.batchAssignment.findFirst({
      where: {
        isMatched: false,
        OR: [
          ...(email ? [{ email: email.toLowerCase() }] : []),
          ...(rollNumber ? [{ rollNumber }] : [])
        ]
      }
    });

    if (!assignment) return null;

    await prisma.studentProfile.update({
      where: { userId },
      data: {
        cohort: assignment.batchCode,
        ...(assignment.department ? { department: assignment.department } : {}),
        ...(assignment.yearOfStudy !== null ? { yearOfStudy: assignment.yearOfStudy } : {}),
        ...(assignment.section !== null ? { section: assignment.section } : {}),
      }
    });

    await prisma.batchAssignment.update({
      where: { id: assignment.id },
      data: { isMatched: true, matchedUserId: userId }
    });

    return assignment.batchCode;
  } catch {
    return null;
  }
};

export const getBatchAssignmentStats = async () => {
  const [total, matched, pending] = await Promise.all([
    prisma.batchAssignment.count(),
    prisma.batchAssignment.count({ where: { isMatched: true } }),
    prisma.batchAssignment.count({ where: { isMatched: false } }),
  ]);

  const byBatch = await prisma.batchAssignment.groupBy({
    by: ['batchCode'],
    _count: { id: true },
    orderBy: { batchCode: 'asc' }
  });

  return {
    total,
    matched,
    pending,
    byBatch: byBatch.map(b => ({ batchCode: b.batchCode, count: b._count.id }))
  };
};

export const listBatchAssignments = async ({ batchCode, isMatched } = {}) => {
  return prisma.batchAssignment.findMany({
    where: {
      ...(batchCode ? { batchCode } : {}),
      ...(isMatched !== undefined ? { isMatched } : {}),
    },
    orderBy: [{ batchCode: 'asc' }, { name: 'asc' }],
  });
};

export const downloadBatchTemplate = async () => {
  return createWorkbookBuffer([{
    name: "Batch Assignment",
    rows: [
      { email: "student@iitb.ac.in", roll_no: "22B1234", batch_code: "d1t1", name: "Rahul Sharma", department: "CSE", programme: "BTECH", year: 2, section: "A" },
      { email: "student2@gmail.com", roll_no: "22B5678", batch_code: "d1t2", name: "Priya Singh", department: "EE", programme: "BTECH", year: 1, section: "B" },
      { email: "", roll_no: "22B9999", batch_code: "d1t1", name: "Amit Kumar", department: "ME", programme: "MTECH", year: 1, section: "" }
    ]
  }]);
};
