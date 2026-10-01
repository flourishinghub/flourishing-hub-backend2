// Upload a topic-wise (Google-Form) quiz score sheet and land each student's
// score in the same ModuleProgress pipeline the admin analytics already reads
// for its Score column.
//
// It writes ModuleProgress on a dedicated score-holding EventModule per event
// (created on first use, no sourceQuizId). getWorkshopAnalyticsTable reads
// that module as the student's quizScore when no in-built quiz submission
// exists, so an uploaded score drives the Result column too.
//
// One sheet = one topic (workshopName), covering every batch. Columns:
//   - "Roll No"  (match key; case-insensitive)
//   - "Score"    ("9 / 10" or "9" — numerator is taken, denominator fixed 10)
//   - "Email Address" (fallback match when the roll finds no account)
//   - "Timestamp" (optional; repeat submissions -> the latest one wins)
// Any other column (e.g. a rating) is ignored. A signer with no account yet
// gets the score on their PendingAttendance row (quizScore) instead.
// The analytics Result column grades on this score when no in-built quiz
// submission exists (see getWorkshopAnalyticsTable's quizScoreMap).
import { StatusCodes } from "http-status-codes";

import { prisma } from "../database/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { parseWorkbookRows } from "../utils/excel.js";

const TOTAL_MARKS = 10; // every topic is out of 10
export const SCORE_MODULE_TITLE = "Quiz Score"; // sentinel EventModule that holds uploaded scores

const normalizeKey = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const getCell = (row, aliases) => {
  const wanted = new Set(aliases.map(normalizeKey));
  const hit = Object.entries(row).find(([k]) => wanted.has(normalizeKey(k)));
  return hit ? String(hit[1] ?? "").trim() : "";
};

// "9 / 10" -> 9 ; "9/10" -> 9 ; "9" -> 9 ; "" -> null
const parseScore = (raw) => {
  if (raw == null || String(raw).trim() === "") return null;
  const first = String(raw).split("/")[0].trim();
  const n = Number(first);
  if (Number.isNaN(n)) return null;
  return n;
};

