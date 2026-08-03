import { StatusCodes } from "http-status-codes";

import { prisma } from "../database/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { createNotification, createNotificationsForUsers } from "./notification.service.js";

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
    where: { eventId, status: "PENDING" },
    select: { id: true, userId: true, moduleId: true }
  });

  if (!pending.length) {
    return { verifiedCount: 0 };
  }

  // This used to loop reviewCheckIn (find, update, plus markAttendance's own
  // ~5 sequential queries) per check-in via Promise.all — fine for a handful,
  // but at the scale a single compulsory workshop's roster actually hits
  // (100s of pending check-ins) that's 1000+ sequential round-trips, which
  // both exhausts Prisma's pooled connection limit AND, even once bounded to
  // avoid that, takes minutes — comfortably past the frontend's 30s request
  // timeout, so the button would read as "failed" while still mutating data
  // in the background. Every check-in in a bulk-verify gets the identical
  // VERIFIED/PRESENT/"Bulk verified" write, so this does it as a handful of
  // set-based queries instead of one chain per student.
  const now = new Date();
  const checkInIds = pending.map((c) => c.id);
  const userIds = [...new Set(pending.map((c) => c.userId))];

  await prisma.eventCheckIn.updateMany({
    where: { id: { in: checkInIds } },
    data: { status: "VERIFIED", note: "Bulk verified", verifiedById: actor.id }
  });

  // AttendanceRecord has no unique constraint on (eventId, userId, moduleId)
  // to upsert against, and different check-ins can carry different
  // moduleId — group by moduleId so each group's already-existing rows get
  // one updateMany and its missing rows get one createMany, rather than
  // guessing a single query can cover every module at once.
  const byModule = new Map();
  for (const c of pending) {
    const key = c.moduleId || "__none__";
    if (!byModule.has(key)) byModule.set(key, { moduleId: c.moduleId, userIds: [] });
    byModule.get(key).userIds.push(c.userId);
  }

  for (const { moduleId, userIds: groupUserIds } of byModule.values()) {
    const existing = await prisma.attendanceRecord.findMany({
      where: { eventId, moduleId, userId: { in: groupUserIds } },
      select: { userId: true }
    });
    const existingUserIds = new Set(existing.map((a) => a.userId));
    const toUpdate = groupUserIds.filter((id) => existingUserIds.has(id));
    const toCreate = groupUserIds.filter((id) => !existingUserIds.has(id));

    if (toUpdate.length) {
      await prisma.attendanceRecord.updateMany({
        where: { eventId, moduleId, userId: { in: toUpdate } },
        data: { status: "PRESENT", source: "BULK_VERIFY", markedById: actor.id, markedAt: now }
      });
    }
    if (toCreate.length) {
      await prisma.attendanceRecord.createMany({
        data: toCreate.map((userId) => ({
          eventId, moduleId, userId, status: "PRESENT", source: "BULK_VERIFY", markedById: actor.id, markedAt: now
        }))
      });
    }
  }

  await prisma.eventRegistration.updateMany({
    where: { eventId, userId: { in: userIds } },
    data: { checkedInAt: now, status: "ATTENDED" }
  });

  createNotificationsForUsers(
    userIds,
    "success",
    "Attendance Verified",
    "Your attendance has been verified by the instructor.",
    eventId
  ).catch(() => {});

  return { verifiedCount: pending.length };
};

const assertStaffAccess = async (eventId, actor, message) => {
  const isAllowed =
    actor.role === "ADMIN" ||
    (await prisma.eventStaffAssignment.findFirst({
      where: { eventId, userId: actor.id, role: { in: ["INSTRUCTOR", "ASSOCIATE_INSTRUCTOR"] } }
    }));
  if (!isAllowed) {
    throw new ApiError(StatusCodes.FORBIDDEN, message);
  }
};

