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

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const email = normLower(getCol(row, ['email', 'Email', 'EMAIL']));
      const rollNumber = norm(getCol(row, ['roll_no', 'rollno', 'roll_number', 'rollnumber', 'Roll No', 'Roll No.', 'Roll Number', 'RollNo', 'ROLL_NO', 'rollno.']));
      const batchCode = norm(getCol(row, ['batch_code', 'batchcode', 'batch', 'Batch', 'Batch Code', 'BATCH', 'BATCH_CODE']));
      const name = norm(getCol(row, ['name', 'Name', 'NAME', 'Student Name', 'student_name']));
      const department = norm(getCol(row, ['department', 'dept', 'Department', 'DEPT', 'Dept']));
      const programme = norm(getCol(row, ['programme', 'program', 'Programme', 'Program', 'PROGRAMME']));
      const yearOfStudy = normInt(getCol(row, ['year', 'year_of_study', 'yearofstudy', 'Year', 'Year of Study']));
      const section = norm(getCol(row, ['section', 'Section', 'SECTION']));

      if (!batchCode) {
        results.errors.push({ row: i + 2, message: "batch_code is required" });
        results.skipped++;
        continue;
      }
      if (!email && !rollNumber) {
        results.errors.push({ row: i + 2, message: "email or roll_no is required" });
        results.skipped++;
        continue;
      }

      // Find existing student by email OR roll number
      const existingUser = await prisma.user.findFirst({
        where: {
          OR: [
            ...(email ? [{ email }] : []),
            ...(rollNumber ? [{ studentProfile: { rollNumber } }] : [])
          ]
        },
        include: { studentProfile: true }
      });

      if (existingUser?.studentProfile) {
        // Student already signed up — update cohort directly
        await prisma.studentProfile.update({
          where: { id: existingUser.studentProfile.id },
          data: {
            cohort: batchCode,
            ...(department ? { department } : {}),
            ...(yearOfStudy !== null ? { yearOfStudy } : {}),
            ...(section !== null ? { section } : {}),
          }
        });

        // Also store in BatchAssignment table for reference
        const existing = await prisma.batchAssignment.findFirst({
          where: { OR: [...(email ? [{ email }] : []), ...(rollNumber ? [{ rollNumber }] : [])] }
        });
        if (existing) {
          await prisma.batchAssignment.update({
            where: { id: existing.id },
            data: { email, rollNumber, batchCode, name, department, programme, yearOfStudy, section, isMatched: true, matchedUserId: existingUser.id }
          });
        } else {
          await prisma.batchAssignment.create({
            data: { email, rollNumber, batchCode, name, department, programme, yearOfStudy, section, isMatched: true, matchedUserId: existingUser.id }
          });
        }
        results.matched++;
      } else {
        // Student hasn't signed up yet — store for later
        const existing = await prisma.batchAssignment.findFirst({
          where: { OR: [...(email ? [{ email }] : []), ...(rollNumber ? [{ rollNumber }] : [])] }
        });
        if (existing) {
          await prisma.batchAssignment.update({
            where: { id: existing.id },
            data: { email, rollNumber, batchCode, name, department, programme, yearOfStudy, section, isMatched: false, matchedUserId: null }
          });
        } else {
          await prisma.batchAssignment.create({
            data: { email, rollNumber, batchCode, name, department, programme, yearOfStudy, section, isMatched: false }
          });
        }
        results.stored++;
      }
    } catch (err) {
      results.errors.push({ row: i + 2, message: err.message });
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
