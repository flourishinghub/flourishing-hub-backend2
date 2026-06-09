import { StatusCodes } from "http-status-codes";
import crypto from "node:crypto";

import { prisma } from "../database/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { login } from "./auth.service.js";
import { signAccessToken, verifyRefreshToken } from "../utils/jwt.js";
import {
  assignEventStaff,
  createSelfCheckIn,
  markAttendance,
  reviewCheckIn,
  submitFeedback,
  updateAvailability
} from "./operation.service.js";
import { registerForEvent } from "./registration.service.js";

const PROGRAMME_LABELS = {
  BTECH: "BTech",
  MTECH: "MTech",
  PHD: "PhD",
  MSC: "MSc",
  MA: "MA",
  OTHER: "Other"
};

const EVENT_TYPE_LABELS = {
  OPEN_WORKSHOP: "workshop",
  WELLNESS_COURSE: "wellness",
  PLACEMENT_WORKSHOP: "seminar",
  PHD_WORKSHOP: "workshop",
  OTHER: "social"
};

const SESSION_TYPE_LABELS = {
  OPEN_WORKSHOP: "workshop",
  WELLNESS_COURSE: "therapy",
  PLACEMENT_WORKSHOP: "seminar",
  PHD_WORKSHOP: "group-session",
  OTHER: "group-session"
};

const frontendSessionState = new Map();
const startedSessionIds = new Set();

const formatDate = (value) => new Date(value).toISOString().slice(0, 10);
const formatTime = (value) => new Date(value).toISOString().slice(11, 16);
const formatDateTimeIst = (value) =>
  new Date(value).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  });

const parseRegistrationNotes = (notes) => {
  if (!notes) {
    return {};
  }

  if (typeof notes === "string") {
    try {
      return JSON.parse(notes);
    } catch {
      return {};
    }
  }

  return notes;
};

const buildRegistrationNotes = (registration, session) =>
  JSON.stringify({
    ...(parseRegistrationNotes(registration?.notes) || {}),
    sessionId: session?.id || null,
    sessionLabel: session?.title || null
  });

const getStaffRoleForFrontendRole = (frontendRole) => {
  if (frontendRole === "associate-instructor") {
    return "ASSOCIATE_INSTRUCTOR";
  }

  if (frontendRole === "volunteer") {
    return "VOLUNTEER";
  }

  return "INSTRUCTOR";
};

const getDurationMinutes = (startAt, endAt) =>
  Math.max(1, Math.round((new Date(endAt).getTime() - new Date(startAt).getTime()) / 60000));

const getFrontendRole = (user, explicitRole) => {
  if (explicitRole) {
    return explicitRole;
  }

  return {
    STUDENT: "student",
    INSTRUCTOR: "instructor",
    ADMIN: "admin",
    VOLUNTEER: "volunteer",
    ASSOCIATE_INSTRUCTOR: "associate-instructor"
  }[user.role];
};

const createFrontendAccessToken = (user, explicitRole) =>
  signAccessToken({
    sub: user.id,
    role: user.role,
    email: user.email,
    frontendRole: getFrontendRole(user, explicitRole)
  });

const buildAuthPayload = (user, explicitRole) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: getFrontendRole(user, explicitRole),
  rollNo: user.studentProfile?.rollNumber,
  department: user.studentProfile?.department || user.instructorProfile?.department || undefined,
  iat: Date.now()
});

const mapEventType = (type) => EVENT_TYPE_LABELS[type] || "social";
const mapSessionType = (type) => SESSION_TYPE_LABELS[type] || "group-session";
const mapProgramme = (programme) => PROGRAMME_LABELS[programme] || "Other";

const isCheckInWindowOpen = (startAt, endAt) => {
  const now = new Date();
  const start = new Date(startAt);
  const end = new Date(endAt);
  const isSameDateIst =
    start.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }) ===
    now.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });

  return isSameDateIst && now >= new Date(start.getTime() - 6 * 60 * 60 * 1000) && now <= new Date(end.getTime() + 6 * 60 * 60 * 1000);
};

