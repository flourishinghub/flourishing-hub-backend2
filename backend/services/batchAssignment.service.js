import { prisma } from "../database/prisma.js";
import { parseWorkbookRows, createWorkbookBuffer } from "../utils/excel.js";
import { ApiError } from "../utils/ApiError.js";
import { StatusCodes } from "http-status-codes";
import { notifyCourseBundleRegistration } from "./course.service.js";

const norm = (v) => (v === undefined || v === null ? null : String(v).trim() || null);
const normLower = (v) => norm(v)?.toLowerCase() ?? null;
// Roll numbers are matched case-insensitively (students may type "22b1234"
// at signup while the admin's sheet has "22B1234"), so every roll number is
// upper-cased at the point it's read — both from the uploaded sheet and from
// existing DB rows — before any comparison or Map/Set lookup.
const normRoll = (v) => norm(v)?.toUpperCase() ?? null;
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
    const rollNumber = normRoll(getCol(row, ['roll_no', 'rollno', 'roll_number', 'rollnumber', 'Roll No', 'Roll No.', 'Roll Number', 'RollNo', 'ROLL_NO', 'rollno.']));
    const batchCode = norm(getCol(row, ['batch_code', 'batchcode', 'batch', 'Batch', 'Batch Code', 'BATCH', 'BATCH_CODE']));
    const name = norm(getCol(row, ['name', 'Name', 'NAME', 'Student Name', 'student_name']));
    const department = norm(getCol(row, ['department', 'dept', 'Department', 'DEPT', 'Dept']));
    const programme = norm(getCol(row, ['programme', 'program', 'Programme', 'Program', 'PROGRAMME']));
    const yearOfStudy = normInt(getCol(row, ['year', 'year_of_study', 'yearofstudy', 'Year', 'Year of Study']));
    const section = norm(getCol(row, ['section', 'Section', 'SECTION']));
    // Optional — only needed for a compulsory course where the same student
    // has a DIFFERENT batch per module (e.g. Module A batch M1B1, Module B
    // batch M2B3). Left blank, a row behaves exactly as before: one batch
    // for the whole course. Matched against the course's real modules by
    // title (case/spacing-insensitive) further down.
    const moduleTitle = norm(getCol(row, ['module', 'module_name', 'moduleName', 'Module', 'Module Name', 'workshop', 'workshop_name', 'workshopName', 'Workshop Name']));

    return { rowNumber: i + 2, email, rollNumber, batchCode, name, department, programme, yearOfStudy, section, moduleTitle };
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

// Resolves each row's optional moduleTitle to a real CourseModule.id, so a
// student can have one BatchAssignment row per module (different batch per
// module) instead of a single row per course. Rows with no moduleTitle (the
// existing one-batch-for-the-whole-course case) get courseModuleId: null,
// unchanged from before.
const resolveModuleIds = async (validRows, courseId) => {
  if (!validRows.some((r) => r.moduleTitle)) {
    return validRows.map((r) => ({ ...r, courseModuleId: null }));
  }
  const modules = await prisma.courseModule.findMany({ where: { courseId }, select: { id: true, title: true } });
  const moduleByTitle = new Map(modules.map((m) => [normalizeKey(m.title), m.id]));
  return validRows.map((r) => ({
    ...r,
    courseModuleId: r.moduleTitle ? moduleByTitle.get(normalizeKey(r.moduleTitle)) ?? null : null
  }));
};

// Rows whose email/roll_no already has a BatchAssignment for this SAME
// course AND module — i.e. this student was already uploaded for this exact
// module before. Scoped to (courseId, courseModuleId) so the same student
// appearing again for a DIFFERENT module of the same course (their batch
// for Module B, having already been uploaded for Module A) is normal, not a
// duplicate — and courseId alone still separates two unrelated courses.
const findDuplicateRows = async (validRows, courseId) => {
  const emails = [...new Set(validRows.map((r) => r.email).filter(Boolean))];
  const rollNumbers = [...new Set(validRows.map((r) => r.rollNumber).filter(Boolean))];

  const existingAssignments = await prisma.batchAssignment.findMany({
    where: {
      courseId,
      OR: [
        ...(emails.length ? [{ email: { in: emails } }] : []),
        ...rollNumbers.map((r) => ({ rollNumber: { equals: r, mode: "insensitive" } }))
      ]
    }
  });

  const key = (email, rollNumber, courseModuleId) => `${courseModuleId || ''}::${email || rollNumber?.toUpperCase() || ''}`;
  const existingKeys = new Set(
    existingAssignments
      .filter((a) => a.email || a.rollNumber)
      .map((a) => key(a.email, a.rollNumber, a.courseModuleId))
  );

  return validRows.filter((r) => existingKeys.has(key(r.email, r.rollNumber, r.courseModuleId)));
};

