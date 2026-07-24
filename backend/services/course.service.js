import { prisma } from "../database/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { StatusCodes } from "http-status-codes";
import { sendCourseBundleEmail } from "./email.service.js";
import { createNotificationsForUsers } from "./notification.service.js";

// Sends the course-bundle confirmation email + in-app notification to each
// given user for a compulsory course. Shared by every AUTO-registration path
// (bulk-import batch matching, new-workshop cascade, signup auto-match) —
// registerForEvent (manual registration) already sends its own via
// registration.service.js, so this is never called for that path to avoid
// double-emailing the same student.
export const notifyCourseBundleRegistration = async (userIds, courseId) => {
  if (!userIds?.length) return;
  const [course, modules, users] = await Promise.all([
    prisma.course.findUnique({ where: { id: courseId }, select: { name: true, code: true } }),
    prisma.courseModule.findMany({ where: { courseId }, orderBy: { order: "asc" }, select: { title: true } }),
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
  ]);
  if (!course || !users.length) return;

  const titles = modules.map((m) => m.title);
  users.forEach((user) => {
    sendCourseBundleEmail(user.email, user.name, course.name, course.code, titles).catch(() => {});
  });

  createNotificationsForUsers(
    users.map((u) => u.id),
    "info",
    `Registered: ${course.name}${course.code ? ` (${course.code})` : ""}`,
    `Successfully registered for Course Bundle "${course.name}". You are enrolled in all workshops.`,
    null
  ).catch(() => {});
};

export const getAllCourses = async (filters = {}) => {
  const { status } = filters;
  const where = {};
  if (status) where.status = status;

  return prisma.course.findMany({
    where,
    include: {
      modules: {
        where: { isActive: true },
        select: { id: true, title: true, description: true, order: true },
        orderBy: { order: "asc" },
      },
      _count: {
        select: { modules: true, events: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
};

// A COMPULSORY BUNDLE course (Course.isCompulsory) is all-or-nothing — a
// student registered into one of its workshops belongs in every workshop of
// the same course + batch, not just the one they happened to register for
// or get bulk-matched into. These two cascades keep that true from both
// directions: registering a student pulls in the bundle's other existing
// workshops, and scheduling a new workshop pulls in the bundle's existing
// students. batch is compared as-is (including null === null) so courses
// that don't use batches at all still cascade correctly.
export const cascadeBundleRegistrationForStudent = async (userId, eventId) => {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { courseId: true, batch: true, course: { select: { isCompulsory: true } } }
  });
  if (!event?.courseId || !event.course?.isCompulsory) return;

  const siblingEvents = await prisma.event.findMany({
    where: {
      courseId: event.courseId,
      batch: event.batch,
      status: { in: ["PUBLISHED", "COMPLETED"] },
      id: { not: eventId }
    },
    select: { id: true }
  });
  if (!siblingEvents.length) return;

  await prisma.eventRegistration.createMany({
    data: siblingEvents.map((e) => ({ eventId: e.id, userId, status: "REGISTERED" })),
    skipDuplicates: true
  });
};

export const cascadeBundleRegistrationForNewEvent = async (eventId) => {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { courseId: true, batch: true, course: { select: { isCompulsory: true } } }
  });
  if (!event?.courseId || !event.course?.isCompulsory) return;

  const siblingRegistrations = await prisma.eventRegistration.findMany({
    where: {
      event: { courseId: event.courseId, batch: event.batch, id: { not: eventId } }
    },
    select: { userId: true },
    distinct: ["userId"]
  });
  if (!siblingRegistrations.length) return;

  const userIds = siblingRegistrations.map((r) => r.userId);
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

  // No notifyCourseBundleRegistration call here, deliberately: every user in
  // newUserIds came from siblingRegistrations above, meaning they already
  // hold a registration for another event in this bundle and were already
  // sent the "enrolled in course bundle" email/notification when they first
  // joined. Re-notifying them here was firing that same email once per new
  // workshop added to an existing bundle (e.g. 3 emails for 3 workshops
  // scheduled one after another) instead of once per student.
};

export const getCourseById = async (courseId) => {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      modules: {
        where: { isActive: true },
        include: { _count: { select: { events: true } } },
        orderBy: { order: "asc" },
      },
      _count: { select: { modules: true, events: true } },
    },
  });

  if (!course) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Course not found");
  }
  return course;
};