const mapEventForFrontend = (event, registration, context = {}) => {
  const registrationNotes = parseRegistrationNotes(registration?.notes);
  const selectedSession = event.modules?.find((moduleItem) => moduleItem.id === registrationNotes.sessionId);
  const latestCheckIn = event.checkIns
    ?.filter((entry) => entry.userId === registration?.userId)
    .sort((left, right) => new Date(right.checkedInAt).getTime() - new Date(left.checkedInAt).getTime())[0];
  const latestAttendance = event.attendances
    ?.filter((entry) => entry.userId === registration?.userId)
    .sort((left, right) => new Date(right.markedAt).getTime() - new Date(left.markedAt).getTime())[0];
  const activeSession = selectedSession || event.modules?.[0];
  const myAssignments = (event.assignments || [])
    .filter((entry) => entry.userId === context.userId)
    .map((entry) => entry.role);
  const isCreator = context.userId === event.createdById;
  const canParticipateInCheckIn = Boolean(registration || myAssignments.length || isCreator);
  const canCheckInNow = canParticipateInCheckIn
    ? isCheckInWindowOpen(activeSession?.startAt || event.startAt, activeSession?.endAt || event.endAt)
    : false;
  const myAvailability = event.availabilityResponses?.find((entry) => entry.userId === context.userId);
  const targetStaffRole = context.frontendRole ? getStaffRoleForFrontendRole(context.frontendRole) : null;
  const canSelfAssign = Boolean(
    targetStaffRole &&
      ["instructor", "associate-instructor", "volunteer"].includes(context.frontendRole || "") &&
      !event.assignments?.some((entry) => entry.role === targetStaffRole)
  );

  return {
    id: event.id,
    title: event.title,
    description: event.description,
    date: formatDate(event.startAt),
    time: formatTime(event.startAt),
    venue: event.venue || "TBA",
    type: mapEventType(event.type),
    organizer: event.createdBy?.name || "Flourishing Hub",
    capacity: event.capacity || 0,
    registeredCount: event._count?.registrations || 0,
    tags: [
      mapEventType(event.type),
      event.status.toLowerCase(),
      event.venue ? "offline" : "online"
    ],
    isRecurring: false,
    volunteerSlots: event.volunteersNeeded || 0,
    isRegistered: Boolean(registration),
    isVolunteerRegistered: Boolean(registration?.isVolunteer),
    selectedSessionId: selectedSession?.id || registrationNotes.sessionId || null,
    selectedSessionLabel: selectedSession?.title || registrationNotes.sessionLabel || null,
    sessions: (event.modules || []).map((moduleItem) => ({
      id: moduleItem.id,
      title: moduleItem.title,
      date: formatDate(moduleItem.startAt),
      time: formatTime(moduleItem.startAt),
      venue: moduleItem.venue || event.venue || "TBA"
    })),
    checkInStatus: latestAttendance
      ? "attendance-marked"
      : latestCheckIn
        ? "checked-in"
        : "not-checked-in",
    checkInTime: latestCheckIn?.checkedInAt || null,
    checkInTimeLabel: latestCheckIn?.checkedInAt ? formatDateTimeIst(latestCheckIn.checkedInAt) : null,
    canCheckInNow,
    checkInOpensLabel: formatDateTimeIst(activeSession?.startAt || event.startAt),
    myAvailability: myAvailability
      ? {
          isAvailable: myAvailability.isAvailable,
          note: myAvailability.note || null,
          respondedAt: myAvailability.respondedAt.toISOString()
        }
      : null,
    myAssignments,
    canSelfAssign
  };
};

const getSessionState = (sessionId, event) => {
  const stored = frontendSessionState.get(sessionId);

  if (stored) {
    return stored;
  }

  const initialState = {
    quizActive: false,
    feedbackActive: false,
    quizLink: event.modules?.find((moduleItem) => moduleItem.quizLink)?.quizLink,
    feedbackLink: event.modules?.find((moduleItem) => moduleItem.feedbackLink)?.feedbackLink
  };

  frontendSessionState.set(sessionId, initialState);
  return initialState;
};

const mapSessionForFrontend = (event) => {
  const now = new Date();
  const startsAt = new Date(event.startAt);
  const endsAt = new Date(event.endAt);
  const presentCount = event.attendances?.filter((entry) => entry.status === "PRESENT").length;

  let status = "upcoming";
  if (startedSessionIds.has(event.id) || (startsAt <= now && endsAt >= now)) {
    status = "ongoing";
  } else if (endsAt < now) {
    status = "completed";
  }

  return {
    id: event.id,
    title: event.title,
    instructorId: event.createdById,
    instructorName: event.createdBy?.name || "Instructor",
    date: formatDate(event.startAt),
    time: formatTime(event.startAt),
    venue: event.venue || "Online",
    meetLink: event.meetLink || undefined,
    participantCount: event._count?.registrations || 0,
    actualAttendees: presentCount,
    status,
    type: mapSessionType(event.type),
    registrants: event.registrations?.map((entry) => entry.userId) || []
  };
};

const mapStudentModule = (moduleItem, event, progress) => {
  const isCompleted = Boolean(progress?.completedAt);
  const startAt = new Date(moduleItem.startAt);
  const now = new Date();

  return {
    id: moduleItem.id,
    title: moduleItem.title,
    courseId: event.id,
    courseName: event.title,
    status: isCompleted ? "completed" : startAt <= now ? "in-progress" : "pending",
    marks: progress?.marksObtained ?? undefined,
    maxMarks: moduleItem.maxMarks ?? undefined,
    completedDate: progress?.completedAt ? formatDate(progress.completedAt) : undefined,
    scheduledDate: formatDate(moduleItem.startAt),
    scheduledTime: formatTime(moduleItem.startAt),
    venue: moduleItem.venue || event.venue || undefined,
    duration: getDurationMinutes(moduleItem.startAt, moduleItem.endAt)
  };
};

