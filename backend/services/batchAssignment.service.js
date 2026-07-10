import { prisma } from "../database/prisma.js";
import { parseWorkbookRows, createWorkbookBuffer } from "../utils/excel.js";
import { ApiError } from "../utils/ApiError.js";
import { StatusCodes } from "http-status-codes";
import { notifyCourseBundleRegistration } from "./course.service.js";

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

const parseAndValidateRows = async (fileBuffer, fileName) => {
  const rows = await parseWorkbookRows(fileBuffer, { fileName });
  if (!rows.length) throw new ApiError(StatusCodes.BAD_REQUEST, "No data rows found in file");

  const errors = [];
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
      errors.push({ row: row.rowNumber, message: "batch_code is required" });
      continue;
    }
    if (!row.email && !row.rollNumber) {
      errors.push({ row: row.rowNumber, message: "email or roll_no is required" });
      continue;
    }
    validRows.push(row);
  }

  return { totalRows: rows.length, validRows, errors };
};

// Rows whose email/roll_no already has a BatchAssignment for this SAME course —
// i.e. this student was already uploaded under this course before. Scoped to
// courseId so the same student appearing in two different courses is normal,
// not a duplicate.
const findDuplicateRows = async (validRows, courseId) => {
  const emails = [...new Set(validRows.map((r) => r.email).filter(Boolean))];
  const rollNumbers = [...new Set(validRows.map((r) => r.rollNumber).filter(Boolean))];

  const existingAssignments = await prisma.batchAssignment.findMany({
    where: {
      courseId,
      OR: [
        ...(emails.length ? [{ email: { in: emails } }] : []),
        ...(rollNumbers.length ? [{ rollNumber: { in: rollNumbers } }] : [])
      ]
    }
  });

  const existingByEmail = new Set(existingAssignments.filter((a) => a.email).map((a) => a.email));
  const existingByRollNumber = new Set(existingAssignments.filter((a) => a.rollNumber).map((a) => a.rollNumber));

  return validRows.filter(
    (r) => (r.email && existingByEmail.has(r.email)) || (r.rollNumber && existingByRollNumber.has(r.rollNumber))
  );
};

// Registers one student into every COMPULSORY workshop of this exact
// course + batch. Scoped by BatchAssignment's (courseId, batchCode) instead
// of the student's free-text StudentProfile.cohort field, so a batch code
// that happens to repeat across two different courses can never cross-
// register a student into the wrong course's workshops.
const registerUserForCourseBatchEvents = async (userId, courseId, batchCode) => {
  if (!userId || !courseId || !batchCode) return;
  const events = await prisma.event.findMany({
    where: {
      courseId,
      batch: { equals: batchCode, mode: "insensitive" },
      registrationMode: "COMPULSORY"
    },
    select: { id: true }
  });
  if (!events.length) return;

  const existingCount = await prisma.eventRegistration.count({
    where: { userId, eventId: { in: events.map((e) => e.id) } }
  });

  await prisma.eventRegistration.createMany({
    data: events.map((e) => ({ eventId: e.id, userId, status: "REGISTERED" })),
    skipDuplicates: true
  });

  // Only email if this actually registered them into at least one new workshop
  // (existingCount < events.length) — avoids re-emailing a student who was
  // already fully registered for this batch's bundle.
  if (existingCount < events.length) {
    notifyCourseBundleRegistration([userId], courseId).catch(() => {});
  }
};

// Registers every already-matched student of this course + batch into one
// event. "Matched" means BatchAssignment.matchedUserId was set by an
// email/roll-number lookup (in uploadBatchAssignment or
// autoAssignCohortOnSignup below) — so this never falls back to comparing
// free-text batch/cohort strings across courses either.
export const registerCourseBatchForEvent = async (eventId, courseId, batchCode) => {
  if (!eventId || !courseId || !batchCode) return;
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { registrationMode: true } });
  if (event?.registrationMode !== "COMPULSORY") return;

  const assignments = await prisma.batchAssignment.findMany({
    where: {
      courseId,
      batchCode: { equals: batchCode, mode: "insensitive" },
      matchedUserId: { not: null }
    },
    select: { matchedUserId: true }
  });
  const userIds = [...new Set(assignments.map((a) => a.matchedUserId))];
  if (!userIds.length) return;

  const alreadyRegistered = new Set(
    (await prisma.eventRegistration.findMany({
      where: { eventId, userId: { in: userIds } },
      select: { userId: true }
    })).map((r) => r.userId)
  );
  const newUserIds = userIds.filter((id) => !alreadyRegistered.has(id));
  if (!newUserIds.length) return;

  await prisma.eventRegistration.createMany({
    data: newUserIds.map((userId) => ({ eventId, userId, status: "REGISTERED" })),
    skipDuplicates: true
  });

  notifyCourseBundleRegistration(newUserIds, courseId).catch(() => {});
};

