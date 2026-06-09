import { StatusCodes } from "http-status-codes";

import { prisma } from "../database/prisma.js";
import { ApiError } from "../utils/ApiError.js";

const getIstDateLabel = (value) =>
  new Date(value).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });

const resolveAttendancePermission = async (eventId, actor) => {
  if (actor.role === "ADMIN") {
    return;
  }

  const assignment = await prisma.eventStaffAssignment.findFirst({
    where: {
      eventId,
      userId: actor.id,
      role: {
        in: ["INSTRUCTOR", "ASSOCIATE_INSTRUCTOR"]
      }
    }
  });

  if (!assignment) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "Only admins or assigned instructional staff can update attendance"
    );
  }
};

export const assignEventStaff = async (eventId, payload, actor) => {
  if (actor.role !== "ADMIN") {
    throw new ApiError(StatusCodes.FORBIDDEN, "Only admins can assign event staff");
  }

  const event = await prisma.event.findUnique({ where: { id: eventId } });

  if (!event) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Event not found");
  }

  if (!event.requiresCheckIn) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Check-in is disabled for this event");
  }

  return prisma.eventStaffAssignment.create({
    data: {
      eventId,
      userId: payload.userId,
      role: payload.role,
      assignedById: actor.id,
      notes: payload.notes
    }
  });
};

export const updateAvailability = async (eventId, payload, actor) => {
  if (!["INSTRUCTOR", "VOLUNTEER"].includes(actor.role)) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "Only instructors and volunteers can submit availability"
    );
  }

  return prisma.eventAvailability.upsert({
    where: {
      eventId_userId: {
        eventId,
        userId: actor.id
      }
    },
    update: {
      isAvailable: payload.isAvailable,
      note: payload.note,
      respondedAt: new Date()
    },
    create: {
      eventId,
      userId: actor.id,
      isAvailable: payload.isAvailable,
      note: payload.note
    }
  });
};

export const markAttendance = async (eventId, payload, actor) => {
  await resolveAttendancePermission(eventId, actor);

  const registration = await prisma.eventRegistration.findUnique({
    where: {
      eventId_userId: {
        eventId,
        userId: payload.userId
      }
    }
  });

  if (!registration) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User is not registered for this event");
  }

  const existingAttendance = await prisma.attendanceRecord.findFirst({
    where: {
      eventId,
      userId: payload.userId,
      moduleId: payload.moduleId || null
    },
    orderBy: {
      markedAt: "desc"
    }
  });

  const attendanceData = {
    eventId,
    moduleId: payload.moduleId,
    userId: payload.userId,
    status: payload.status,
    source: payload.source,
    markedById: actor.id,
    markedAt: new Date()
  };

  const attendance = existingAttendance
    ? await prisma.attendanceRecord.update({
        where: { id: existingAttendance.id },
        data: attendanceData
      })
    : await prisma.attendanceRecord.create({
        data: attendanceData
      });

  if (payload.status === "PRESENT") {
    await prisma.eventRegistration.update({
      where: {
        eventId_userId: {
          eventId,
          userId: payload.userId
        }
      },
      data: {
        checkedInAt: new Date(),
        status: "ATTENDED"
      }
    });
  }

  return attendance;
};

