// Upload a topic-wise (Google-Form) quiz score sheet and land each student's
// score in the same ModuleProgress pipeline the admin analytics already reads
// for its Score column.
//
// Standalone, additive file — it only writes ModuleProgress (+ creates a
// dedicated score-holding EventModule per event on first use). It does NOT
// set EventModule.sourceQuizId, so it never feeds the in-built-quiz
// `quizScore` field that drives the analytics Result column's Pass/Fail —
// that logic stays exactly as-is.
//
// One sheet = one topic (workshopName), covering every batch. Columns:
//   - "Roll No"  (match key; case-insensitive)
//   - "Score"    ("9 / 10" or "9" — numerator is taken, denominator fixed 10)
//   - "Email Address" (optional fallback match)
// Any other column (e.g. a rating) is ignored.
import { StatusCodes } from "http-status-codes";

import { prisma } from "../database/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { parseWorkbookRows } from "../utils/excel.js";

const TOTAL_MARKS = 10; // every topic is out of 10
const SCORE_MODULE_TITLE = "Quiz Score"; // sentinel EventModule that holds uploaded scores

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

  const result = { totalRows: rows.length, updated: 0, created: 0, skipped: 0, skippedRows: [] };

  for (let i = 0; i < rows.length; i += 1) {
    const rowNo = i + 2; // header is row 1
    const row = rows[i];
    const roll = getCell(row, ["Roll No", "rollNo", "roll_number", "rollNumber", "roll"]);
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

    const profile = await prisma.studentProfile.findFirst({
      where: {
        OR: [
          ...(roll ? [{ rollNumber: { equals: roll, mode: "insensitive" } }] : []),
          ...(email ? [{ user: { email } }] : []),
        ],
      },
      select: { id: true, userId: true },
    });
    if (!profile) {
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
