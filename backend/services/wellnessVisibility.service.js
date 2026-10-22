// Wellness Workshop sessions are no longer tied to batches (2026-10-17).
// A session of a Wellness module, whether a batch's event or a buffer session,
// is open to every Wellness student who hasn't completed that module
// (completed = sheet Present + app check-in + quiz >= 4 in one session, the
// same PP rule as the analytics grade; admin rule 2026-10-22, before that the
// check-in was ignored), as long as the session hasn't ended.
// Once a student registers in a session of a module, every other session of
// that module (same slot or later) stays hidden until that session's result
// is in: Present-and-passed closes the module, Absent or failed reopens it
// for sessions starting after it. A session the student is registered in
// always stays visible (the registrations rule). Other courses keep the
// batch-scoped rule.
import { prisma } from "../database/prisma.js";

export const WELLNESS_COURSE_NAME = "Wellness Workshop";

// Wellness students are the 26B batch, plus anyone already registered or
// batch-assigned in the course (a few other rolls were added by admin).
const WELLNESS_ROLL = /^26b/i;

let wellnessCourseIdCache;
export const getWellnessCourseId = async () => {
  if (wellnessCourseIdCache !== undefined) return wellnessCourseIdCache;
  const course = await prisma.course.findFirst({ where: { name: WELLNESS_COURSE_NAME }, select: { id: true } });
  wellnessCourseIdCache = course?.id ?? null;
  return wellnessCourseIdCache;
};

export const isWellnessCourseId = async (courseId) => {
  if (!courseId) return false;
  return courseId === (await getWellnessCourseId());
};

const isWellnessStudent = async (userId, courseId) => {
  const profile = await prisma.studentProfile.findUnique({ where: { userId }, select: { rollNumber: true } });
  if (profile && WELLNESS_ROLL.test(profile.rollNumber)) return true;
  const [reg, assignment] = await Promise.all([
    prisma.eventRegistration.findFirst({ where: { userId, event: { courseId } }, select: { id: true } }),
    prisma.batchAssignment.findFirst({ where: { courseId, matchedUserId: userId }, select: { id: true } }),
  ]);
  return Boolean(reg || assignment);
};

const WELLNESS_PASS_SCORE = 4;
const SCORE_MODULE_TITLE = "Quiz Score"; // quizScoreImport.service.js's uploaded-score module
const SCORE_MODULE_WHERE = { OR: [{ sourceQuizId: { not: null } }, { title: SCORE_MODULE_TITLE }] };

