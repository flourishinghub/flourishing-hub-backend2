import { StatusCodes } from "http-status-codes";

import { prisma } from "../database/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { sendRegistrationConfirmationEmail } from "./email.service.js";

export const registerForEvent = async ({ eventId, asVolunteer }, user) => {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      registrations: {
        where: {
          isVolunteer: true
        },
        select: {
          id: true
        }
      },
      _count: {
        select: { registrations: true }
      }
    }
  });

  if (!event || event.status !== "PUBLISHED") {
    throw new ApiError(StatusCodes.NOT_FOUND, "Event is not available for registration");
  }

  if (event.registrationClosesAt && event.registrationClosesAt < new Date()) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Registration for this event has closed");
  }

  if (event.registrationOpensAt && event.registrationOpensAt > new Date()) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Registration for this event has not opened yet");
  }

  if (event.capacity && event._count.registrations >= event.capacity) {
    throw new ApiError(StatusCodes.CONFLICT, "Event capacity is full");
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

  // Send confirmation email (non-blocking)
  sendRegistrationConfirmationEmail(user.email, user.name, event.title, event.startAt, event.venue).catch(() => {});

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



