import { StatusCodes } from "http-status-codes";
import { prisma } from "../database/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { sendQuizResultEmail } from "./email.service.js";
import { createNotification } from "./notification.service.js";

// A compulsory bundle course gets bulk-imported as one Event PER BATCH —
// e.g. "Module 1" scheduled 4 times, once per batch, each with its own
// Event id. A single Google Form shared across all those batches (the
// realistic setup — same quiz content, different batch/time) can't know
// which specific batch-Event a given submission belongs to ahead of time.
//
// Preferred resolution: formId (the Form's own getPublishedUrl(), sent
// unmodified by every copy of the Apps Script template — no per-workshop
// script editing needed). Matched against whichever Event(s) have that
// exact link pasted into their Quiz Link field in the admin panel, narrowed
// to the one the SUBMITTING STUDENT is actually registered for — since a
// student only ever belongs to one batch, this is unambiguous.
//
// Legacy fallback: courseId + eventTitle (same narrowing logic, just keyed
// by admin-entered IDs instead of the form's own link) for any workshop
// whose script was configured before formId-based resolution existed.
// Falls back further to plain eventId for standalone/optional single-event
// workshops, where a fixed eventId is simpler and unambiguous.
const resolveEventId = async ({ eventId, courseId, eventTitle, formId, userId }) => {
  if (eventId) return eventId;

  if (formId) {
    const event = await prisma.event.findFirst({
      where: {
        quizLink: { contains: formId },
        registrations: { some: { userId } }
      },
      select: { id: true }
    });
    if (event) return event.id;
    if (!courseId) {
      throw new ApiError(
        StatusCodes.NOT_FOUND,
        "No workshop found whose Quiz Link matches this form, that you're registered for — " +
          "check that this form's Send link (the long docs.google.com/forms/.../viewform URL, " +
          "not a shortened forms.gle link) was pasted into the right event's Quiz Link field."
      );
    }
    // formId didn't match anything, but courseId/eventTitle were also
    // provided (legacy script) — fall through and try that path instead.
  }

  if (!courseId) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Either eventId, formId, or courseId is required");
  }

  const event = await prisma.event.findFirst({
    where: {
      courseId,
      ...(eventTitle ? { title: { equals: eventTitle, mode: "insensitive" } } : {}),
      registrations: { some: { userId } }
    },
    select: { id: true }
  });

  if (!event) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      "Could not find a workshop under this course that this student is registered for" +
        (eventTitle ? ` (matching title "${eventTitle}")` : "") +
        " — check the course ID, workshop title, and that the student is actually registered."
    );
  }
  return event.id;
};

export const submitQuizResult = async ({ email, eventId, courseId, eventTitle, formId, score, secret }) => {
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

  const resolvedEventId = await resolveEventId({ eventId, courseId, eventTitle, formId, userId: user.id });

  // Fetch event with course to determine pass threshold
  const event = await prisma.event.findUnique({
    where: { id: resolvedEventId },
    include: { course: { select: { id: true, isCompulsory: true } } }
  });
  if (!event) throw new ApiError(StatusCodes.NOT_FOUND, `No event found with id: ${resolvedEventId}`);

  // Enforce 45-minute grace period
  if (event.endAt) {
    const gracePeriodEnd = new Date(new Date(event.endAt).getTime() + 45 * 60 * 1000);
    if (new Date() > gracePeriodEnd) {
      throw new ApiError(
        StatusCodes.GONE,
        "Submission window has closed. The 45-minute grace period after the session has expired."
      );
    }
  }

  // Dynamic pass threshold: compulsory course requires ≥4, all others ≥3
  const PASSING_SCORE = event.course?.isCompulsory ? 4 : 3;
  const passed = score >= PASSING_SCORE;

  // Find or auto-create the event module
  let eventModule = await prisma.eventModule.findFirst({
    where: { eventId: resolvedEventId },
    orderBy: { startAt: "asc" }
  });

  if (!eventModule) {
    eventModule = await prisma.eventModule.create({
      data: {
        eventId: resolvedEventId,
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
      where: { eventId: resolvedEventId, userId: user.id }
    });
    if (attendanceRecord) {
      await prisma.attendanceRecord.update({
        where: { id: attendanceRecord.id },
        data: { status: 'ABSENT' }
      });
    }
    await prisma.eventRegistration.updateMany({
      where: { eventId: resolvedEventId, userId: user.id },
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
    resolvedEventId
  ).catch(() => {});

  return {
    studentName: user.name,
    email: user.email,
    eventId: resolvedEventId,
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
export const submitFormFeedback = async ({ email, eventId, courseId, eventTitle, formId, eventRating, instructorRating, eventComment, instructorComment, secret }) => {
  const expectedSecret = process.env.QUIZ_WEBHOOK_SECRET;
  if (!expectedSecret || secret !== expectedSecret) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, "Invalid webhook secret");
  }

  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, `No user found with email: ${email}`);

  const resolvedEventId = await resolveEventId({ eventId, courseId, eventTitle, formId, userId: user.id });

  const registration = await prisma.eventRegistration.findUnique({
    where: { eventId_userId: { eventId: resolvedEventId, userId: user.id } }
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
    where: { eventId_userId: { eventId: resolvedEventId, userId: user.id } },
    update: payload,
    create: { eventId: resolvedEventId, userId: user.id, ...payload }
  });

  return { studentName: user.name, email: user.email, eventId: resolvedEventId, feedbackId: feedback.id, eventRating: feedback.eventRating };
};