// Everything the Wellness rules need about one student, or null for a
// non-student / non-Wellness student.
//   completed: courseModuleIds with a sheet Present + check-in + quiz >= 4 in one session
//   awaiting:  courseModuleIds with a registered session whose result isn't in
//   lastEnd:   per courseModuleId, the latest end of a registered session
// A registered session's result is in when:
//   - the student's latest attendance there is ABSENT, or
//   - the sheet is in (someone is Present there) and they aren't, or
//   - they're Present and the quiz scores are in (a score module exists).
// Until then (session not held yet, sheet or quiz not uploaded) it's awaiting.
const getWellnessState = async (user) => {
  if (user?.role !== "STUDENT") return null;
  const courseId = await getWellnessCourseId();
  if (!courseId || !(await isWellnessStudent(user.id, courseId))) return null;
  const userId = user.id;

  const profile = await prisma.studentProfile.findUnique({ where: { userId }, select: { id: true } });
  const [modules, regs, records, scores, checkIns] = await Promise.all([
    prisma.courseModule.findMany({ where: { courseId }, select: { id: true } }),
    prisma.eventRegistration.findMany({
      where: { userId, status: { not: "CANCELLED" }, event: { courseId, courseModuleId: { not: null } } },
      select: {
        eventId: true,
        event: {
          select: {
            courseModuleId: true,
            endAt: true,
            modules: { where: SCORE_MODULE_WHERE, select: { id: true }, take: 1 },
          },
        },
      },
    }),
    prisma.attendanceRecord.findMany({
      where: { userId, event: { courseId } },
      select: { eventId: true, status: true, event: { select: { courseModuleId: true } } },
      orderBy: { markedAt: "asc" },
    }),
    profile
      ? prisma.moduleProgress.findMany({
          where: {
            studentProfileId: profile.id,
            marksObtained: { not: null },
            module: { event: { courseId }, ...SCORE_MODULE_WHERE },
          },
          select: { marksObtained: true, module: { select: { eventId: true, sourceQuizId: true } } },
        })
      : [],
    // Digital attendance, as in the analytics grade: a pending or verified check-in.
    prisma.eventCheckIn.findMany({
      where: { userId, status: { in: ["PENDING", "VERIFIED"] }, event: { courseId } },
      select: { eventId: true },
    }),
  ]);
  const checkedIn = new Set(checkIns.map((c) => c.eventId));

  const latest = new Map(); // eventId -> latest attendance status
  const moduleOfEvent = new Map();
  for (const r of records) {
    latest.set(r.eventId, r.status);
    moduleOfEvent.set(r.eventId, r.event.courseModuleId);
  }
  // In-built quiz wins over an uploaded score, as in the analytics.
  const scoreByEvent = new Map();
  for (const sc of scores) {
    const ev = sc.module.eventId;
    if (sc.module.sourceQuizId != null || !scoreByEvent.has(ev)) scoreByEvent.set(ev, sc.marksObtained);
  }

  const completed = new Set();
  for (const [ev, status] of latest) {
    const moduleId = moduleOfEvent.get(ev);
    if (moduleId && status === "PRESENT" && checkedIn.has(ev) && (scoreByEvent.get(ev) ?? -1) >= WELLNESS_PASS_SCORE) completed.add(moduleId);
  }

  // Registered sessions whose sheet is in (anyone Present there, with or
  // without an account).
  const regEventIds = regs.map((r) => r.eventId);
  const [sheetAccounts, sheetPending] = regEventIds.length
    ? await Promise.all([
        prisma.attendanceRecord.findMany({
          where: { eventId: { in: regEventIds }, status: "PRESENT" },
          select: { eventId: true },
          distinct: ["eventId"],
        }),
        prisma.pendingAttendance.findMany({
          where: { eventId: { in: regEventIds }, status: "PRESENT" },
          select: { eventId: true },
          distinct: ["eventId"],
        }),
      ])
    : [[], []];
  const sheetIn = new Set([...sheetAccounts, ...sheetPending].map((r) => r.eventId));

  const awaiting = new Set();
  const lastEnd = new Map();
  for (const { eventId, event } of regs) {
    const moduleId = event.courseModuleId;
    const prev = lastEnd.get(moduleId);
    if (!prev || event.endAt > prev) lastEnd.set(moduleId, event.endAt);
    const status = latest.get(eventId);
    const resultIn =
      status === "ABSENT" ||
      (status !== "PRESENT" && sheetIn.has(eventId)) ||
      (status === "PRESENT" && event.modules.length > 0);
    if (!resultIn) awaiting.add(moduleId);
  }

  return { courseId, moduleIds: modules.map((m) => m.id), completed, awaiting, lastEnd };
};

// Why a Wellness student may not register for a session, or null if they may:
// "completed", "awaiting" (a registered session of the module has no result
// yet), "closed" (session already ended, or starts before the end of one
// they were registered in), "notWellness" (a non-Wellness student).
export const getWellnessBlockReason = async (user, event) => {
  const state = await getWellnessState(user);
  if (!state) return "notWellness";
  const moduleId = event.courseModuleId;
  if (state.completed.has(moduleId)) return "completed";
  if (state.awaiting.has(moduleId)) return "awaiting";
  const end = state.lastEnd.get(moduleId);
  if (event.endAt <= new Date()) return "closed";
  if (end && event.startAt < end) return "closed";
  return null;
};

// Extra OR branch for a student's event-visibility filter, or null: every
// not-yet-ended session of each module that is neither completed nor awaiting
// a result, starting no earlier than the end of a session they were
// registered in.
export const getWellnessVisibilityCondition = async (user) => {
  const state = await getWellnessState(user);
  if (!state) return null;
  const branches = state.moduleIds
    .filter((id) => !state.completed.has(id) && !state.awaiting.has(id))
    .map((id) => {
      const end = state.lastEnd.get(id);
      return { courseModuleId: id, ...(end ? { startAt: { gte: end } } : {}) };
    });
  if (!branches.length) return null;
  return { courseId: state.courseId, endAt: { gt: new Date() }, OR: branches };
};