const buildStudentLikeProfile = async (userId, explicitRole) => {
  const [user, registrations, progressEntries, attendanceRecords, openEvents] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      include: {
        studentProfile: true,
        instructorProfile: true
      }
    }),
    prisma.eventRegistration.findMany({
      where: { userId },
      include: {
        event: {
          include: {
            modules: {
              orderBy: {
                startAt: "asc"
              }
            },
            _count: {
              select: {
                registrations: true
              }
            },
            checkIns: {
              where: {
                userId
              }
            },
            attendances: {
              where: {
                userId
              }
            },
            feedbackEntries: {
              where: {
                userId
              }
            },
            createdBy: {
              select: {
                name: true
              }
            }
          }
        }
      },
      orderBy: {
        registeredAt: "asc"
      }
    }),
    prisma.moduleProgress.findMany({
      where: {
        studentProfile: {
          userId
        }
      }
    }),
    prisma.attendanceRecord.findMany({
      where: {
        userId
      }
    }),
    prisma.event.findMany({
      where: {
        status: "PUBLISHED",
        startAt: {
          gte: new Date()
        }
      },
      include: {
        modules: {
          orderBy: {
            startAt: "asc"
          }
        },
        checkIns: {
          where: {
            userId
          }
        },
        attendances: {
          where: {
            userId
          }
        },
        createdBy: {
          select: {
            name: true
          }
        },
        _count: {
          select: {
            registrations: true
          }
        }
      },
      orderBy: {
        startAt: "asc"
      },
      take: 20
    })
  ]);

  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found");
  }

  const progressMap = new Map(
    progressEntries.map((entry) => [entry.moduleId, entry])
  );

  const modules = registrations
    .flatMap((registration) =>
      registration.event.modules.map((moduleItem) =>
        mapStudentModule(moduleItem, registration.event, progressMap.get(moduleItem.id))
      )
    )
    .sort((left, right) => {
      const leftDate = `${left.completedDate || left.scheduledDate || ""}${left.scheduledTime || ""}`;
      const rightDate = `${right.completedDate || right.scheduledDate || ""}${right.scheduledTime || ""}`;
      return leftDate.localeCompare(rightDate);
    });

  const presentCount = attendanceRecords.filter((entry) => entry.status === "PRESENT").length;
  const attendancePercentage = attendanceRecords.length
    ? Math.round((presentCount / attendanceRecords.length) * 100)
    : 0;
  const completedEvents = registrations
    .filter((entry) => new Date(entry.event.endAt) < new Date())
    .map((entry) => {
      const notes = parseRegistrationNotes(entry.notes);
      const selectedSession = entry.event.modules.find((moduleItem) => moduleItem.id === notes.sessionId) || null;
      const latestCheckIn = entry.event.checkIns?.[0] || null;
      const feedbackSubmitted = Boolean(entry.event.feedbackEntries?.length);

      return {
        id: entry.event.id,
        title: entry.event.title,
        date: formatDate(entry.event.startAt),
        time: formatTime(entry.event.startAt),
        venue: entry.event.venue || "TBA",
        sessionId: selectedSession?.id || notes.sessionId || null,
        sessionLabel: selectedSession?.title || notes.sessionLabel || null,
        checkedInAtLabel: latestCheckIn?.checkedInAt ? formatDateTimeIst(latestCheckIn.checkedInAt) : null,
        feedbackSubmitted
      };
    });

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: getFrontendRole(user, explicitRole),
    avatar: user.profileImageUrl || undefined,
    rollNo: user.studentProfile?.rollNumber || "",
    department:
      user.studentProfile?.department || user.instructorProfile?.department || "General",
    year: user.studentProfile?.yearOfStudy || 1,
    programme: mapProgramme(user.studentProfile?.programme),
    attendancePercentage,
    workshopsAttended: registrations.filter((entry) => entry.status === "ATTENDED").length,
    enrolledCourses: [...new Set(registrations.map((entry) => entry.eventId))],
    upcomingEvents: registrations
      .filter((entry) => new Date(entry.event.startAt) >= new Date())
      .map((entry) => entry.eventId),
    modules,
    events: openEvents.map((event) => {
      const registration = registrations.find((entry) => entry.eventId === event.id);
      return mapEventForFrontend(event, registration, { userId, frontendRole: explicitRole || "student" });
    }),
    completedEvents,
    registrations: registrations.map((entry) => ({
      id: entry.id,
      eventId: entry.eventId,
      status: entry.status,
      isVolunteer: entry.isVolunteer,
      registeredAt: entry.registeredAt,
      notes: entry.notes
    }))
  };
};