export const importTopicQuizScores = async ({ courseId, topic, fileBuffer, fileName }) => {
  if (!courseId) throw new ApiError(StatusCodes.BAD_REQUEST, "courseId is required");
  if (!topic) throw new ApiError(StatusCodes.BAD_REQUEST, "topic is required");
  if (!fileBuffer) throw new ApiError(StatusCodes.BAD_REQUEST, "A .xlsx or .csv file is required");

  const rows = await parseWorkbookRows(fileBuffer, { fileName });
  if (!rows.length) throw new ApiError(StatusCodes.BAD_REQUEST, "The uploaded sheet has no data rows");

  // Every batch's event for this topic under this course.
  const events = await prisma.event.findMany({
    where: { courseId, title: topic },
    select: { id: true, batch: true, startAt: true, endAt: true },
  });
  if (!events.length) {
    throw new ApiError(StatusCodes.NOT_FOUND, `No events found for topic "${topic}" in this course`);
  }
  const eventIds = events.map((e) => e.id);
  const eventById = new Map(events.map((e) => [e.id, e]));

  // Non-cancelled registrations across those events -> which event each student sat in.
  const regs = await prisma.eventRegistration.findMany({
    where: { eventId: { in: eventIds }, status: { not: "CANCELLED" } },
    select: { eventId: true, userId: true },
  });
  const eventByUserId = new Map();
  for (const r of regs) {
    if (!eventByUserId.has(r.userId)) eventByUserId.set(r.userId, r.eventId);
  }

  // Resolve/create the sentinel score-module per event, lazily.
  const scoreModuleCache = new Map();
  const getScoreModuleId = async (eventId) => {
    if (scoreModuleCache.has(eventId)) return scoreModuleCache.get(eventId);
    let mod = await prisma.eventModule.findFirst({
      where: { eventId, title: SCORE_MODULE_TITLE },
      select: { id: true, maxMarks: true },
    });
    if (!mod) {
      const ev = eventById.get(eventId);
      mod = await prisma.eventModule.create({
        data: {
          eventId,
          title: SCORE_MODULE_TITLE,
          maxMarks: TOTAL_MARKS,
          startAt: ev?.startAt ?? new Date(),
          endAt: ev?.endAt ?? ev?.startAt ?? new Date(),
        },
        select: { id: true, maxMarks: true },
      });
    } else if (mod.maxMarks !== TOTAL_MARKS) {
      await prisma.eventModule.update({ where: { id: mod.id }, data: { maxMarks: TOTAL_MARKS } });
    }
    scoreModuleCache.set(eventId, mod.id);
    return mod.id;
  };

  // No-account sheet signers have no StudentProfile, so their score goes on
  // their PendingAttendance row for this topic instead.
  const pendingRows = await prisma.pendingAttendance.findMany({
    where: { eventId: { in: eventIds }, isMatched: false, status: "PRESENT" },
    select: { id: true, rollNumber: true, email: true },
  });
  const findPending = (roll, email) =>
    pendingRows.find((p) => roll && normalizeKey(p.rollNumber) === normalizeKey(roll)) ||
    pendingRows.find((p) => email && (p.email || "").toLowerCase() === email);

  // Every batch of the topic gets its score module up front, even one with no
  // matching student in this sheet: the module's existence is what tells the
  // analytics Result column that this topic's sheet has been uploaded (so a
  // missing score now means Absent rather than Pending).
  for (const e of events) await getScoreModuleId(e.id);

  const result = { totalRows: rows.length, updated: 0, created: 0, noAccount: 0, skipped: 0, skippedRows: [] };

  // Process in submission order so a student's latest response wins when they
  // submitted more than once (Google Forms exports are usually already in
  // order; this keeps it true for a re-sorted sheet too).
  const ordered = rows
    .map((row, i) => ({ row, rowNo: i + 2, at: Date.parse(getCell(row, ["Timestamp"])) }))
    .sort((a, b) => (Number.isNaN(a.at) || Number.isNaN(b.at) ? a.rowNo - b.rowNo : a.at - b.at || a.rowNo - b.rowNo));

  for (const { row, rowNo } of ordered) {
    const roll = getCell(row, ["Roll No", "rollNo", "roll_number", "rollNumber", "roll"]).replace(/\s+/g, "");
    const email = getCell(row, ["Email Address", "email", "userEmail", "Email"]).toLowerCase();
    const score = parseScore(getCell(row, ["Score", "marks", "quiz score", "quizScore"]));

    if (!roll && !email) {
      result.skipped += 1;
      result.skippedRows.push({ row: rowNo, roll: roll || "", reason: "no Roll No or Email in row" });
      continue;
    }
    if (score == null) {
      result.skipped += 1;
      result.skippedRows.push({ row: rowNo, roll: roll || email, reason: "Score is empty or not a number" });
      continue;
    }

    // Roll first, email only as a fallback: a typo'd email (someone else's
    // address) must not redirect the score when the roll is right, while a
    // mistyped roll still resolves through the email.
    const activeProfile = (where) =>
      prisma.studentProfile.findFirst({ where: { ...where, user: { ...where.user, isActive: true } }, select: { id: true, userId: true } });
    const profile =
      (roll && (await activeProfile({ rollNumber: { equals: roll, mode: "insensitive" } }))) ||
      (email && (await activeProfile({ user: { email } }))) ||
      null;
    if (!profile) {
      const pending = findPending(roll, email);
      if (pending) {
        await prisma.pendingAttendance.update({ where: { id: pending.id }, data: { quizScore: score } });
        result.noAccount += 1;
        continue;
      }
      result.skipped += 1;
      result.skippedRows.push({ row: rowNo, roll: roll || email, reason: "no student account matches this roll/email" });
      continue;
    }

    const eventId = eventByUserId.get(profile.userId);
    if (!eventId) {
      result.skipped += 1;
      result.skippedRows.push({ row: rowNo, roll: roll || email, reason: `student is not registered for topic "${topic}"` });
      continue;
    }

    const moduleId = await getScoreModuleId(eventId);
    const existing = await prisma.moduleProgress.findUnique({
      where: { studentProfileId_moduleId: { studentProfileId: profile.id, moduleId } },
      select: { id: true },
    });
    await prisma.moduleProgress.upsert({
      where: { studentProfileId_moduleId: { studentProfileId: profile.id, moduleId } },
      create: { studentProfileId: profile.id, moduleId, marksObtained: score, completedAt: new Date() },
      update: { marksObtained: score, completedAt: new Date() },
    });
    if (existing) result.updated += 1;
    else result.created += 1;
  }

  return result;
};
