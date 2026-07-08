import { StatusCodes } from "http-status-codes";
import { prisma } from "../database/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { sendQuizResultEmail } from "./email.service.js";
import { createNotification } from "./notification.service.js";

export const submitQuizResult = async ({ email, eventId, score, secret }) => {
  // Validate webhook secret
  const expectedSecret = process.env.QUIZ_WEBHOOK_SECRET;
  if (!expectedSecret || secret !== expectedSecret) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, "Invalid webhook secret");
  }

  // Find user by email
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    include: { studentProfile: true }
  });

  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, `No user found with email: ${email}`);
  if (!user.studentProfile) throw new ApiError(StatusCodes.NOT_FOUND, "Student profile not found");

  // Fetch event with course to determine pass threshold
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { course: { select: { id: true, isCompulsory: true } } }
  });
  if (!event) throw new ApiError(StatusCodes.NOT_FOUND, `No event found with id: ${eventId}`);

  // Enforce 30-minute grace period
  if (event.endAt) {
    const gracePeriodEnd = new Date(new Date(event.endAt).getTime() + 30 * 60 * 1000);
    if (new Date() > gracePeriodEnd) {
      throw new ApiError(
        StatusCodes.GONE,
        "Submission window has closed. The 30-minute grace period after the session has expired."
      );
    }
  }

  // Dynamic pass threshold: compulsory course requires ≥4, all others ≥3
  const PASSING_SCORE = event.course?.isCompulsory ? 4 : 3;
  const passed = score >= PASSING_SCORE;

  // Find or auto-create the event module
  let eventModule = await prisma.eventModule.findFirst({
    where: { eventId },
    orderBy: { startAt: "asc" }
  });

  if (!eventModule) {
    eventModule = await prisma.eventModule.create({
      data: {
        eventId,
        title: event.title,
        startAt: event.startAt,
        endAt: event.endAt ?? event.startAt,
      }
    });
  }

  // Upsert ModuleProgress
  const progress = await prisma.moduleProgress.upsert({
    where: {
      studentProfileId_moduleId: {
        studentProfileId: user.studentProfile.id,
        moduleId: eventModule.id
      }
    },
    update: { marksObtained: score, completedAt: new Date() },
    create: {
      studentProfileId: user.studentProfile.id,
      moduleId: eventModule.id,
      marksObtained: score,
      completedAt: new Date()
    }
  });

  if (!passed) {
    // Revert attendance to ABSENT on failure
    const attendanceRecord = await prisma.attendanceRecord.findFirst({
      where: { eventId, userId: user.id }
    });
    if (attendanceRecord) {
      await prisma.attendanceRecord.update({
        where: { id: attendanceRecord.id },
        data: { status: 'ABSENT' }
      });
    }
    await prisma.eventRegistration.updateMany({
      where: { eventId, userId: user.id },
      data: { status: 'REGISTERED' }
    });
  }

  // Send quiz result email (non-blocking)
  sendQuizResultEmail(user.email, user.name, event.title, passed, score, PASSING_SCORE).catch(() => {});

  // In-app notification
  createNotification(
    user.id,
    passed ? "success" : "warning",
    passed ? `Workshop Completed: ${event.title}` : `Workshop Unsuccessful: ${event.title}`,
    passed
      ? `You scored ${score}/${PASSING_SCORE <= 3 ? 5 : 5} and passed the workshop. Great work!`
      : `You scored ${score}/5 (minimum ${PASSING_SCORE}/5 required). Consider registering for a repeat session.`,
    eventId
  ).catch(() => {});

  return {
    studentName: user.name,
    email: user.email,
    eventId,
    moduleId: eventModule.id,
    marksObtained: progress.marksObtained,
    maxMarks: eventModule.maxMarks,
    passingScore: PASSING_SCORE,
    passed
  };
};

// Webhook counterpart of the in-app star-rating flow (services/operation.service.js:submitFeedback),
// but driven by a Google Form response instead of the student UI. Used for both compulsory workshops
// (rating alongside the quiz score above) and optional workshops (rating only, no quiz/pass threshold).
export const submitFormFeedback = async ({ email, eventId, eventRating, instructorRating, eventComment, instructorComment, secret }) => {
  const expectedSecret = process.env.QUIZ_WEBHOOK_SECRET;
  if (!expectedSecret || secret !== expectedSecret) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, "Invalid webhook secret");
  }

  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, `No user found with email: ${email}`);

  const registration = await prisma.eventRegistration.findUnique({
    where: { eventId_userId: { eventId, userId: user.id } }
  });
  if (!registration) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "This user is not registered for the given event");
  }

  if (!eventRating || eventRating < 1 || eventRating > 5) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "eventRating must be an integer between 1 and 5");
  }

  const payload = {
    eventRating: Number(eventRating),
    ...(instructorRating !== undefined && instructorRating !== null ? { instructorRating: Number(instructorRating) } : {}),
    ...(eventComment ? { eventComment } : {}),
    ...(instructorComment ? { instructorComment } : {}),
  };

  const feedback = await prisma.feedback.upsert({
    where: { eventId_userId: { eventId, userId: user.id } },
    update: payload,
    create: { eventId, userId: user.id, ...payload }
  });

  return { studentName: user.name, email: user.email, eventId, feedbackId: feedback.id, eventRating: feedback.eventRating };
};