const buildInstructorDashboard = async (userId, explicitRole) => {
  const [user, assignmentRoles, events] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      include: {
        instructorProfile: true
      }
    }),
    prisma.eventStaffAssignment.findMany({
      where: { userId },
      select: {
        role: true
      }
    }),
    prisma.event.findMany({
      where: {
        OR: [
          { createdById: userId },
          {
            assignments: {
              some: {
                userId
              }
            }
          }
        ]
      },
      include: {
        createdBy: {
          select: {
            name: true
          }
        },
        registrations: true,
        attendances: true,
        modules: true,
        _count: {
          select: {
            registrations: true
          }
        },
        assignments: {
          where: {
            userId
          },
          select: {
            role: true
          }
        }
      },
      orderBy: {
        startAt: "asc"
      }
    })
  ]);

  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found");
  }

  const inferredRole =
    explicitRole ||
    (assignmentRoles.some((entry) => entry.role === "ASSOCIATE_INSTRUCTOR")
      ? "associate-instructor"
      : undefined);

  const sessions = events.map(mapSessionForFrontend);
  const totalStudents = new Set(
    events.flatMap((event) => event.registrations.map((entry) => entry.userId))
  ).size;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: getFrontendRole(user, inferredRole),
    department: user.instructorProfile?.department || "Flourishing Hub",
    specialization: user.instructorProfile?.designation || "Wellness Facilitation",
    totalStudents,
    sessions
  };
};

const buildAssociateDashboard = async (userId, explicitRole) => {
  const instructor = await buildInstructorDashboard(userId, explicitRole || "associate-instructor");
  const sessionIds = instructor.sessions.map((session) => session.id);

  const events = sessionIds.length
    ? await prisma.event.findMany({
        where: {
          id: {
            in: sessionIds
          }
        },
        include: {
          modules: true,
          registrations: {
            include: {
              user: {
                include: {
                  studentProfile: true
                }
              }
            }
          },
          attendances: true
        },
        orderBy: {
          startAt: "asc"
        }
      })
    : [];

  const currentEvent =
    events.find((event) => new Date(event.startAt) >= new Date()) || events[0] || null;

  const registrants = (currentEvent?.registrations || []).map((registration) => {
    const latestAttendance = currentEvent.attendances
      .filter((entry) => entry.userId === registration.userId)
      .sort((left, right) => right.markedAt.getTime() - left.markedAt.getTime())[0];

    return {
      id: registration.user.id,
      name: registration.user.name,
      email: registration.user.email,
      role: "student",
      rollNo: registration.user.studentProfile?.rollNumber || "",
      department: registration.user.studentProfile?.department || "General",
      year: registration.user.studentProfile?.yearOfStudy || 1,
      programme: mapProgramme(registration.user.studentProfile?.programme),
      attendanceStatus:
        latestAttendance?.status === "PRESENT"
          ? "present"
          : latestAttendance?.status === "ABSENT"
            ? "absent"
            : "present"
    };
  });

  const quizSessions = events.map((event) => {
    const state = getSessionState(event.id, event);
    return {
      sessionId: event.id,
      sessionTitle: event.title,
      quizActive: state.quizActive,
      feedbackActive: state.feedbackActive,
      quizLink: state.quizLink,
      feedbackLink: state.feedbackLink
    };
  });

  return {
    instructor,
    currentSession: currentEvent ? mapSessionForFrontend(currentEvent) : null,
    attendance: registrants.map((entry) => ({
      studentId: entry.id,
      name: entry.name,
      rollNo: entry.rollNo,
      department: entry.department,
      status: entry.attendanceStatus
    })),
    registrants,
    quizSessions
  };
};

const buildVolunteerDashboard = async (userId, explicitRole) => {
  const profile = await buildStudentLikeProfile(userId, explicitRole || "volunteer");
  const volunteerEventCount = profile.registrations.filter((entry) => entry.isVolunteer).length;

  return {
    ...profile,
    volunteeringStats: {
      eventsCompleted: volunteerEventCount,
      hoursContributed: volunteerEventCount * 4
    }
  };
};