export const createCourse = async (data) => {
  return prisma.course.create({
    data: {
      name: data.name,
      code: data.code || null,
      description: data.description ?? '',
      posterUrl: data.posterUrl || null,
      duration: data.duration || null,
      instructorName: data.instructorName || null,
      status: data.status || "ACTIVE",
      isCompulsory: data.isCompulsory === true || data.isCompulsory === "true",
      hasQuiz: data.hasQuiz === true || data.hasQuiz === "true",
      startDate: data.startDate ? new Date(data.startDate) : null,
      endDate: data.endDate ? new Date(data.endDate) : null,
      capacity: data.capacity,
      enrolledCount: 0,
    },
  });
};

export const updateCourse = async (courseId, data) => {
  const existing = await prisma.course.findUnique({ where: { id: courseId } });
  if (!existing) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Course not found");
  }

  const updateData = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.code !== undefined) updateData.code = data.code || null;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.posterUrl !== undefined) updateData.posterUrl = data.posterUrl;
  if (data.duration !== undefined) updateData.duration = data.duration;
  if (data.instructorName !== undefined) updateData.instructorName = data.instructorName;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.isCompulsory !== undefined) updateData.isCompulsory = data.isCompulsory === true || data.isCompulsory === "true";
  if (data.hasQuiz !== undefined) updateData.hasQuiz = data.hasQuiz === true || data.hasQuiz === "true";
  if (data.startDate !== undefined) updateData.startDate = data.startDate ? new Date(data.startDate) : null;
  if (data.endDate !== undefined) updateData.endDate = data.endDate ? new Date(data.endDate) : null;
  if (data.capacity !== undefined) updateData.capacity = data.capacity;

  return prisma.course.update({ where: { id: courseId }, data: updateData });
};

// Recompute Course.enrolledCount as the number of distinct users with an active
// (non-cancelled, non-no-show) registration across any of the course's events.
// Called after any enrollment flow touches this course's registrations, so the
// cached count self-heals rather than relying on scattered increment/decrement calls.
export const recalcCourseEnrolledCount = async (courseId) => {
  const events = await prisma.event.findMany({ where: { courseId }, select: { id: true } });
  const eventIds = events.map((e) => e.id);

  if (eventIds.length === 0) {
    await prisma.course.update({ where: { id: courseId }, data: { enrolledCount: 0 } });
    return 0;
  }

  const distinctEnrolled = await prisma.eventRegistration.groupBy({
    by: ["userId"],
    where: { eventId: { in: eventIds }, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
  });

  await prisma.course.update({ where: { id: courseId }, data: { enrolledCount: distinctEnrolled.length } });
  return distinctEnrolled.length;
};

const ENROLL_CHUNK_SIZE = 15;

export const bulkEnrollToCourse = async (courseId, userEmails) => {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      events: {
        where: { status: { in: ["PUBLISHED", "DRAFT"] } },
        select: { id: true, title: true, startAt: true },
        orderBy: { startAt: "asc" },
      },
    },
  });

  if (!course) throw new ApiError(StatusCodes.NOT_FOUND, "Course not found");

  const events = course.events;
  if (events.length === 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Course has no workshops to enroll into");
  }

  const eventIds = events.map((e) => e.id);
  const results = { enrolled: 0, skipped: 0, skippedCapacity: 0, errors: [] };

  // Resolve every user up front in a single query instead of one round-trip per email.
  const normalizedEmails = [...new Set(userEmails.map((email) => email.toLowerCase()))];
  const users = await prisma.user.findMany({ where: { email: { in: normalizedEmails } } });
  const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));

  for (const email of normalizedEmails) {
    if (!userByEmail.has(email)) {
      results.errors.push({ email, message: "User not found" });
    }
  }
  const foundUsers = normalizedEmails.map((email) => userByEmail.get(email)).filter(Boolean);

  // Enforce Course.capacity: cap the number of *distinct* students enrolled across
  // the course's workshops (not the raw registration count). Users already actively
  // enrolled don't consume additional capacity when re-processed (e.g. re-running a
  // bulk enroll that includes some already-enrolled emails).
  let remainingCapacity = Infinity;
  let alreadyEnrolledIds = new Set();
  if (course.capacity != null) {
    const distinctEnrolled = await prisma.eventRegistration.groupBy({
      by: ["userId"],
      where: { eventId: { in: eventIds }, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
    });
    alreadyEnrolledIds = new Set(distinctEnrolled.map((d) => d.userId));
    remainingCapacity = Math.max(course.capacity - distinctEnrolled.length, 0);
  }

  // Process users in reasonably sized parallel batches so we don't overwhelm the
  // Prisma connection pool while still avoiding N*M fully sequential round-trips.
  for (let i = 0; i < foundUsers.length; i += ENROLL_CHUNK_SIZE) {
    const chunk = foundUsers.slice(i, i + ENROLL_CHUNK_SIZE);

    await Promise.all(
      chunk.map(async (user) => {
        const countsAgainstCapacity = course.capacity != null && !alreadyEnrolledIds.has(user.id);

        if (countsAgainstCapacity) {
          if (remainingCapacity <= 0) {
            results.skippedCapacity += events.length;
            return;
          }
          remainingCapacity -= 1;
        }

        try {
          // One transaction per user: either all of their workshop registrations for
          // this course are written, or none are (atomic per-user enrollment).
          await prisma.$transaction(
            events.map((event) =>
              prisma.eventRegistration.upsert({
                where: { eventId_userId: { eventId: event.id, userId: user.id } },
                create: { eventId: event.id, userId: user.id, status: "REGISTERED" },
                // Re-enrolling a previously CANCELLED/NO_SHOW registration must actually
                // flip it back to an active status, not leave it untouched.
                update: { status: "REGISTERED" },
              })
            )
          );
          results.enrolled += events.length;
        } catch (err) {
          results.skipped += events.length;
          results.errors.push({ email: user.email, message: err.message });
        }
      })
    );
  }

  await recalcCourseEnrolledCount(courseId);

  return { courseId, courseName: course.name, workshopCount: events.length, ...results };
};