export const createSelfCheckIn = async (eventId, payload, actor) => {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      modules: true,
      assignments: true
    }
  });

  if (!event) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Event not found");
  }

  const registration = await prisma.eventRegistration.findUnique({
    where: {
      eventId_userId: {
        eventId,
        userId: actor.id
      }
    }
  });

  const isAssignedStaff = event.assignments.some((assignment) => assignment.userId === actor.id);
  const isEventCreator = event.createdById === actor.id;

  if (!registration && !isAssignedStaff && !isEventCreator) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "Register or be assigned to the event before checking in"
    );
  }

  const targetSession = payload.moduleId
    ? event.modules.find((moduleItem) => moduleItem.id === payload.moduleId)
    : null;

  if (payload.moduleId && !targetSession) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Selected session was not found");
  }

  const sessionStart = targetSession?.startAt || event.startAt;
  const sessionEnd = targetSession?.endAt || event.endAt;
  const currentTime = new Date();
  const isSameIstDate = getIstDateLabel(currentTime) === getIstDateLabel(sessionStart);

  if (
    !isSameIstDate ||
    currentTime < new Date(sessionStart.getTime() - 6 * 60 * 60 * 1000) ||
    currentTime > new Date(sessionEnd.getTime() + 6 * 60 * 60 * 1000)
  ) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Check-in is not open for this event session");
  }

  const existingCheckIn = await prisma.eventCheckIn.findFirst({
    where: {
      eventId,
      userId: actor.id,
      moduleId: payload.moduleId || null,
      status: {
        in: ["PENDING", "VERIFIED"]
      }
    },
    orderBy: {
      checkedInAt: "desc"
    }
  });

  if (existingCheckIn) {
    throw new ApiError(StatusCodes.CONFLICT, "You have already checked in for this event session");
  }

  const checkIn = await prisma.eventCheckIn.create({
    data: {
      eventId,
      moduleId: payload.moduleId,
      userId: actor.id,
      note: payload.note,
      status: "PENDING"
    }
  });

  return checkIn;
};

export const reviewCheckIn = async (checkInId, payload, actor) => {
  const existingCheckIn = await prisma.eventCheckIn.findUnique({
    where: { id: checkInId }
  });

  if (!existingCheckIn) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Check-in record not found");
  }

  await resolveAttendancePermission(existingCheckIn.eventId, actor);

  const checkIn = await prisma.eventCheckIn.update({
    where: { id: checkInId },
    data: {
      status: payload.status,
      note: payload.note,
      verifiedById: actor.id
    }
  });

  if (payload.status === "VERIFIED") {
    await markAttendance(
      checkIn.eventId,
      {
        userId: checkIn.userId,
        moduleId: checkIn.moduleId || undefined,
        status: "PRESENT",
        source: "SELF_CHECK_IN"
      },
      actor
    );
  }

  return checkIn;
};

export const submitFeedback = async (eventId, payload, actor) => {
  const registration = await prisma.eventRegistration.findUnique({
    where: {
      eventId_userId: {
        eventId,
        userId: actor.id
      }
    }
  });

  if (!registration) {
    throw new ApiError(StatusCodes.FORBIDDEN, "Only registered participants can submit feedback");
  }

  return prisma.feedback.upsert({
    where: {
      eventId_userId: {
        eventId,
        userId: actor.id
      }
    },
    update: payload,
    create: {
      eventId,
      userId: actor.id,
      ...payload
    }
  });
};

export const updateModuleProgress = async (moduleId, payload, actor) => {
  if (actor.role !== "ADMIN") {
    throw new ApiError(StatusCodes.FORBIDDEN, "Only admins can update quiz scores");
  }

  const studentProfile = await prisma.studentProfile.findUnique({
    where: {
      userId: payload.userId
    }
  });

  if (!studentProfile) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Student profile not found");
  }

  return prisma.moduleProgress.upsert({
    where: {
      studentProfileId_moduleId: {
        studentProfileId: studentProfile.id,
        moduleId
      }
    },
    update: {
      marksObtained: payload.marksObtained,
      completedAt: payload.completedAt ? new Date(payload.completedAt) : undefined
    },
    create: {
      studentProfileId: studentProfile.id,
      moduleId,
      marksObtained: payload.marksObtained,
      completedAt: payload.completedAt ? new Date(payload.completedAt) : undefined
    }
  });
};

export const getEventCheckIns = async (eventId, actor) => {
  const isAllowed =
    actor.role === "ADMIN" ||
    (await prisma.eventStaffAssignment.findFirst({
      where: { eventId, userId: actor.id, role: { in: ["INSTRUCTOR", "ASSOCIATE_INSTRUCTOR"] } }
    }));

  if (!isAllowed) {
    throw new ApiError(StatusCodes.FORBIDDEN, "Only assigned staff can view check-ins");
  }

  return prisma.eventCheckIn.findMany({
    where: { eventId },
    include: {
      user: {
        include: { studentProfile: true }
      }
    },
    orderBy: { checkedInAt: "asc" }
  });
};