const buildAdminDashboard = async () => {
  const [students, events, registrations, attendances, progressEntries] = await Promise.all([
    prisma.studentProfile.findMany(),
    prisma.event.findMany({
      include: {
        _count: {
          select: {
            registrations: true
          }
        }
      },
      orderBy: {
        startAt: "asc"
      }
    }),
    prisma.eventRegistration.findMany({
      include: {
        user: {
          include: {
            studentProfile: true
          }
        },
        event: true
      },
      orderBy: {
        registeredAt: "desc"
      },
      take: 50
    }),
    prisma.attendanceRecord.findMany({
      orderBy: {
        markedAt: "desc"
      }
    }),
    prisma.moduleProgress.findMany({
      include: {
        studentProfile: {
          include: {
            user: true
          }
        },
        module: {
          include: {
            event: true
          }
        }
      },
      orderBy: {
        completedAt: "desc"
      },
      take: 20
    })
  ]);

  const totalStudents = students.length;
  const totalWorkshops = events.length;
  const activeCourses = events.filter((event) => event.status === "PUBLISHED").length;
  const engagementRate = registrations.length
    ? Math.round((attendances.filter((entry) => entry.status === "PRESENT").length / registrations.length) * 100)
    : 0;

  const workshopsPerMonthMap = new Map();
  events.forEach((event) => {
    const month = new Date(event.startAt).toLocaleString("en-US", { month: "short" });
    workshopsPerMonthMap.set(month, (workshopsPerMonthMap.get(month) || 0) + 1);
  });

  const departmentMap = new Map();
  students.forEach((student) => {
    const current = departmentMap.get(student.department) || {
      dept: student.department,
      students: 0,
      engagement: 0
    };

    const departmentRegistrations = registrations.filter(
      (entry) => entry.user.studentProfile?.department === student.department
    );
    const departmentAttendances = attendances.filter((entry) =>
      departmentRegistrations.some((registration) => registration.userId === entry.userId)
    );

    current.students += 1;
    current.engagement = departmentRegistrations.length
      ? Math.round(
          (departmentAttendances.filter((entry) => entry.status === "PRESENT").length /
            departmentRegistrations.length) *
            100
        )
      : 0;

    departmentMap.set(student.department, current);
  });

  const programmeCounts = students.reduce((acc, student) => {
    acc[student.programme] = (acc[student.programme] || 0) + 1;
    return acc;
  }, {});

  const totalProgrammeCount = Object.values(programmeCounts).reduce((sum, count) => sum + count, 0) || 1;
  const programmeColors = ["#6C63FF", "#00C9A7", "#F59E0B", "#EF4444", "#22C55E", "#38BDF8"];
  const programmeDistribution = Object.entries(programmeCounts).map(([programme, count], index) => ({
    name: mapProgramme(programme),
    value: Math.round((count / totalProgrammeCount) * 100),
    color: programmeColors[index % programmeColors.length]
  }));

  const attendanceHeatmap = Array.from({ length: 7 }, (_, weekday) =>
    Array.from({ length: 12 }, (_, weekOffset) => {
      const targetDate = new Date();
      targetDate.setHours(0, 0, 0, 0);
      targetDate.setDate(targetDate.getDate() - (11 - weekOffset) * 7 - (targetDate.getDay() - weekday));
      const count = attendances.filter(
        (entry) => formatDate(entry.markedAt) === formatDate(targetDate)
      ).length;

      return {
        date: formatDate(targetDate),
        count
      };
    })
  );

  const recentActivity = [
    ...progressEntries
      .filter((entry) => entry.completedAt)
      .slice(0, 4)
      .map((entry, index) => ({
        id: `progress-${index}`,
        action: `${entry.studentProfile.user.name} completed ${entry.module.title}`,
        time: entry.completedAt.toISOString(),
        type: "completion",
        icon: "done"
      })),
    ...registrations.slice(0, 4).map((entry, index) => ({
      id: `registration-${index}`,
      action: `New registration: ${entry.event.title} (${entry.user.name})`,
      time: entry.registeredAt.toISOString(),
      type: "registration",
      icon: "list"
    }))
  ].slice(0, 8);

  return {
    totalStudents,
    totalWorkshops,
    activeCourses,
    engagementRate,
    workshopsPerMonth: [...workshopsPerMonthMap.entries()].map(([month, workshops]) => ({
      month,
      workshops
    })),
    engagementByDept: [...departmentMap.values()].map((item) => ({
      ...item,
      dept: item.dept.length > 12 ? item.dept.slice(0, 12) : item.dept
    })),
    programmeDistribution,
    attendanceHeatmap,
    recentActivity
  };
};

export const loginForFrontend = async ({ email, password }) => {
  const response = await login({ email, password });
  const frontendRole =
    email.toLowerCase().includes("associate") && response.user.role === "INSTRUCTOR"
      ? "associate-instructor"
      : undefined;
  const payload = buildAuthPayload(response.user, frontendRole);
  const accessToken = createFrontendAccessToken(response.user, frontendRole);

  return {
    token: accessToken,
    accessToken,
    refreshToken: response.refreshToken,
    user: payload
  };
};

export const getFrontendMe = async (user, explicitRole) => {
  const payload = buildAuthPayload(user, explicitRole);
  const accessToken = createFrontendAccessToken(user, explicitRole);
  return {
    token: accessToken,
    accessToken,
    user: payload
  };
};

export const refreshFrontendSession = async (refreshToken) => {
  verifyRefreshToken(refreshToken);
  const tokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");

  const storedToken = await prisma.refreshToken.findUnique({
    where: { token: tokenHash },
    include: {
      user: {
        include: {
          studentProfile: true,
          instructorProfile: true,
          adminProfile: true
        }
      }
    }
  });

  if (!storedToken || storedToken.revokedAt || storedToken.expiresAt < new Date()) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, "Refresh token is invalid or expired");
  }

  const frontendRole =
    storedToken.user.role === "INSTRUCTOR" &&
    storedToken.user.email.toLowerCase().includes("associate")
      ? "associate-instructor"
      : undefined;

  return getFrontendMe(storedToken.user, frontendRole);
};

