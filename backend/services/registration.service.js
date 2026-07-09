import { StatusCodes } from "http-status-codes";

import { prisma } from "../database/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { sendRegistrationConfirmationEmail, sendCourseBundleEmail } from "./email.service.js";
import { createNotification } from "./notification.service.js";
import { recalcCourseEnrolledCount, cascadeBundleRegistrationForStudent } from "./course.service.js";

// Statuses that no longer occupy a seat — cancelled/no-show registrations should
// free up capacity rather than counting against it.
const INACTIVE_REGISTRATION_STATUSES = ["CANCELLED", "NO_SHOW"];

export const registerForEvent = async ({ eventId, asVolunteer }, user) => {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      registrations: { where: { isVolunteer: true }, select: { id: true } },
      _count: {
        select: {
          registrations: { where: { status: { notIn: INACTIVE_REGISTRATION_STATUSES } } }
        }
      },
      course: { select: { id: true, name: true, code: true, isCompulsory: true } },
      courseModule: { select: { id: true, title: true } }
    }
  });

  if (!event || event.status !== "PUBLISHED") {
    throw new ApiError(StatusCodes.NOT_FOUND, "Event is not available for registration");
  }

  // Registration stays open until 15 minutes after the event starts, then closes.
  const REGISTRATION_GRACE_MS = 15 * 60 * 1000;
  const registrationDeadline = new Date(new Date(event.startAt).getTime() + REGISTRATION_GRACE_MS);
  if (new Date() > registrationDeadline) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Registration for this event has closed");
  }

  if (event.registrationClosesAt && event.registrationClosesAt < new Date()) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Registration for this event has closed");
  }

  if (event.registrationOpensAt && event.registrationOpensAt > new Date()) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Registration for this event has not opened yet");
  }

  if (event.capacity && event._count.registrations >= event.capacity) {
    createNotification(user.id, "warning", "Seats Full", `Seats are full for "${event.title}". Please try to register for an upcoming course.`, eventId).catch(() => {});
    throw new ApiError(StatusCodes.CONFLICT, "Seats are full for this workshop. Please try to register for an upcoming course.");
  }

  if (asVolunteer && !event.allowVolunteerSignup) {
    throw new ApiError(StatusCodes.FORBIDDEN, "Volunteer registration is disabled for this event");
  }

  if (
    asVolunteer &&
    typeof event.volunteersNeeded === "number" &&
    event.registrations.length >= event.volunteersNeeded
  ) {
    throw new ApiError(StatusCodes.CONFLICT, "Volunteer capacity is full");
  }

  const existingRegistration = await prisma.eventRegistration.findUnique({
    where: {
      eventId_userId: {
        eventId,
        userId: user.id
      }
    }
  });

  if (existingRegistration) {
    throw new ApiError(StatusCodes.CONFLICT, "User is already registered for this event");
  }

  const registration = await prisma.eventRegistration.create({
    data: {
      eventId,
      userId: user.id,
      isVolunteer: Boolean(asVolunteer)
    }
  });

  // Keep Course.enrolledCount in sync when this event belongs to a course bundle
  // (non-blocking — this is a cached count, not a source of truth).
  if (event.course) {
    recalcCourseEnrolledCount(event.course.id).catch(() => {});
  }

  // COMPULSORY BUNDLE courses are all-or-nothing: registering for one
  // workshop registers you for every other already-scheduled workshop of
  // the same course + batch too (matches the "enrolled in all workshops"
  // promise already made in the notification below).
  if (event.course?.isCompulsory) {
    cascadeBundleRegistrationForStudent(user.id, eventId).catch(() => {});
  }

  // Send confirmation email (non-blocking)
  if (event.course) {
    // Course bundle registration — fetch all workshop titles for the email
    prisma.courseModule.findMany({
      where: { courseId: event.course.id },
      orderBy: { order: 'asc' },
      select: { title: true }
    }).then(modules => {
      const titles = modules.map(m => m.title);
      sendCourseBundleEmail(user.email, user.name, event.course.name, event.course.code, titles).catch(() => {});
    }).catch(() => {});
  } else {
    sendRegistrationConfirmationEmail(user.email, user.name, event.title, event.startAt, event.venue).catch(() => {});
  }

  // In-app notification
  const dateStr = new Date(event.startAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const notifTitle = event.course
    ? `Registered: ${event.course.name}${event.course.code ? ` (${event.course.code})` : ''}`
    : `Registered: ${event.title}`;
  const notifBody = event.course
    ? `Successfully registered for Course Bundle "${event.course.name}". You are enrolled in all workshops.`
    : `You've successfully registered for "${event.title}" on ${dateStr}.`;
  createNotification(user.id, "info", notifTitle, notifBody, eventId).catch(() => {});

  return registration;
};

export const listMyRegistrations = async (userId) =>
  prisma.eventRegistration.findMany({
    where: { userId },
    include: {
      event: {
        include: {
          modules: true
        }
      }
    },
    orderBy: {
      registeredAt: "desc"
    }
  });