export const verifyAllCheckIns = async (eventId, actor) => {
  const isAllowed =
    actor.role === "ADMIN" ||
    (await prisma.eventStaffAssignment.findFirst({
      where: { eventId, userId: actor.id, role: { in: ["INSTRUCTOR", "ASSOCIATE_INSTRUCTOR"] } }
    }));

  if (!isAllowed) {
    throw new ApiError(StatusCodes.FORBIDDEN, "Only assigned staff can verify check-ins");
  }

  const pending = await prisma.eventCheckIn.findMany({
    where: { eventId, status: "PENDING" }
  });

  await Promise.all(
    pending.map((checkIn) =>
      reviewCheckIn(checkIn.id, { status: "VERIFIED", note: "Bulk verified" }, actor)
    )
  );

  return { verifiedCount: pending.length };
};

export const getMyAttendance = async (userId) => {
  const [registrations, attendanceRecords, verifiedCheckIns] = await Promise.all([
    prisma.eventRegistration.findMany({
      where: {
        userId,
        event: { endAt: { lt: new Date() } }
      },
      include: {
        event: {
          include: {
            course: { select: { id: true, name: true } }
          }
        }
      },
      orderBy: { registeredAt: "desc" }
    }),
    prisma.attendanceRecord.findMany({ where: { userId } }),
    prisma.eventCheckIn.findMany({ where: { userId, status: "VERIFIED" } })
  ]);

  return registrations.map((reg) => {
    const attendance = attendanceRecords.find((a) => a.eventId === reg.eventId);
    const hasVerifiedCheckIn = verifiedCheckIns.some((c) => c.eventId === reg.eventId);

    let status = "ABSENT";
    if (attendance?.status === "PRESENT" || hasVerifiedCheckIn) {
      status = "PRESENT";
    } else if (attendance?.status === "EXCUSED") {
      status = "EXCUSED";
    }

    return {
      eventId: reg.eventId,
      eventTitle: reg.event.title,
      courseName: reg.event.course?.name || null,
      date: reg.event.startAt,
      status
    };
  });
};

export const getEventRegistrants = async (eventId, actor) => {
  const isAllowed =
    actor.role === "ADMIN" ||
    (await prisma.eventStaffAssignment.findFirst({
      where: { eventId, userId: actor.id, role: { in: ["INSTRUCTOR", "ASSOCIATE_INSTRUCTOR"] } }
    }));

  if (!isAllowed) {
    throw new ApiError(StatusCodes.FORBIDDEN, "Only assigned staff can view registrants");
  }

  return prisma.eventRegistration.findMany({
    where: { eventId },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          studentProfile: {
            select: {
              rollNumber: true,
              department: true,
              yearOfStudy: true,
              programme: true
            }
          }
        }
      }
    },
    orderBy: { registeredAt: "asc" }
  });
};

export const getEventAssignedVolunteers = async (eventId, actor) => {
  const isAllowed =
    actor.role === "ADMIN" ||
    (await prisma.eventStaffAssignment.findFirst({
      where: { eventId, userId: actor.id, role: { in: ["INSTRUCTOR", "ASSOCIATE_INSTRUCTOR"] } }
    }));

  if (!isAllowed) {
    throw new ApiError(StatusCodes.FORBIDDEN, "Only assigned staff can view volunteers");
  }

  return prisma.eventStaffAssignment.findMany({
    where: { eventId, role: "VOLUNTEER" },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          studentProfile: {
            select: {
              rollNumber: true,
              department: true,
              yearOfStudy: true,
              programme: true
            }
          }
        }
      }
    }
  });
};

export const getMyAssignedEvents = async (actor) => {
  // Show events from the last 30 days onwards so past/ongoing events are still accessible
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const assignments = await prisma.eventStaffAssignment.findMany({
    where: {
      userId: actor.id,
      role: "ASSOCIATE_INSTRUCTOR",
      event: {
        status: "PUBLISHED",
        startAt: { gte: thirtyDaysAgo }
      }
    },
    include: {
      event: {
        include: {
          modules: { orderBy: { startAt: "asc" } },
          course: { select: { id: true, name: true } },
          _count: { select: { registrations: true, checkIns: true } }
        }
      }
    },
    orderBy: { event: { startAt: "desc" } }
  });

  return assignments.map((a) => ({
    ...a.event,
    pendingCheckIns: a.event._count.checkIns
  }));
};