// Consolidated live-event view for assigned staff — registration/check-in/
// present counts, plus how many registered students have submitted the
// in-built quiz/feedback (when configured), so an instructor can see
// engagement at a glance instead of cross-referencing three separate lists.
// "Present" is defined the same way the check-in system defines it
// everywhere else: checked in AND verified (EventCheckIn.status VERIFIED).
export const getEventLiveSummary = async (eventId, actor) => {
  await assertStaffAccess(eventId, actor, "Only assigned staff can view this event's summary");

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, title: true }
  });
  if (!event) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Event not found");
  }

  const [registeredCount, checkInCounts, { quiz }, { form }] = await Promise.all([
    prisma.eventRegistration.count({ where: { eventId, status: { not: "CANCELLED" } } }),
    prisma.eventCheckIn.groupBy({ by: ["status"], where: { eventId }, _count: { id: true } }),
    resolveEventQuiz(eventId),
    resolveEventFeedbackForm(eventId)
  ]);

  const countByStatus = Object.fromEntries(checkInCounts.map((c) => [c.status, c._count.id]));
  const checkedInCount = checkInCounts.reduce((sum, c) => sum + c._count.id, 0);

  let quizSubmittedCount = null;
  if (quiz) {
    const quizModule = await prisma.eventModule.findUnique({
      where: { eventId_sourceQuizId: { eventId, sourceQuizId: quiz.id } }
    });
    quizSubmittedCount = quizModule
      ? await prisma.moduleProgress.count({ where: { moduleId: quizModule.id, completedAt: { not: null } } })
      : 0;
  }

  // No in-built feedback form configured — fall back to the legacy
  // per-event star-rating Feedback model every event's exit checklist
  // writes to, so this metric is never just blank.
  const feedbackSubmittedCount = form
    ? await prisma.feedbackResponse.count({ where: { eventId, feedbackFormId: form.id } })
    : await prisma.feedback.count({ where: { eventId } });

  return {
    eventId,
    title: event.title,
    registeredCount,
    checkedInCount,
    presentCount: countByStatus.VERIFIED || 0,
    pendingCount: countByStatus.PENDING || 0,
    absentCount: countByStatus.REJECTED || 0,
    hasQuiz: Boolean(quiz),
    quizSubmittedCount,
    hasFeedbackForm: Boolean(form),
    feedbackSubmittedCount
  };
};

// Read-only view of the event's in-built quiz (with correct answers — this
// is for assigned staff, not the student taking it) so an instructor can see
// what's being asked without going through the admin Forms library.
export const getEventQuizForStaff = async (eventId, actor) => {
  await assertStaffAccess(eventId, actor, "Only assigned staff can view this event's quiz");
  const { quiz } = await resolveEventQuiz(eventId);
  if (!quiz) return { available: false };
  const questions = await prisma.quizQuestion.findMany({ where: { quizId: quiz.id }, orderBy: { order: "asc" } });
  return { available: true, title: quiz.title, questions };
};

// Same as getEventQuizForStaff, for the in-built Feedback library form.
export const getEventFeedbackFormForStaff = async (eventId, actor) => {
  await assertStaffAccess(eventId, actor, "Only assigned staff can view this event's feedback form");
  const { form } = await resolveEventFeedbackForm(eventId);
  if (!form) return { available: false };
  const questions = await prisma.feedbackQuestion.findMany({ where: { feedbackFormId: form.id }, orderBy: { order: "asc" } });
  return { available: true, title: form.title, questions };
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

// Resolves the Quiz "owning" an event: a course-linked event's quiz lives on
// its shared CourseModule (every per-batch Event of that module reuses the
// same questions); a standalone/open-workshop event's quiz lives directly
// on the Event. Returns null if no in-built quiz has been configured for
// either (caller should then fall back to the legacy Google-Form quizLink).
const resolveEventQuiz = async (eventId) => {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true, title: true, startAt: true, endAt: true, courseModuleId: true, quizId: true,
      courseModule: { select: { quizId: true } }
    }
  });
  if (!event) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Event not found");
  }

  // Course-linked event inherits its module's quiz (shared by every
  // per-batch Event instantiated from that module); a standalone event uses
  // its own direct link.
  const resolvedQuizId = event.courseModuleId ? event.courseModule?.quizId : event.quizId;
  const quiz = resolvedQuizId ? await prisma.quiz.findUnique({ where: { id: resolvedQuizId } }) : null;

  return { event, quiz };
};

// Quiz/feedback unlock once the session is halfway through, independent of
// whether an instructor has verified attendance yet. Attendance review is
// its own, slower administrative process — staff have up to 5 days after
// the session ends to work through pending check-ins — and gating quiz/
// feedback access on that would leave students unable to take either until
// staff catch up, sometimes well after the session itself has ended.
// endAt falls back to startAt for a point-in-time session with no explicit end.
const isPastMidSession = (event) => {
  const start = new Date(event.startAt).getTime();
  const end = new Date(event.endAt || event.startAt).getTime();
  const midpoint = start + (end - start) / 2;
  return Date.now() >= midpoint;
};

// Being past the session's midpoint alone unlocks quiz/feedback for ANY
// registered student, including one who never showed up at all — the
// midpoint check only ever replaced the VERIFICATION requirement, not the
// check-in itself. A self check-in (PENDING is enough — it does not need
// to be VERIFIED) is still required, so quiz/feedback stay tied to a
// student having actually shown up.
const hasCheckedIn = async (eventId, userId) => {
  const checkIn = await prisma.eventCheckIn.findFirst({
    where: { eventId, userId, status: { in: ["PENDING", "VERIFIED"] } }
  });
  return !!checkIn;
};

