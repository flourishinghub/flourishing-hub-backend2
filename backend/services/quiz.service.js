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

  // Find the event's module
  const eventModule = await prisma.eventModule.findFirst({
    where: { eventId },
    orderBy: { startAt: "asc" }
  });

  if (!eventModule) {
    throw new ApiError(StatusCodes.NOT_FOUND, `No module found for event: ${eventId}`);
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

  return {
    studentName: user.name,
    email: user.email,
    eventId,
    moduleId: eventModule.id,
    marksObtained: progress.marksObtained,
    maxMarks: eventModule.maxMarks
  };
};