export const selfEnrollToCourse = async (courseId, userId) => {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      events: {
        where: { status: { in: ['PUBLISHED', 'DRAFT'] } },
        select: { id: true, title: true, startAt: true },
        orderBy: { startAt: 'asc' },
      },
    },
  });

  if (!course) throw new ApiError(StatusCodes.NOT_FOUND, 'Course not found');
  if (course.status !== 'ACTIVE') throw new ApiError(StatusCodes.BAD_REQUEST, 'Course is not currently active');
  if (course.isCompulsory) throw new ApiError(StatusCodes.BAD_REQUEST, 'Compulsory courses are assigned by admin only');

  const events = course.events;
  if (events.length === 0) throw new ApiError(StatusCodes.BAD_REQUEST, 'Course has no workshops to enroll into');

  const eventIds = events.map((e) => e.id);

  // Enforce Course.capacity: cap the number of distinct students enrolled across
  // the course's workshops. A student who is already actively enrolled (e.g. via a
  // prior partial enrollment) is allowed to re-run this without being blocked by
  // their own existing seat.
  if (course.capacity != null) {
    const distinctEnrolled = await prisma.eventRegistration.groupBy({
      by: ['userId'],
      where: {
        eventId: { in: eventIds },
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        userId: { not: userId },
      },
    });
    if (distinctEnrolled.length >= course.capacity) {
      throw new ApiError(StatusCodes.CONFLICT, 'Course capacity has been reached');
    }
  }

  let enrolled = 0, skipped = 0;
  try {
    // Single transaction: either every workshop registration for this course is
    // written, or none are (atomic enrollment for this student).
    await prisma.$transaction(
      events.map((event) =>
        prisma.eventRegistration.upsert({
          where: { eventId_userId: { eventId: event.id, userId } },
          create: { eventId: event.id, userId, status: 'REGISTERED' },
          // Re-enrolling a previously CANCELLED/NO_SHOW registration must flip it
          // back to an active status, not leave it untouched.
          update: { status: 'REGISTERED' },
        })
      )
    );
    enrolled = events.length;
  } catch {
    skipped = events.length;
  }

  await recalcCourseEnrolledCount(courseId);

  return { courseId, courseName: course.name, workshopCount: events.length, enrolled, skipped };
};

export const deleteCourse = async (courseId) => {
  const existing = await prisma.course.findUnique({ where: { id: courseId } });
  if (!existing) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Course not found");
  }
  await prisma.course.delete({ where: { id: courseId } });
  return { message: "Course deleted successfully" };
};

export const getCourseAnalytics = async (courseId) => {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      modules: {
        include: {
          _count: { select: { events: true } },
          events: {
            select: {
              id: true,
              title: true,
              startAt: true,
              status: true,
              batch: true,
              _count: { select: { registrations: true } },
            },
            orderBy: { startAt: "desc" },
          },
        },
        orderBy: { order: "asc" },
      },
      _count: { select: { modules: true, events: true } },
    },
  });

  if (!course) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Course not found");
  }

  const totalWorkshops = course._count.events;
  const moduleStats = course.modules.map((m) => ({
    moduleId: m.id,
    moduleTitle: m.title,
    usageCount: m._count.events,
    recentWorkshops: m.events.slice(0, 3),
  }));

  const mostUsed = [...moduleStats].sort((a, b) => b.usageCount - a.usageCount).slice(0, 5);

  return {
    courseId: course.id,
    courseName: course.name,
    totalModules: course._count.modules,
    totalWorkshops,
    moduleStats,
    mostUsedModules: mostUsed,
  };
};
