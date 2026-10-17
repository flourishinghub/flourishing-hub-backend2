// Wellness Workshop sessions are no longer tied to batches (2026-10-17).
// Every session of a Wellness module — any batch's event or a buffer session
// — is open to every Wellness student who is not yet Present in that module.
// Once they are Present in one session of the module, the module's other
// sessions disappear for them again (except ones they are registered in).
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

// courseModuleIds a student has a Present attendance for (latest record per
// event decides, so a Present later corrected to Absent doesn't count).
const getPresentModuleIds = async (userId, courseId) => {
  const records = await prisma.attendanceRecord.findMany({
    where: { userId, event: { courseId } },
    select: { eventId: true, status: true, event: { select: { courseModuleId: true } } },
    orderBy: { markedAt: "asc" },
  });
  const latest = new Map();
  for (const r of records) latest.set(r.eventId, r);
  const present = new Set();
  for (const r of latest.values()) {
    if (r.status === "PRESENT" && r.event.courseModuleId) present.add(r.event.courseModuleId);
  }
  return present;
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