// findDuplicateRows only catches a row colliding with something already in
// the database — it says nothing about the SAME student appearing twice
// within this one file for the same module (e.g. accidentally listed in
// both the 11am and 2:30pm batch of the same module). Nothing else in the
// upload path checks for that: the per-row loop below builds up its
// in-memory assignment map as it goes, so the second occurrence just
// updates the row the first occurrence created — batchCode silently ends
// up whichever one was LAST in the file, with no error, no warning, and no
// record of the earlier batch ever existing. Surfaced here as its own
// duplicate list (second-and-later occurrence of each repeated
// courseModuleId+student key) so it goes through the same admin-resolution
// screen instead of resolving itself silently.
const findIntraFileDuplicateRows = (validRows) => {
  const key = (r) => `${r.courseModuleId || ''}::${(r.email || r.rollNumber?.toUpperCase() || '')}`;
  const seen = new Set();
  const dupes = [];
  for (const r of validRows) {
    const k = key(r);
    if (!k.replace(/^.*::/, '')) continue;
    if (seen.has(k)) {
      dupes.push(r);
    } else {
      seen.add(k);
    }
  }
  return dupes;
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

  // newUserIds above is scoped to "not yet registered for THIS event" —
  // that includes students who already belong to the bundle via another
  // workshop of the same course+batch. Notifying on that broader set was
  // re-sending the "enrolled in course bundle" email every time a new
  // workshop got added to a course students were already in. Narrow it down
  // to genuinely first-time bundle members (no prior registration in any
  // OTHER event of this course) before notifying.
  const priorBundleRegistrations = await prisma.eventRegistration.findMany({
    where: { userId: { in: newUserIds }, event: { courseId, id: { not: eventId } } },
    select: { userId: true },
    distinct: ["userId"]
  });
  const priorBundleUserIds = new Set(priorBundleRegistrations.map((r) => r.userId));
  const firstTimeUserIds = newUserIds.filter((id) => !priorBundleUserIds.has(id));

  if (firstTimeUserIds.length) {
    notifyCourseBundleRegistration(firstTimeUserIds, courseId).catch(() => {});
  }
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

  const { totalRows, validRows: parsedRows, errors } = await parseAndValidateRows(fileBuffer, fileName);

  if (parsedRows.length === 0) {
    return { total: totalRows, matched: 0, stored: 0, skipped: errors.length, errors };
  }

  const validRows = await resolveModuleIds(parsedRows, courseId);
  const dbDuplicateRows = await findDuplicateRows(validRows, courseId);
  const intraFileDuplicateRows = findIntraFileDuplicateRows(validRows);
  // A row can be flagged by both checks (e.g. re-uploading a file that
  // already has an internal repeat) — de-dupe by rowNumber before counting.
  const duplicateRows = [...new Map(
    [...dbDuplicateRows, ...intraFileDuplicateRows].map((r) => [r.rowNumber, r])
  ).values()];

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
        reason: intraFileDuplicateRows.includes(r) ? 'Duplicate within this same file (same student, same module, listed twice)' : 'Already exists from a previous upload',
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
          ...rollNumbers.map((r) => ({ studentProfile: { rollNumber: { equals: r, mode: "insensitive" } } }))
        ]
      },
      include: { studentProfile: true }
    }),
    prisma.batchAssignment.findMany({
      where: {
        courseId,
        OR: [
          ...(emails.length ? [{ email: { in: emails } }] : []),
          ...rollNumbers.map((r) => ({ rollNumber: { equals: r, mode: "insensitive" } }))
        ]
      }
    })
  ]);

  const userByEmail = new Map(existingUsers.filter((u) => u.email).map((u) => [u.email.toLowerCase(), u]));
  const userByRollNumber = new Map(
    existingUsers.filter((u) => u.studentProfile?.rollNumber).map((u) => [u.studentProfile.rollNumber.toUpperCase(), u])
  );
  // Keyed by (courseModuleId + email/roll) instead of just email/roll, so a
  // student who already has a row for Module A's batch and is now being
  // uploaded for Module B's batch gets a SECOND row (create) instead of the
  // Module A row being overwritten (update) — which is what was happening
  // before courseModuleId existed at all.
  const assignmentKey = (courseModuleId, email, rollNumber) => `${courseModuleId || ''}::${email || rollNumber || ''}`;
  const assignmentByKey = new Map(
    existingAssignments
      .filter((a) => a.email || a.rollNumber)
      .flatMap((a) => {
        const entries = [];
        if (a.email) entries.push([assignmentKey(a.courseModuleId, a.email, null), a]);
        if (a.rollNumber) entries.push([assignmentKey(a.courseModuleId, null, a.rollNumber.toUpperCase()), a]);
        return entries;
      })
  );

  for (const row of rowsToProcess) {
    const { rowNumber, email, rollNumber, batchCode, name, department, programme, yearOfStudy, section, courseModuleId } = row;

    try {
      const existingUser = (email && userByEmail.get(email)) || (rollNumber && userByRollNumber.get(rollNumber)) || null;
      const existingAssignment =
        (email && assignmentByKey.get(assignmentKey(courseModuleId, email, null))) ||
        (rollNumber && assignmentByKey.get(assignmentKey(courseModuleId, null, rollNumber))) ||
        null;

      let savedAssignment;

      // Also requires isVerified: an account that only exists because of an
      // incomplete signup (OTP never entered — often because the OTP email
      // itself never arrived) isn't "this student" yet as far as anyone can
      // prove. Matching to it immediately let that dead account permanently
      // claim the registration — the real account created once they signed
      // up properly (possibly with a corrected email) never got it. Leaving
      // this row unmatched means the FIRST account that actually verifies
      // with this email/roll number picks it up, whichever one that is.
      if (existingUser?.studentProfile && existingUser.isVerified) {
        // A re-upload correcting this student's batch for the SAME module
        // (e.g. M1B2 -> M1B5) previously just added the new registration —
        // nothing ever cancelled the one for the batch they're being moved
        // OUT of, leaving it behind to show up as a second, stale "your
        // session" alongside the corrected one.
        const previousBatchCode = existingAssignment?.batchCode;

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
                data: { email, rollNumber, batchCode, name, department, programme, yearOfStudy, section, courseId, courseModuleId, isMatched: true, matchedUserId: existingUser.id }
              })
            : prisma.batchAssignment.create({
                data: { email, rollNumber, batchCode, name, department, programme, yearOfStudy, section, courseId, courseModuleId, isMatched: true, matchedUserId: existingUser.id }
              })
        ]);
        savedAssignment = assignment;
        results.matched++;
        await registerUserForCourseBatchEvents(existingUser.id, courseId, batchCode);

        if (previousBatchCode && previousBatchCode !== batchCode) {
          await prisma.eventRegistration.updateMany({
            where: {
              userId: existingUser.id,
              status: { not: "CANCELLED" },
              event: { courseId, courseModuleId, batch: previousBatchCode }
            },
            data: { status: "CANCELLED" }
          });
        }
      } else {
        // Student hasn't signed up yet — store for later
        savedAssignment = existingAssignment
          ? await prisma.batchAssignment.update({
              where: { id: existingAssignment.id },
              data: { email, rollNumber, batchCode, name, department, programme, yearOfStudy, section, courseId, courseModuleId, isMatched: false, matchedUserId: null }
            })
          : await prisma.batchAssignment.create({
              data: { email, rollNumber, batchCode, name, department, programme, yearOfStudy, section, courseId, courseModuleId, isMatched: false }
            });
        results.stored++;
      }

      // Keep the in-memory lookup fresh so duplicate email/roll_no rows later in the
      // same file update this record instead of racing to create a duplicate.
      if (email) assignmentByKey.set(assignmentKey(courseModuleId, email, null), savedAssignment);
      if (rollNumber) assignmentByKey.set(assignmentKey(courseModuleId, null, rollNumber), savedAssignment);
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
          ...(rollNumber ? [{ rollNumber: { equals: rollNumber, mode: "insensitive" } }] : [])
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
      course: { select: { id: true, name: true, code: true } },
      courseModule: { select: { id: true, title: true } }
    },
    orderBy: [{ batchCode: 'asc' }, { name: 'asc' }],
  });
};