export const getFrontendDashboard = async (user, explicitRole) => {
  const frontendRole = getFrontendRole(user, explicitRole);

  if (frontendRole === "admin") {
    return {
      role: frontendRole,
      analytics: await buildAdminDashboard()
    };
  }

  if (frontendRole === "associate-instructor") {
    return {
      role: frontendRole,
      dashboard: await buildAssociateDashboard(user.id, frontendRole)
    };
  }

  if (frontendRole === "instructor") {
    return {
      role: frontendRole,
      dashboard: await buildInstructorDashboard(user.id, frontendRole)
    };
  }

  if (frontendRole === "volunteer") {
    return {
      role: frontendRole,
      dashboard: await buildVolunteerDashboard(user.id, frontendRole)
    };
  }

  return {
    role: frontendRole,
    dashboard: await buildStudentLikeProfile(user.id, frontendRole)
  };
};

export const listFrontendEvents = async (user, explicitRole) => {
  const [events, registrations] = await Promise.all([
    prisma.event.findMany({
      where: {
        status: "PUBLISHED"
      },
      include: {
        modules: {
          orderBy: {
            startAt: "asc"
          }
        },
        assignments: true,
        availabilityResponses: true,
        checkIns: {
          where: {
            userId: user.id
          }
        },
        attendances: {
          where: {
            userId: user.id
          }
        },
        createdBy: {
          select: {
            name: true
          }
        },
        _count: {
          select: {
            registrations: true
          }
        }
      },
      orderBy: {
        startAt: "asc"
      }
    }),
    prisma.eventRegistration.findMany({
      where: {
        userId: user.id
      }
    })
  ]);

  return events.map((event) =>
    mapEventForFrontend(
      event,
      registrations.find((registration) => registration.eventId === event.id),
      {
        userId: user.id,
        frontendRole: getFrontendRole(user, explicitRole)
      }
    )
  );
};

export const toggleFrontendVolunteerRegistration = async (eventId, user, register) => {
  if (user.role !== "STUDENT") {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "Only students can volunteer for events from the participant flow"
    );
  }

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
      }
    }
  });

  if (!event || event.status !== "PUBLISHED") {
    throw new ApiError(StatusCodes.NOT_FOUND, "Event is not available for volunteer registration");
  }

  if (!event.allowVolunteerSignup) {
    throw new ApiError(StatusCodes.FORBIDDEN, "Volunteer registration is disabled for this event");
  }

  if (event.registrationOpensAt && event.registrationOpensAt > new Date()) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Registration for this event has not opened yet");
  }

  if (event.registrationClosesAt && event.registrationClosesAt < new Date()) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Registration for this event has closed");
  }

  const existing = await prisma.eventRegistration.findUnique({
    where: {
      eventId_userId: {
        eventId,
        userId: user.id
      }
    }
  });

  if (existing && register === false) {
    if (existing.isVolunteer) {
      await prisma.eventRegistration.delete({
        where: {
          id: existing.id
        }
      });
    } else {
      await prisma.eventRegistration.update({
        where: {
          id: existing.id
        },
        data: {
          isVolunteer: false
        }
      });
    }

    return { registered: false };
  }

  if (existing) {
    if (
      !existing.isVolunteer &&
      typeof event.volunteersNeeded === "number" &&
      event.registrations.length >= event.volunteersNeeded
    ) {
      throw new ApiError(StatusCodes.CONFLICT, "Volunteer capacity is full");
    }

    await prisma.eventRegistration.update({
      where: {
        id: existing.id
      },
      data: {
        isVolunteer: true
      }
    });

    return { registered: true };
  }

  await registerForEvent({ eventId, asVolunteer: true }, user);
  return { registered: true };
};

export const toggleFrontendEventRegistration = async (eventId, user, register, moduleId) => {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      modules: true
    }
  });

  if (!event) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Event not found");
  }

  const selectedSession = moduleId
    ? event.modules.find((moduleItem) => moduleItem.id === moduleId)
    : null;

  if (moduleId && !selectedSession) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Selected session was not found");
  }

  const existing = await prisma.eventRegistration.findUnique({
    where: {
      eventId_userId: {
        eventId,
        userId: user.id
      }
    }
  });

  if (existing && register === false) {
    await prisma.eventRegistration.delete({
      where: {
        id: existing.id
      }
    });

    return { registered: false };
  }

  if (existing) {
    if (moduleId) {
      await prisma.eventRegistration.update({
        where: {
          id: existing.id
        },
        data: {
          notes: buildRegistrationNotes(existing, selectedSession)
        }
      });
    }
    return { registered: true };
  }

  const registration = await registerForEvent({ eventId, asVolunteer: false }, user);
  if (moduleId) {
    await prisma.eventRegistration.update({
      where: {
        id: registration.id
      },
      data: {
        notes: buildRegistrationNotes(registration, selectedSession)
      }
    });
  }
  return { registered: true };
};

