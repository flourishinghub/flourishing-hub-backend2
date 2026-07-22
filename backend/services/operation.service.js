import { StatusCodes } from "http-status-codes";

import { prisma } from "../database/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { createNotification } from "./notification.service.js";

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
    createNotification(
      checkIn.userId,
      "success",
      "Attendance Verified",
      "Your attendance has been verified by the instructor."
    ).catch(() => {});
  }

  if (payload.status === "REJECTED") {
    // Write a definitive ABSENT record. A check-in that was VERIFIED before
    // already has an AttendanceRecord (set to PRESENT) that needs reverting;
    // but a check-in rejected straight from PENDING has never had one
    // created at all — findFirst-then-update-only left that case with no
    // AttendanceRecord ever, so the student stayed silently NOT_MARKED
    // instead of ABSENT.
    const existingAttendance = await prisma.attendanceRecord.findFirst({
      where: { eventId: checkIn.eventId, userId: checkIn.userId, moduleId: checkIn.moduleId || null }
    });
    if (existingAttendance) {
      await prisma.attendanceRecord.update({
        where: { id: existingAttendance.id },
        data: { status: "ABSENT", markedById: actor.id, markedAt: new Date() }
      });
    } else {
      await prisma.attendanceRecord.create({
        data: {
          eventId: checkIn.eventId,
          moduleId: checkIn.moduleId,
          userId: checkIn.userId,
          status: "ABSENT",
          source: "STAFF_REJECTED",
          markedById: actor.id,
          markedAt: new Date()
        }
      });
    }
    // Revert EventRegistration back to REGISTERED
    await prisma.eventRegistration.update({
      where: { eventId_userId: { eventId: checkIn.eventId, userId: checkIn.userId } },
      data: { status: "REGISTERED", checkedInAt: null }
    }).catch(() => {});
    createNotification(
      checkIn.userId,
      "warning",
      "Attendance Not Verified",
      "Your check-in was not verified. Please contact your instructor."
    ).catch(() => {});
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
  const [registrations, attendanceRecords, verifiedCheckIns, pendingCheckIns, moduleProgress, feedbacks] = await Promise.all([
    prisma.eventRegistration.findMany({
      where: {
        userId,
        // Excludes soft-cancelled (batch-reassignment leftover) registrations
        // — otherwise a superseded old batch's session still showed up in
        // Past Records alongside the corrected one for the same module.
        status: { not: "CANCELLED" },
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
    prisma.eventCheckIn.findMany({ where: { userId, status: "VERIFIED" } }),
    // A check-in the instructor never got to (still PENDING once the session
    // is long over) previously fell through to the same default as "never
    // checked in at all" — ABSENT — even though the student did show up.
    // Surfaced as its own PENDING status instead so that gets distinguished.
    prisma.eventCheckIn.findMany({ where: { userId, status: "PENDING" } }),
    prisma.moduleProgress.findMany({
      where: { studentProfile: { userId } },
      include: { module: { select: { eventId: true, maxMarks: true } } }
    }),
    prisma.feedback.findMany({ where: { userId } })
  ]);

  // Build lookup: eventId → aggregated marks (only when at least one score is entered)
  const marksMap = {};
  for (const mp of moduleProgress) {
    if (mp.marksObtained == null) continue; // score not entered yet — skip
    const eid = mp.module.eventId;
    if (!marksMap[eid]) marksMap[eid] = { marksObtained: 0, maxMarks: 0 };
    marksMap[eid].marksObtained += mp.marksObtained;
    marksMap[eid].maxMarks += mp.module.maxMarks ?? 100;
  }

  // Build lookup: eventId → eventRating
  const ratingMap = {};
  for (const fb of feedbacks) {
    ratingMap[fb.eventId] = fb.eventRating;
  }

  return registrations.map((reg) => {
    const attendance = attendanceRecords.find((a) => a.eventId === reg.eventId);
    const hasVerifiedCheckIn = verifiedCheckIns.some((c) => c.eventId === reg.eventId);
    const hasPendingCheckIn = pendingCheckIns.some((c) => c.eventId === reg.eventId);

    let status = "ABSENT";
    if (attendance?.status === "PRESENT" || hasVerifiedCheckIn) {
      status = "PRESENT";
    } else if (attendance?.status === "EXCUSED") {
      status = "EXCUSED";
    } else if (hasPendingCheckIn) {
      status = "PENDING";
    }

    const marks = marksMap[reg.eventId];

    return {
      eventId: reg.eventId,
      eventTitle: reg.event.title,
      courseName: reg.event.course?.name || null,
      venue: reg.event.venue || null,
      date: reg.event.startAt,
      status,
      marks: marks?.marksObtained != null ? marks.marksObtained : null,
      maxMarks: marks?.maxMarks != null ? marks.maxMarks : null,
      starRating: ratingMap[reg.eventId] ?? null
    };
  });
};

export const getMyCheckIn = async (eventId, actor) => {
  return prisma.eventCheckIn.findFirst({
    where: { eventId, userId: actor.id },
    orderBy: { checkedInAt: "desc" }
  });
};

// Lets the live-event page know on load whether this student already rated
// this event in a previous visit — without it, a page reload after
// submitting would forget the rating was given and re-block "Exit session".
export const getMyFeedback = async (eventId, actor) => {
  return prisma.feedback.findUnique({
    where: { eventId_userId: { eventId, userId: actor.id } }
  });
};

export const getMyEventProgress = async (eventId, actor) => {
  const progress = await prisma.moduleProgress.findMany({
    where: {
      studentProfile: { userId: actor.id },
      module: { eventId }
    },
    include: {
      module: { select: { title: true, maxMarks: true } }
    }
  });

  const feedback = await prisma.feedback.findFirst({
    where: { eventId, userId: actor.id }
  });

  const totalMarks = progress.reduce((sum, p) => sum + (p.marksObtained ?? 0), 0);
  const totalMax = progress.reduce((sum, p) => sum + (p.module.maxMarks ?? 100), 0);

  return {
    scores: progress.map((p) => ({
      moduleTitle: p.module.title,
      marksObtained: p.marksObtained,
      maxMarks: p.module.maxMarks ?? 100,
      completedAt: p.completedAt,
    })),
    totalMarks: progress.length > 0 ? totalMarks : null,
    totalMax: progress.length > 0 ? totalMax : null,
    feedbackRating: feedback?.eventRating ?? null,
  };
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

// Was hardcoded to ASSOCIATE_INSTRUCTOR, so an instructor calling this same
// endpoint always got an empty list. actor.role is the caller's own
// EventStaffAssignment role (INSTRUCTOR/ASSOCIATE_INSTRUCTOR), so this now
// serves both dashboards correctly. userId+role is a covered index
// (@@index([userId, role]) on EventStaffAssignment), so this stays a single
// indexed lookup regardless of which role calls it.
export const getMyAssignedEvents = async (actor) => {
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const assignments = await prisma.eventStaffAssignment.findMany({
    where: {
      userId: actor.id,
      role: actor.role,
      event: {
        status: { in: ["PUBLISHED", "COMPLETED"] },
        startAt: { gte: ninetyDaysAgo }
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

  const now = new Date();
  return assignments.map((a) => {
    const ev = a.event;
    let computedStatus;
    if (ev.status === "COMPLETED" || new Date(ev.endAt) < now) {
      computedStatus = "completed";
    } else if (new Date(ev.startAt) <= now && new Date(ev.endAt) >= now) {
      computedStatus = "live";
    } else {
      computedStatus = "upcoming";
    }
    return {
      ...ev,
      pendingCheckIns: ev._count.checkIns,
      registrationCount: ev._count.registrations,
      computedStatus
    };
  });
};