export const getMyQuiz = async (eventId, actor) => {
  const { event, quiz } = await resolveEventQuiz(eventId);
  if (!quiz) {
    return { available: false };
  }
  if (!actor.studentProfile) {
    throw new ApiError(StatusCodes.FORBIDDEN, "Only students can take this quiz");
  }

  if (!isPastMidSession(event) || !(await hasCheckedIn(eventId, actor.id))) {
    return { available: true, locked: true };
  }

  const quizModule = await prisma.eventModule.findUnique({
    where: { eventId_sourceQuizId: { eventId, sourceQuizId: quiz.id } }
  });

  if (quizModule) {
    const progress = await prisma.moduleProgress.findUnique({
      where: {
        studentProfileId_moduleId: {
          studentProfileId: actor.studentProfile.id,
          moduleId: quizModule.id
        }
      }
    });
    if (progress?.completedAt) {
      return {
        available: true,
        locked: false,
        alreadySubmitted: true,
        score: progress.marksObtained,
        maxScore: 10
      };
    }
  }

  const questions = await prisma.quizQuestion.findMany({
    where: { quizId: quiz.id },
    orderBy: { order: "asc" },
    // correctOption is intentionally never selected here — the student
    // response must never carry the answer key.
    select: {
      id: true,
      order: true,
      questionText: true,
      optionA: true,
      optionB: true,
      optionC: true,
      optionD: true
    }
  });

  return { available: true, locked: false, alreadySubmitted: false, questions };
};

export const submitMyQuiz = async (eventId, payload, actor) => {
  const { event, quiz } = await resolveEventQuiz(eventId);
  if (!quiz) {
    throw new ApiError(StatusCodes.NOT_FOUND, "No quiz is configured for this event");
  }
  if (!actor.studentProfile) {
    throw new ApiError(StatusCodes.FORBIDDEN, "Only students can submit this quiz");
  }

  if (!isPastMidSession(event)) {
    throw new ApiError(StatusCodes.FORBIDDEN, "The quiz unlocks once the session is halfway through");
  }
  if (!(await hasCheckedIn(eventId, actor.id))) {
    throw new ApiError(StatusCodes.FORBIDDEN, "Check in to this session before taking the quiz");
  }

  // Dedicated EventModule for this quiz — never collides with real
  // pre-existing EventModules (templates, bulk MARKS import) or the legacy
  // Google-Form quiz path's own module lookup, thanks to the (eventId,
  // sourceQuizId) unique constraint.
  //
  // The constraint stops duplicate ROWS, but upsert() itself is NOT
  // race-free: under concurrent submissions (many students finishing a
  // quiz in the same second — the common case, not an edge case) two
  // requests can both miss the row in their `update` check and both race
  // into `create`, so the DB legitimately rejects the second INSERT with a
  // P2002 unique-violation, which Prisma surfaces as a thrown error instead
  // of falling back to the update. A 200-student concurrent-submit load
  // test reproduced this live: 7/200 submissions failed this way. Losing
  // to that race just means the other concurrent request already created
  // the module we needed, so re-fetching it is the correct recovery rather
  // than failing the student's submission outright.
  let quizModule;
  try {
    quizModule = await prisma.eventModule.upsert({
      where: { eventId_sourceQuizId: { eventId, sourceQuizId: quiz.id } },
      update: {},
      create: {
        eventId,
        sourceQuizId: quiz.id,
        title: event.title,
        startAt: event.startAt,
        endAt: event.endAt ?? event.startAt,
        maxMarks: 10
      }
    });
  } catch (err) {
    if (err.code === "P2002") {
      quizModule = await prisma.eventModule.findUniqueOrThrow({
        where: { eventId_sourceQuizId: { eventId, sourceQuizId: quiz.id } }
      });
    } else {
      throw err;
    }
  }

  const existingProgress = await prisma.moduleProgress.findUnique({
    where: {
      studentProfileId_moduleId: {
        studentProfileId: actor.studentProfile.id,
        moduleId: quizModule.id
      }
    }
  });
  if (existingProgress?.completedAt) {
    throw new ApiError(StatusCodes.CONFLICT, "You have already submitted this quiz");
  }

  const questions = await prisma.quizQuestion.findMany({ where: { quizId: quiz.id } });
  const correctByQuestionId = new Map(questions.map((q) => [q.id, q.correctOption]));

  let score = 0;
  for (const answer of payload.answers) {
    if (correctByQuestionId.get(answer.questionId) === answer.selectedOption) {
      score += 1;
    }
  }

  await prisma.moduleProgress.upsert({
    where: {
      studentProfileId_moduleId: {
        studentProfileId: actor.studentProfile.id,
        moduleId: quizModule.id
      }
    },
    update: { marksObtained: score, completedAt: new Date() },
    create: {
      studentProfileId: actor.studentProfile.id,
      moduleId: quizModule.id,
      marksObtained: score,
      completedAt: new Date()
    }
  });

  return { score, maxScore: 10 };
};