export const saveFrontendAttendance = async (sessionId, entries, actor, source) => {
  const results = await Promise.all(
    entries.map((entry) =>
      markAttendance(
        sessionId,
        {
          userId: entry.userId,
          status: entry.status === "present" ? "PRESENT" : "ABSENT",
          source: source || "FRONTEND_ASSOCIATE_PANEL"
        },
        actor
      )
    )
  );

  return {
    saved: results.length,
    present: entries.filter((entry) => entry.status === "present").length,
    absent: entries.filter((entry) => entry.status === "absent").length
  };
};

export const getFrontendEventManagement = async (eventId, actor) => {
  if (actor.role !== "ADMIN") {
    throw new ApiError(StatusCodes.FORBIDDEN, "Only admins can view event management data");
  }

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      modules: {
        orderBy: {
          startAt: "asc"
        }
      },
      registrations: {
        include: {
          user: {
            include: {
              studentProfile: true,
              instructorProfile: true
            }
          }
        }
      },
      checkIns: {
        orderBy: {
          checkedInAt: "desc"
        }
      },
      attendances: {
        orderBy: {
          markedAt: "desc"
        }
      },
      availabilityResponses: {
        include: {
          user: {
            include: {
              studentProfile: true,
              instructorProfile: true
            }
          }
        },
        orderBy: {
          respondedAt: "desc"
        }
      },
      assignments: {
        include: {
          user: true
        }
      }
    }
  });

  if (!event) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Event not found");
  }

  const roster = event.registrations.map((registration) => {
    const notes = parseRegistrationNotes(registration.notes);
    const selectedSession = event.modules.find((moduleItem) => moduleItem.id === notes.sessionId) || null;
    const latestCheckIn = event.checkIns.find((entry) =>
      entry.userId === registration.userId && (selectedSession ? entry.moduleId === selectedSession.id : true)
    );
    const latestAttendance = event.attendances.find((entry) =>
      entry.userId === registration.userId && (selectedSession ? entry.moduleId === selectedSession.id : true)
    );

    return {
      registrationId: registration.id,
      userId: registration.user.id,
      name: registration.user.name,
      email: registration.user.email,
      rollNumber: registration.user.studentProfile?.rollNumber || null,
      department: registration.user.studentProfile?.department || null,
      programme: mapProgramme(registration.user.studentProfile?.programme),
      yearOfStudy: registration.user.studentProfile?.yearOfStudy || null,
      registrationStatus: registration.status,
      sessionId: selectedSession?.id || notes.sessionId || null,
      sessionLabel: selectedSession?.title || notes.sessionLabel || (event.modules[0]?.title || "Main Session"),
      checkInId: latestCheckIn?.id || null,
      checkedInAt: latestCheckIn?.checkedInAt?.toISOString() || null,
      checkedInAtLabel: latestCheckIn?.checkedInAt ? formatDateTimeIst(latestCheckIn.checkedInAt) : null,
      checkInStatus: latestCheckIn ? "checked-in" : "not-checked-in",
      checkInReviewStatus: latestCheckIn?.status || null,
      attendanceStatus: latestAttendance
        ? latestAttendance.status === "PRESENT"
          ? "present"
          : latestAttendance.status === "ABSENT"
            ? "absent"
            : "excused"
        : "not-marked"
    };
  });

  const availability = event.availabilityResponses.map((entry) => ({
    userId: entry.user.id,
    name: entry.user.name,
    email: entry.user.email,
    role:
      entry.user.role === "VOLUNTEER"
        ? "volunteer"
        : entry.user.email.toLowerCase().includes("associate")
          ? "associate-instructor"
          : "instructor",
    department: entry.user.studentProfile?.department || entry.user.instructorProfile?.department || null,
    designation: entry.user.instructorProfile?.designation || null,
    isAvailable: entry.isAvailable,
    note: entry.note || null,
    respondedAt: entry.respondedAt.toISOString(),
    respondedAtLabel: formatDateTimeIst(entry.respondedAt),
    assignedRoles: event.assignments
      .filter((assignment) => assignment.userId === entry.user.id)
      .map((assignment) => assignment.role)
  }));

  const assignments = event.assignments.map((assignment) => ({
    id: assignment.id,
    userId: assignment.userId,
    name: assignment.user.name,
    email: assignment.user.email,
    role: assignment.role,
    notes: assignment.notes || null
  }));

  return {
    event: {
      id: event.id,
      title: event.title,
      description: event.description,
      date: formatDate(event.startAt),
      time: formatTime(event.startAt),
      venue: event.venue || "TBA",
      type: mapEventType(event.type),
      modules: event.modules.map((moduleItem) => ({
        id: moduleItem.id,
        title: moduleItem.title,
        date: formatDate(moduleItem.startAt),
        time: formatTime(moduleItem.startAt),
        venue: moduleItem.venue || event.venue || "TBA"
      }))
    },
    roster,
    availability,
    assignments
  };
};

