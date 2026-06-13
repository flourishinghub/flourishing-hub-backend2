import { StatusCodes } from "http-status-codes";
import { prisma } from "../database/prisma.js";
import { ApiError } from "../utils/ApiError.js";

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

  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, `No user found with email: ${email}`);
  }

  if (!user.studentProfile) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Student profile not found for this user");
  }

  // Find the event's module — auto-create one if none exists
  let eventModule = await prisma.eventModule.findFirst({
    where: { eventId },
    orderBy: { startAt: "asc" }
  });

  if (!eventModule) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) {
      throw new ApiError(StatusCodes.NOT_FOUND, `No event found with id: ${eventId}`);
    }
    eventModule = await prisma.eventModule.create({
      data: {
        eventId,
        title: event.title,
        startAt: event.startAt,
        endAt: event.endAt
      }
    });
  }

  // Upsert ModuleProgress — marks stored here, picked up by getMyAttendance
  const progress = await prisma.moduleProgress.upsert({
    where: {
      studentProfileId_moduleId: {
        studentProfileId: user.studentProfile.id,
        moduleId: eventModule.id
      }
    },
    update: {
      marksObtained: score,
      completedAt: new Date()
    },
    create: {
      studentProfileId: user.studentProfile.id,
      moduleId: eventModule.id,
      marksObtained: score,
      completedAt: new Date()
    }
  });

  // Score < 3 → failed; revert attendance to ABSENT so bundle progress doesn't count it
  const PASSING_SCORE = 3;
  const passed = score >= PASSING_SCORE;

  if (!passed) {
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

  return {
    studentName: user.name,
    email: user.email,
    eventId,
    moduleId: eventModule.id,
    marksObtained: progress.marksObtained,
    maxMarks: eventModule.maxMarks,
    passed
  };
};
