// Wellness Workshop sessions are no longer tied to batches (2026-10-17).
// Every session of a Wellness module, whether a batch's event or a Buffer, is
// open to every Wellness student who hasn't completed that module (completed =
// sheet Present + app check-in + quiz >= 4 in one session, the same PP rule as
// the analytics grade), until 45 minutes after the session ends. Since 2026-10-31
// (admin: "result aaye na aaye, sab open") nothing else matters: a booking in
// another session of the module, or a past session whose sheet/quiz isn't
// uploaded yet, no longer hides or blocks any session. (Before that a booked
// session awaiting its result hid the module's other sessions; Buffers and
// same-slot sessions had been exempted step by step on 22, 24 and 30 Oct.)
// Other courses keep the batch-scoped rule.
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
// A session stays open for registration this long after it ends, the same
// 45-minute grace the student event page keeps its Check-in button for
// (frontend isEventLiveOrGrace). On 31 Oct students who sat a 9:30 Buffer
// without registering found no way to register (and so check in) after 11:00.
const REGISTRATION_GRACE_MS = 45 * 60 * 1000;
const graceCutoff = () => new Date(Date.now() - REGISTRATION_GRACE_MS);
const SCORE_MODULE_TITLE = "Quiz Score"; // quizScoreImport.service.js's uploaded-score module
const SCORE_MODULE_WHERE = { OR: [{ sourceQuizId: { not: null } }, { title: SCORE_MODULE_TITLE }] };

// The modules a Wellness student can still take, or null for a non-student /
// non-Wellness student.
//   completed: courseModuleIds with a sheet Present + check-in + quiz >= 4 in one session
const getWellnessState = async (user) => {
  if (user?.role !== "STUDENT") return null;
  const courseId = await getWellnessCourseId();
  if (!courseId || !(await isWellnessStudent(user.id, courseId))) return null;
  const userId = user.id;

  const profile = await prisma.studentProfile.findUnique({ where: { userId }, select: { id: true } });
  const [modules, records, scores, checkIns] = await Promise.all([
    prisma.courseModule.findMany({ where: { courseId }, select: { id: true } }),
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

  return { courseId, moduleIds: modules.map((m) => m.id), completed };
};

// Why a Wellness student may not register for a session, or null if they may:
// "completed", "closed" (session ended more than 45 min ago), "notWellness" (a non-Wellness student).
export const getWellnessBlockReason = async (user, event) => {
  const state = await getWellnessState(user);
  if (!state) return "notWellness";
  if (state.completed.has(event.courseModuleId)) return "completed";
  if (event.endAt <= graceCutoff()) return "closed";
  return null;
};

// Extra OR branch for a student's event-visibility filter, or null: every
// session of each module they haven't completed that hasn't ended, or ended within the last 45 min.
export const getWellnessVisibilityCondition = async (user) => {
  const state = await getWellnessState(user);
  if (!state) return null;
  const open = state.moduleIds.filter((id) => !state.completed.has(id));
  if (!open.length) return null;
  return { courseId: state.courseId, endAt: { gt: graceCutoff() }, courseModuleId: { in: open } };
};