export const updateFrontendAttendanceRecord = async (eventId, payload, actor) => {
  const attendance = await markAttendance(
    eventId,
    {
      userId: payload.userId,
      moduleId: payload.moduleId,
      status:
        payload.status === "present"
          ? "PRESENT"
          : payload.status === "absent"
            ? "ABSENT"
            : "EXCUSED",
      source: "FRONTEND_ADMIN_PORTAL"
    },
    actor
  );

  return {
    id: attendance.id,
    status: payload.status
  };
};

export const createFrontendEventCheckIn = async (eventId, payload, actor) => {
  const existingRegistration = await prisma.eventRegistration.findUnique({
    where: {
      eventId_userId: {
        eventId,
        userId: actor.id
      }
    }
  });

  const notes = parseRegistrationNotes(existingRegistration?.notes);
  const moduleId = payload?.moduleId || notes.sessionId || undefined;
  const checkIn = await createSelfCheckIn(
    eventId,
    {
      moduleId,
      note: payload?.note
    },
    actor
  );

  return {
    id: checkIn.id,
    checkedInAt: checkIn.checkedInAt.toISOString(),
    checkedInAtLabel: formatDateTimeIst(checkIn.checkedInAt),
    status: "checked-in"
  };
};

export const saveFrontendAvailability = async (eventId, payload, actor) => {
  const data = await updateAvailability(
    eventId,
    {
      isAvailable: payload.isAvailable,
      note: payload.note
    },
    actor
  );

  return {
    isAvailable: data.isAvailable,
    note: data.note || null,
    respondedAt: data.respondedAt.toISOString()
  };
};

export const selfAssignFrontendEvent = async (eventId, payload, actor, explicitRole) => {
  const frontendRole = getFrontendRole(actor, explicitRole);
  const staffRole = getStaffRoleForFrontendRole(frontendRole);
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      assignments: true
    }
  });

  if (!event) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Event not found");
  }

  if (event.assignments.some((assignment) => assignment.role === staffRole)) {
    throw new ApiError(StatusCodes.CONFLICT, "This role is already assigned for the event");
  }

  const existing = event.assignments.find(
    (assignment) => assignment.userId === actor.id && assignment.role === staffRole
  );

  if (existing) {
    return existing;
  }

  return prisma.eventStaffAssignment.create({
    data: {
      eventId,
      userId: actor.id,
      role: staffRole,
      notes: payload?.note
    }
  });
};

export const assignFrontendEventStaff = async (eventId, payload, actor) =>
  assignEventStaff(
    eventId,
    {
      userId: payload.userId,
      role: payload.role,
      notes: payload.notes
    },
    actor
  );

export const reviewFrontendCheckIn = async (checkInId, payload, actor) => {
  const checkIn = await reviewCheckIn(
    checkInId,
    {
      status: payload.status,
      note: payload.note
    },
    actor
  );

  return {
    id: checkIn.id,
    status: checkIn.status
  };
};

export const submitFrontendEventFeedback = async (eventId, payload, actor) => {
  const feedback = await submitFeedback(
    eventId,
    {
      eventRating: payload.eventRating,
      instructorRating: payload.instructorRating,
      eventComment: payload.eventComment,
      instructorComment: payload.instructorComment
    },
    actor
  );

  return {
    id: feedback.id,
    submitted: true
  };
};

export const toggleFrontendSessionState = async (sessionId, payload) => {
  const event = await prisma.event.findUnique({
    where: {
      id: sessionId
    },
    include: {
      modules: true
    }
  });

  if (!event) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Session not found");
  }

  const current = getSessionState(sessionId, event);
  const nextValue =
    payload.active === undefined
      ? !current[`${payload.type}Active`]
      : payload.active;

  const updated = {
    ...current,
    [`${payload.type}Active`]: nextValue
  };

  frontendSessionState.set(sessionId, updated);

  return {
    sessionId,
    sessionTitle: event.title,
    quizActive: updated.quizActive,
    feedbackActive: updated.feedbackActive,
    quizLink: updated.quizLink,
    feedbackLink: updated.feedbackLink
  };
};

export const startFrontendSession = async (sessionId) => {
  const event = await prisma.event.findUnique({
    where: {
      id: sessionId
    },
    include: {
      createdBy: {
        select: {
          name: true
        }
      },
      registrations: true,
      attendances: true
    }
  });

  if (!event) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Session not found");
  }

  startedSessionIds.add(sessionId);

  return mapSessionForFrontend(event);
};