export const downloadBatchTemplate = async () => {
  return createWorkbookBuffer([{
    name: "Batch Assignment",
    rows: [
      { email: "student@iitb.ac.in", roll_no: "22B1234", batch_code: "d1t1", name: "Rahul Sharma", department: "CSE", programme: "BTECH", year: 2, section: "A", module: "" },
      { email: "student2@gmail.com", roll_no: "22B5678", batch_code: "d1t2", name: "Priya Singh", department: "EE", programme: "BTECH", year: 1, section: "B", module: "" },
      { email: "", roll_no: "22B9999", batch_code: "d1t1", name: "Amit Kumar", department: "ME", programme: "MTECH", year: 1, section: "", module: "" },
      // Same student, different batch per module — leave `module` blank
      // everywhere else; only fill it in when a course needs per-module
      // batches like this pair.
      { email: "student3@iitb.ac.in", roll_no: "22B4321", batch_code: "M1B1", name: "Sana Iyer", department: "CSE", programme: "BTECH", year: 2, section: "A", module: "Module A" },
      { email: "student3@iitb.ac.in", roll_no: "22B4321", batch_code: "M2B3", name: "Sana Iyer", department: "CSE", programme: "BTECH", year: 2, section: "A", module: "Module B" }
    ]
  }]);
};