// Same inherit-from-module-else-use-own-field resolution as resolveEventQuiz
// above, for the Feedback library.
const resolveEventFeedbackForm = async (eventId) => {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true, title: true, startAt: true, endAt: true, courseModuleId: true, feedbackFormId: true,
      courseModule: { select: { feedbackFormId: true } }
    }
  });
  if (!event) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Event not found");
  }

  const resolvedFormId = event.courseModuleId ? event.courseModule?.feedbackFormId : event.feedbackFormId;
  const form = resolvedFormId ? await prisma.feedbackForm.findUnique({ where: { id: resolvedFormId } }) : null;

  return { event, form };
};

export const getMyFeedbackForm = async (eventId, actor) => {
  const { event, form } = await resolveEventFeedbackForm(eventId);
  if (!form) {
    return { available: false };
  }
  if (!actor.studentProfile) {
    throw new ApiError(StatusCodes.FORBIDDEN, "Only students can submit this feedback form");
  }

  if (!isPastMidSession(event) || !(await hasCheckedIn(eventId, actor.id))) {
    return { available: true, locked: true };
  }

  const response = await prisma.feedbackResponse.findUnique({
    where: { eventId_userId: { eventId, userId: actor.id } },
    include: { answers: true }
  });

  if (response) {
    return {
      available: true,
      locked: false,
      alreadySubmitted: true,
      answers: response.answers.map((a) => ({
        questionId: a.feedbackQuestionId,
        answerText: a.answerText ?? undefined,
        answerRating: a.answerRating ?? undefined
      }))
    };
  }

  const questions = await prisma.feedbackQuestion.findMany({
    where: { feedbackFormId: form.id },
    orderBy: { order: "asc" }
  });

  return { available: true, locked: false, alreadySubmitted: false, questions };
};

export const submitMyFeedbackForm = async (eventId, payload, actor) => {
  const { event, form } = await resolveEventFeedbackForm(eventId);
  if (!form) {
    throw new ApiError(StatusCodes.NOT_FOUND, "No feedback form is configured for this event");
  }
  if (!actor.studentProfile) {
    throw new ApiError(StatusCodes.FORBIDDEN, "Only students can submit this feedback form");
  }

  if (!isPastMidSession(event)) {
    throw new ApiError(StatusCodes.FORBIDDEN, "Feedback unlocks once the session is halfway through");
  }
  if (!(await hasCheckedIn(eventId, actor.id))) {
    throw new ApiError(StatusCodes.FORBIDDEN, "Check in to this session before submitting feedback");
  }

  const existing = await prisma.feedbackResponse.findUnique({
    where: { eventId_userId: { eventId, userId: actor.id } }
  });
  if (existing) {
    throw new ApiError(StatusCodes.CONFLICT, "You have already submitted this feedback");
  }

  const questions = await prisma.feedbackQuestion.findMany({ where: { feedbackFormId: form.id } });
  const questionById = new Map(questions.map((q) => [q.id, q]));
  const answerByQuestionId = new Map(payload.answers.map((a) => [a.questionId, a]));

  for (const question of questions) {
    const answer = answerByQuestionId.get(question.id);
    if (!answer) {
      throw new ApiError(StatusCodes.BAD_REQUEST, `Missing answer for question "${question.questionText}"`);
    }
    if (question.type === "RATING" && answer.answerRating === undefined) {
      throw new ApiError(StatusCodes.BAD_REQUEST, `"${question.questionText}" requires a 1-5 rating`);
    }
    if (question.type !== "RATING" && !answer.answerText) {
      throw new ApiError(StatusCodes.BAD_REQUEST, `"${question.questionText}" requires an answer`);
    }
    if (question.type === "MCQ" && !["A", "B", "C", "D"].includes(answer.answerText)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, `"${question.questionText}" requires a valid option`);
    }
  }

  await prisma.feedbackResponse.create({
    data: {
      feedbackFormId: form.id,
      eventId,
      userId: actor.id,
      answers: {
        createMany: {
          data: payload.answers
            .filter((a) => questionById.has(a.questionId))
            .map((a) => ({
              feedbackQuestionId: a.questionId,
              answerText: a.answerText ?? null,
              answerRating: a.answerRating ?? null
            }))
        }
      }
    }
  });

  return { submitted: true };
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
          assignments: { select: { role: true, user: { select: { id: true, name: true } } } },
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

