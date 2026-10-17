// Wellness Workshop sessions are no longer tied to batches (2026-10-17).
// Every session of a Wellness module — any batch's event or a buffer session
// — is open to every Wellness student who hasn't completed that module yet
// (completed = sheet Present + quiz >= 4 in one session; the check-in is not
// considered, admin rule 2026-10-17). Once they have completed it in one
// session of the module, its other sessions disappear for them again (except
// ones they are registered in).
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
const SCORE_MODULE_TITLE = "Quiz Score"; // quizScoreImport.service.js's uploaded-score module

// courseModuleIds the student has completed: in ONE session, a sheet Present
// (latest attendance record) + a quiz score >= 4. The check-in is left out
// for now (admin rule 2026-10-17). A sheet Absent, a failing score, or a
// score not uploaded yet keeps the module's sessions open.
const getPresentModuleIds = async (userId, courseId) => {
  const profile = await prisma.studentProfile.findUnique({ where: { userId }, select: { id: true } });
  const [records, scores] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: { userId, event: { courseId } },
      select: { eventId: true, status: true },
      orderBy: { markedAt: "asc" },
    }),
    profile
      ? prisma.moduleProgress.findMany({
          where: {
            studentProfileId: profile.id,
            marksObtained: { not: null },
            module: { event: { courseId }, OR: [{ sourceQuizId: { not: null } }, { title: SCORE_MODULE_TITLE }] },
          },
          select: { marksObtained: true, module: { select: { eventId: true, sourceQuizId: true } } },
        })
      : [],
  ]);
  const latest = new Map();
  for (const r of records) latest.set(r.eventId, r.status);
  // In-built quiz wins over an uploaded score, as in the analytics.
  const scoreByEvent = new Map();
  for (const s of scores) {
    const ev = s.module.eventId;
    if (s.module.sourceQuizId != null || !scoreByEvent.has(ev)) scoreByEvent.set(ev, s.marksObtained);
  }
  const ppEventIds = [...latest.entries()]
    .filter(([ev, status]) => status === "PRESENT" && (scoreByEvent.get(ev) ?? -1) >= WELLNESS_PASS_SCORE)
    .map(([ev]) => ev);
  if (!ppEventIds.length) return new Set();
  const events = await prisma.event.findMany({ where: { id: { in: ppEventIds } }, select: { courseModuleId: true } });
  return new Set(events.map((e) => e.courseModuleId).filter(Boolean));
};

// Wellness modules whose every session this student may see and register for.
// [] for a non-student or a non-Wellness student.
export const getOpenWellnessModuleIds = async (user) => {
  if (user?.role !== "STUDENT") return [];
  const courseId = await getWellnessCourseId();
  if (!courseId || !(await isWellnessStudent(user.id, courseId))) return [];
  const [modules, present] = await Promise.all([
    prisma.courseModule.findMany({ where: { courseId }, select: { id: true } }),
    getPresentModuleIds(user.id, courseId),
  ]);
  return modules.map((m) => m.id).filter((id) => !present.has(id));
};

// Extra OR branch for a student's event-visibility filter, or null.
export const getWellnessVisibilityCondition = async (user) => {
  const moduleIds = await getOpenWellnessModuleIds(user);
  if (!moduleIds.length) return null;
  return { courseId: await getWellnessCourseId(), courseModuleId: { in: moduleIds } };
};