// courseId is required — every batch upload now belongs to a course (selected
// from Course Management), not a bare batch code alone. resolutionMode is
// undefined on the first call: if duplicates (same student already uploaded
// for this course) are found, nothing is written and the duplicate list is
// returned for the admin to resolve via one of two choices —
// 'confirm' (upload everyone, duplicates get their record updated/overwritten)
// or 'skip-duplicates' (only the new, non-duplicate rows are uploaded).
export const uploadBatchAssignment = async ({ fileBuffer, fileName, courseId, resolutionMode }) => {
  if (!fileBuffer) throw new ApiError(StatusCodes.BAD_REQUEST, "File is required");
  if (!courseId) throw new ApiError(StatusCodes.BAD_REQUEST, "Course is required");

  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true, name: true } });
  if (!course) throw new ApiError(StatusCodes.NOT_FOUND, "Course not found");

  const { totalRows, validRows, errors } = await parseAndValidateRows(fileBuffer, fileName);

  if (validRows.length === 0) {
    return { total: totalRows, matched: 0, stored: 0, skipped: errors.length, errors };
  }

  const duplicateRows = await findDuplicateRows(validRows, courseId);

  if (!resolutionMode && duplicateRows.length > 0) {
    return {
      requiresResolution: true,
      courseId,
      courseName: course.name,
      totalRows,
      newCount: validRows.length - duplicateRows.length,
      duplicateCount: duplicateRows.length,
      duplicates: duplicateRows.map((r) => ({
        row: r.rowNumber,
        name: r.name,
        email: r.email,
        rollNumber: r.rollNumber,
        batchCode: r.batchCode,
      })),
    };
  }

  const rowsToProcess = resolutionMode === 'skip-duplicates'
    ? (() => {
        const duplicateRowNumbers = new Set(duplicateRows.map((d) => d.rowNumber));
        return validRows.filter((r) => !duplicateRowNumbers.has(r.rowNumber));
      })()
    : validRows;

  const results = { total: totalRows, matched: 0, stored: 0, skipped: errors.length, errors: [...errors] };

  // Fetch every user and existing BatchAssignment row (scoped to this course)
  // that could possibly match, in two bulk queries up front — instead of up
  // to 4 sequential DB round-trips per row.
  const emails = [...new Set(rowsToProcess.map((r) => r.email).filter(Boolean))];
  const rollNumbers = [...new Set(rowsToProcess.map((r) => r.rollNumber).filter(Boolean))];

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
        courseId,
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

  for (const row of rowsToProcess) {
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
                data: { email, rollNumber, batchCode, name, department, programme, yearOfStudy, section, courseId, isMatched: true, matchedUserId: existingUser.id }
              })
            : prisma.batchAssignment.create({
                data: { email, rollNumber, batchCode, name, department, programme, yearOfStudy, section, courseId, isMatched: true, matchedUserId: existingUser.id }
              })
        ]);
        savedAssignment = assignment;
        results.matched++;
        await registerUserForCourseBatchEvents(existingUser.id, courseId, batchCode);
      } else {
        // Student hasn't signed up yet — store for later
        savedAssignment = existingAssignment
          ? await prisma.batchAssignment.update({
              where: { id: existingAssignment.id },
              data: { email, rollNumber, batchCode, name, department, programme, yearOfStudy, section, courseId, isMatched: false, matchedUserId: null }
            })
          : await prisma.batchAssignment.create({
              data: { email, rollNumber, batchCode, name, department, programme, yearOfStudy, section, courseId, isMatched: false }
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

// Called from auth.service.js when student registers. A student can now be
// pending in more than one course's batch upload at once (courseId scoping),
// so this processes every pending assignment for them, not just the first —
// otherwise only one course's cohort/department would ever get applied and
// the rest would stay unmatched forever.
export const autoAssignCohortOnSignup = async (userId, email, rollNumber) => {
  try {
    const assignments = await prisma.batchAssignment.findMany({
      where: {
        isMatched: false,
        OR: [
          ...(email ? [{ email: email.toLowerCase() }] : []),
          ...(rollNumber ? [{ rollNumber }] : [])
        ]
      }
    });

    if (!assignments.length) return null;

    for (const assignment of assignments) {
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

      if (assignment.courseId) {
        await registerUserForCourseBatchEvents(userId, assignment.courseId, assignment.batchCode);
      }
    }

    return assignments[assignments.length - 1].batchCode;
  } catch {
    return null;
  }
};

export const getBatchAssignmentStats = async (courseId) => {
  const where = courseId ? { courseId } : {};

  const [total, matched, pending] = await Promise.all([
    prisma.batchAssignment.count({ where }),
    prisma.batchAssignment.count({ where: { ...where, isMatched: true } }),
    prisma.batchAssignment.count({ where: { ...where, isMatched: false } }),
  ]);

  const byBatch = await prisma.batchAssignment.groupBy({
    by: ['batchCode'],
    where,
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

export const listBatchAssignments = async ({ batchCode, isMatched, courseId } = {}) => {
  return prisma.batchAssignment.findMany({
    where: {
      ...(batchCode ? { batchCode } : {}),
      ...(isMatched !== undefined ? { isMatched } : {}),
      ...(courseId ? { courseId } : {}),
    },
    include: {
      course: { select: { id: true, name: true, code: true } }
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
