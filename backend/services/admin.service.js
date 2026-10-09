import { prisma } from "../database/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { StatusCodes } from "http-status-codes";
import { normalizeBatch } from "../utils/normalizeBatch.js";
import { cascadeBundleRegistrationForNewEvent } from "./course.service.js";
import { registerCourseBatchForEvent } from "./batchAssignment.service.js";
import { sendStaffAssignmentEmail } from "./email.service.js";
import { cleanStaffName, loadStaffDirectory, rawStaffName } from "../utils/staffName.js";
import { SCORE_MODULE_TITLE } from "./quizScoreImport.service.js";

// Statuses that no longer occupy a seat — excluded from "occupied seat" / capacity counts.
const INACTIVE_REGISTRATION_STATUSES = ["CANCELLED", "NO_SHOW", "WAITLISTED"];

// AttendanceRecord.source prefixes that mean "this came from reconciling a
// physical sign-in sheet against a WhatsApp photo/CSV", covering both the
// new "PHYSICAL_SHEET" toggle tag (WorkshopFilterView) and every descriptive
// source string written by hand during manual sheet reconciliation
// ("SHEET_RECONCILIATION: signed D3 ... sheet", "PHYSICAL_SHEET_17082026",
// "sign-in-sheet-import"). Matched by prefix, not exact equality, since the
// descriptive ones always carry sheet-specific detail after the tag.
const PHYSICAL_SHEET_SOURCE_PREFIXES = ["SHEET_RECONCILIATION", "PHYSICAL_SHEET"];
const isPhysicalSheetSource = (source) => {
  if (!source) return false;
  if (source === "sign-in-sheet-import") return true;
  return PHYSICAL_SHEET_SOURCE_PREFIXES.some((p) => source.startsWith(p));
};

// CREATE EVENT
export const createEvent = async (eventData, createdById) => {
  try {
    // Generate unique slug with timestamp to avoid duplicates
    const baseSlug = eventData.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const timestamp = Date.now();
    const uniqueSlug = `${baseSlug}-${timestamp}`;

    // Guard: if endAt equals startAt (admin didn't set an end time), default to startAt + 2 hours
    const startAt = new Date(eventData.startAt);
    const endAt = eventData.endAt
      ? (new Date(eventData.endAt) <= startAt
          ? new Date(startAt.getTime() + 2 * 60 * 60 * 1000)
          : new Date(eventData.endAt))
      : new Date(startAt.getTime() + 2 * 60 * 60 * 1000);

    console.log("🔧 Creating event with slug:", uniqueSlug);

    const event = await prisma.event.create({
      data: {
        ...eventData,
        instructorName: cleanStaffName(eventData.instructorName),
        associateInstructorName: cleanStaffName(eventData.associateInstructorName),
        batch: normalizeBatch(eventData.batch),
        startAt,
        endAt,
        createdById,
        slug: uniqueSlug
      },
      include: {
        modules: true,
        createdBy: true
      }
    });

    console.log("✅ Event created successfully in DB:", event.id);

    // Same two cascades bulk-import already gets — this single-event path
    // (the admin "Create Event" modal) was missing both, so a manually
    // created compulsory workshop for an existing course+batch never
    // auto-registered anyone, defeating the point of "Compulsory Bundle".
    if (event.batch && event.courseId) {
      registerCourseBatchForEvent(event.id, event.courseId, event.batch).catch(() => {});
    }
    cascadeBundleRegistrationForNewEvent(event.id).catch(() => {});

    return event;
  } catch (error) {
    console.error("❌ Error creating event:", error);
    throw error;
  }
};

// MODIFY EVENT
export const modifyEvent = async (eventId, eventData, updatedById) => {
  const { instructorId, associateInstructorId, ...eventFields } = eventData;

  if ("batch" in eventFields) {
    eventFields.batch = normalizeBatch(eventFields.batch);
  }

  // Free-text names are only for staff without an account — picking an
  // account for a role clears that role's typed name so the two never disagree.
  for (const [idField, nameField] of [["instructorId", "instructorName"], ["associateInstructorId", "associateInstructorName"]]) {
    if (eventData[idField]) eventFields[nameField] = null;
    else if (nameField in eventFields) eventFields[nameField] = cleanStaffName(eventFields[nameField]);
  }

  // Guard: if endAt equals or precedes startAt, default to startAt + 2 hours
  if (eventFields.startAt && eventFields.endAt) {
    const s = new Date(eventFields.startAt);
    const e = new Date(eventFields.endAt);
    if (e <= s) {
      eventFields.endAt = new Date(s.getTime() + 2 * 60 * 60 * 1000);
    }
  }

  const event = await prisma.event.update({
    where: { id: eventId },
    data: eventFields,
    include: {
      modules: true,
      assignments: {
        include: {
          user: true
        }
      }
    }
  });

  // Update staff assignments if provided
  const rolesToUpdate = [
    instructorId !== undefined && "INSTRUCTOR",
    associateInstructorId !== undefined && "ASSOCIATE_INSTRUCTOR",
  ].filter(Boolean);

  if (rolesToUpdate.length) {
    await prisma.eventStaffAssignment.deleteMany({
      where: { eventId, role: { in: rolesToUpdate } },
    });

    const newAssignments = [
      instructorId && { userId: instructorId, role: "INSTRUCTOR" },
      associateInstructorId && { userId: associateInstructorId, role: "ASSOCIATE_INSTRUCTOR" },
    ].filter((a) => a && a.userId);

    if (newAssignments.length) {
      await prisma.eventStaffAssignment.createMany({
        data: newAssignments.map((a) => ({
          eventId,
          userId: a.userId,
          role: a.role,
          assignedById: updatedById,
        })),
        skipDuplicates: true,
      });

      const staffUsers = await prisma.user.findMany({
        where: { id: { in: newAssignments.map((a) => a.userId) } },
        select: { id: true, name: true, email: true }
      });
      const staffUserById = new Map(staffUsers.map((u) => [u.id, u]));
      newAssignments.forEach((a) => {
        const staffUser = staffUserById.get(a.userId);
        if (staffUser) {
          sendStaffAssignmentEmail(staffUser.email, staffUser.name, a.role, event.title, event.startAt, event.venue).catch(() => {});
        }
      });
    }
  }

  return event;
};

// ASSIGN INSTRUCTOR / ASSOCIATE INSTRUCTOR
export const assignStaff = async (eventId, userId, role, assignedById) => {
  const assignment = await prisma.eventStaffAssignment.create({
    data: {
      eventId,
      userId,
      role,
      assignedById
    },
    include: {
      user: {
        include: {
          instructorProfile: true
        }
      },
      event: true
    }
  });

  // An account now covers this role — drop any typed no-account name for it.
  const nameField = { INSTRUCTOR: "instructorName", ASSOCIATE_INSTRUCTOR: "associateInstructorName" }[role];
  if (nameField && assignment.event[nameField]) {
    await prisma.event.update({ where: { id: eventId }, data: { [nameField]: null } });
  }

  sendStaffAssignmentEmail(
    assignment.user.email,
    assignment.user.name,
    role,
    assignment.event.title,
    assignment.event.startAt,
    assignment.event.venue
  ).catch(() => {});

  return assignment;
};

// ASSIGN VOLUNTEERS
export const assignVolunteers = async (eventId, userIds, assignedById) => {
  const assignments = await Promise.all(
    userIds.map(userId =>
      prisma.eventStaffAssignment.create({
        data: {
          eventId,
          userId,
          role: "VOLUNTEER",
          assignedById
        },
        include: {
          user: true,
          event: true
        }
      })
    )
  );

  assignments.forEach((assignment) => {
    sendStaffAssignmentEmail(
      assignment.user.email,
      assignment.user.name,
      "VOLUNTEER",
      assignment.event.title,
      assignment.event.startAt,
      assignment.event.venue
    ).catch(() => {});
  });

  return assignments;
};

// FETCH MEMBER DIRECTORY
export const getMemberDirectory = async (filters = {}) => {
  const { department, year, programme, role, search } = filters;
  
  const whereClause = {
    isActive: true
  };

  // Add role filter
  if (role) {
    whereClause.role = role;
  }

  // Add search filter
  if (search) {
    whereClause.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { studentProfile: { rollNumber: { contains: search, mode: 'insensitive' } } }
    ];
  }

  // Add student-specific filters
  if (department || year || programme) {
    whereClause.studentProfile = {};
    
    if (department) {
      whereClause.studentProfile.department = department;
    }
    
    if (year) {
      whereClause.studentProfile.yearOfStudy = parseInt(year);
    }
    
    if (programme) {
      whereClause.studentProfile.programme = programme;
    }
  }

  const members = await prisma.user.findMany({
    where: whereClause,
    include: {
      studentProfile: true,
      instructorProfile: true,
      adminProfile: true
    },
    orderBy: [
      { role: 'asc' },
      { name: 'asc' }
    ]
  });

  return members.map(member => ({
    id: member.id,
    name: member.name,
    email: member.email,
    role: member.role,
    employeeId: member.employeeId,
    isActive: member.isActive,
    lastLoginAt: member.lastLoginAt,
    createdAt: member.createdAt,
    // Student specific data
    rollNumber: member.studentProfile?.rollNumber,
    department: member.studentProfile?.department || member.instructorProfile?.department,
    yearOfStudy: member.studentProfile?.yearOfStudy,
    programme: member.studentProfile?.programme,
    section: member.studentProfile?.section,
    cohort: member.studentProfile?.cohort,
    // Instructor specific data
    designation: member.instructorProfile?.designation,
    // Admin specific data
    adminEmployeeId: member.adminProfile?.employeeId
  }));
};

// GET EVENT DETAILS FOR ADMIN
export const getEventDetails = async (eventId) => {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
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
      assignments: {
        include: {
          user: {
            include: {
              instructorProfile: true
            }
          }
        }
      },
      availabilityResponses: {
        include: {
          user: true
        }
      },
      attendances: {
        include: {
          user: {
            include: {
              studentProfile: true
            }
          }
        }
      },
      createdBy: true,
      _count: {
        select: {
          registrations: true,
          attendances: true
        }
      }
    }
  });

  return event;
};

// GET EVENT DETAILS WITH REGISTRATIONS FOR ADMIN
export const getEventWithRegistrations = async (eventId) => {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      modules: true,
      registrations: {
        include: {
          user: {
            include: {
              studentProfile: true,
              instructorProfile: true
            }
          }
        },
        orderBy: {
          registeredAt: 'desc'
        }
      },
      assignments: {
        include: {
          user: {
            include: {
              instructorProfile: true
            }
          }
        }
      },
      attendances: {
        include: {
          user: {
            include: {
              studentProfile: true
            }
          }
        }
      },
      createdBy: true,
      _count: {
        select: {
          registrations: { where: { status: { notIn: INACTIVE_REGISTRATION_STATUSES } } },
          attendances: true
        }
      }
    }
  });

  if (!event) {
    return null;
  }

  // Transform registration data
  const registrations = event.registrations.map(reg => ({
    id: reg.id,
    registeredAt: reg.registeredAt,
    isVolunteer: reg.isVolunteer,
    user: {
      id: reg.user.id,
      name: reg.user.name,
      email: reg.user.email,
      role: reg.user.role,
      rollNumber: reg.user.studentProfile?.rollNumber,
      department: reg.user.studentProfile?.department || reg.user.instructorProfile?.department,
      yearOfStudy: reg.user.studentProfile?.yearOfStudy,
      programme: reg.user.studentProfile?.programme,
      section: reg.user.studentProfile?.section,
      // Prefer this event's own course+batch-scoped batch over the student's
      // flat StudentProfile.cohort — a student enrolled in multiple courses
      // only has one cohort value (last one written wins), so it can show
      // the wrong batch here whenever it doesn't match this event's course.
      cohort: event.batch || reg.user.studentProfile?.cohort
    }
  }));

  return {
    ...event,
    registrations,
    registrationStats: {
      total: event._count.registrations,
      students: registrations.filter(r => r.user.role === 'STUDENT').length,
      volunteers: registrations.filter(r => r.isVolunteer).length,
      fillRate: event.capacity > 0 ? Math.round((event._count.registrations / event.capacity) * 100) : 0,
      available: event.capacity - event._count.registrations
    }
  };
};

// GET ALL EVENTS WITH REGISTRATION DETAILS FOR ADMIN
export const getAllEventsWithRegistrations = async (filters = {}) => {
  const { status, type, startDate, endDate } = filters;
  
  const whereClause = {};

  if (status) {
    whereClause.status = status;
  }

  if (type) {
    whereClause.type = type;
  }

  if (startDate || endDate) {
    whereClause.startAt = {};
    if (startDate) {
      whereClause.startAt.gte = new Date(startDate);
    }
    if (endDate) {
      whereClause.startAt.lte = new Date(endDate);
    }
  }

  const events = await prisma.event.findMany({
    where: whereClause,
    include: {
      createdBy: true,
      course: { select: { id: true, name: true, posterUrl: true } },
      courseModule: { select: { id: true, title: true } },
      registrations: {
        include: {
          user: {
            include: {
              studentProfile: true,
              instructorProfile: true
            }
          }
        },
        orderBy: {
          registeredAt: 'desc'
        }
      },
      assignments: {
        where: { role: { in: ["INSTRUCTOR", "ASSOCIATE_INSTRUCTOR"] } },
        include: { user: { select: { id: true, name: true, role: true } } }
      },
      modules: {
        orderBy: { startAt: 'asc' }
      },
      feedbackEntries: {
        select: { eventRating: true, instructorRating: true }
      },
      _count: {
        select: {
          registrations: { where: { status: { notIn: INACTIVE_REGISTRATION_STATUSES } } },
          assignments: true,
          attendances: true
        }
      }
    },
    orderBy: { startAt: 'desc' }
  });

  const average = (values) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

  return events.map(event => ({
    ...event,
    attendedCount: event._count.attendances,
    // Average student ratings from Feedback — instructorRating is optional per
    // submission, so it's averaged separately and falls back to the overall
    // event rating when no student rated the instructor specifically.
    avgEventRating: average(event.feedbackEntries.map(f => f.eventRating)),
    avgInstructorRating: average(event.feedbackEntries.filter(f => f.instructorRating != null).map(f => f.instructorRating))
      ?? average(event.feedbackEntries.map(f => f.eventRating)),
    feedbackCount: event.feedbackEntries.length,
    registrations: event.registrations.map(reg => ({
      id: reg.id,
      registeredAt: reg.registeredAt,
      isVolunteer: reg.isVolunteer,
      user: {
        id: reg.user.id,
        name: reg.user.name,
        email: reg.user.email,
        role: reg.user.role,
        rollNumber: reg.user.studentProfile?.rollNumber,
        department: reg.user.studentProfile?.department || reg.user.instructorProfile?.department,
        yearOfStudy: reg.user.studentProfile?.yearOfStudy,
        programme: reg.user.studentProfile?.programme,
        section: reg.user.studentProfile?.section,
        // Same course+batch-scoped preference as getEventWithRegistrations above.
        cohort: event.batch || reg.user.studentProfile?.cohort
      }
    })),
    registrationStats: {
      total: event._count.registrations,
      attended: event._count.attendances,
      students: event.registrations.filter(r => r.user.role === 'STUDENT').length,
      volunteers: event.registrations.filter(r => r.isVolunteer).length,
      fillRate: event.capacity > 0 ? Math.round((event._count.registrations / event.capacity) * 100) : 0,
      available: event.capacity - event._count.registrations
    }
  }));
};

// CREATE EVENT FROM MODULE (auto-fill module data)
export const createEventFromModule = async (moduleId, eventData, createdById) => {
  const module = await prisma.courseModule.findUnique({
    where: { id: moduleId },
    include: { course: true }
  });

  if (!module) {
    throw new Error('Module not found');
  }

  const baseSlug = (eventData.title || module.title).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const uniqueSlug = `${baseSlug}-${Date.now()}`;

  return prisma.event.create({
    data: {
      ...eventData,
      batch: normalizeBatch(eventData.batch),
      courseId: module.courseId,
      courseModuleId: moduleId,
      createdById,
      slug: uniqueSlug
    },
    include: {
      course: { select: { id: true, name: true } },
      courseModule: { select: { id: true, title: true } }
    }
  });
};

// In-built quiz — a reusable Quiz-library entity (see quizLibrary.service.js
// for create/edit/delete of the quiz itself). A standalone/open-workshop
// Event (no course/module to hang it off) just holds a reference (quizId) to
// one. Course-linked events instead inherit their quiz from
// event.courseModule.quizId — see services/courseModule.service.js.
export const getEventQuiz = async (eventId) => {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { quiz: { include: { questions: { orderBy: { order: "asc" } } } } }
  });
  if (!event) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Event not found");
  }

  return event.quiz || { quizId: null, questions: [] };
};

// Links (or unlinks, when quizId is null) this standalone event to a quiz
// from the Forms library.
export const linkEventQuiz = async (eventId, quizId) => {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Event not found");
  }
  if (event.courseModuleId) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "This event's quiz is inherited from its course module — edit the module's quiz instead"
    );
  }
  if (quizId) {
    const quiz = await prisma.quiz.findUnique({ where: { id: quizId } });
    if (!quiz) {
      throw new ApiError(StatusCodes.NOT_FOUND, "Quiz not found");
    }
  }

  await prisma.event.update({ where: { id: eventId }, data: { quizId: quizId || null } });
  return getEventQuiz(eventId);
};

// Same reference-linking pattern as the quiz pair above, for the Feedback
// library (see feedbackLibrary.service.js).
export const getEventFeedbackForm = async (eventId) => {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { feedbackForm: { include: { questions: { orderBy: { order: "asc" } } } } }
  });
  if (!event) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Event not found");
  }

  return event.feedbackForm || { feedbackFormId: null, questions: [] };
};

// Links (or unlinks, when feedbackFormId is null) this standalone event to a
// feedback form from the Forms library.
export const linkEventFeedback = async (eventId, feedbackFormId) => {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Event not found");
  }
  if (event.courseModuleId) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "This event's feedback form is inherited from its course module — edit the module's feedback instead"
    );
  }
  if (feedbackFormId) {
    const form = await prisma.feedbackForm.findUnique({ where: { id: feedbackFormId } });
    if (!form) {
      throw new ApiError(StatusCodes.NOT_FOUND, "Feedback form not found");
    }
  }

  await prisma.event.update({ where: { id: eventId }, data: { feedbackFormId: feedbackFormId || null } });
  return getEventFeedbackForm(eventId);
};

// GET EVENT ANALYTICS (workshops grouped by course/module)
export const getEventAnalytics = async (filters = {}) => {
  const { courseId, moduleId } = filters;

  const where = {};
  if (courseId) where.courseId = courseId;
  if (moduleId) where.courseModuleId = moduleId;

  const [totalWorkshops, byCourse, byModule, recent] = await Promise.all([
    prisma.event.count({ where }),
    prisma.event.groupBy({
      by: ['courseId'],
      where: { courseId: { not: null }, ...where },
      _count: { id: true }
    }),
    prisma.event.groupBy({
      by: ['courseModuleId'],
      where: { courseModuleId: { not: null }, ...where },
      _count: { id: true }
    }),
    prisma.event.findMany({
      where: { courseId: { not: null }, ...where },
      include: {
        course: { select: { id: true, name: true } },
        courseModule: { select: { id: true, title: true } },
        _count: { select: { registrations: { where: { status: { notIn: INACTIVE_REGISTRATION_STATUSES } } } } }
      },
      orderBy: { startAt: 'desc' },
      take: 10
    })
  ]);

  // Resolve course names
  const courseIds = byCourse.map(r => r.courseId).filter(Boolean);
  const courses = courseIds.length
    ? await prisma.course.findMany({ where: { id: { in: courseIds } }, select: { id: true, name: true } })
    : [];
  const courseMap = Object.fromEntries(courses.map(c => [c.id, c.name]));

  // Resolve module titles
  const moduleIds = byModule.map(r => r.courseModuleId).filter(Boolean);
  const modules = moduleIds.length
    ? await prisma.courseModule.findMany({ where: { id: { in: moduleIds } }, select: { id: true, title: true } })
    : [];
  const moduleMap = Object.fromEntries(modules.map(m => [m.id, m.title]));

  return {
    totalWorkshops,
    uniqueModulesUsed: byModule.length,
    byCourse: byCourse.map(r => ({ courseId: r.courseId, courseName: courseMap[r.courseId] || 'Unknown', count: r._count.id })),
    byModule: byModule
      .map(r => ({ moduleId: r.courseModuleId, moduleTitle: moduleMap[r.courseModuleId] || 'Unknown', count: r._count.id }))
      .sort((a, b) => b.count - a.count),
    recentWorkshops: recent.map(e => ({
      id: e.id,
      title: e.title,
      courseName: e.course?.name,
      moduleTitle: e.courseModule?.title,
      batch: e.batch,
      startAt: e.startAt,
      registrations: e._count.registrations,
      status: e.status
    }))
  };
};

// WORKSHOP ANALYTICS TABLE (past workshops with full details)
export const getWorkshopAnalyticsTable = async () => {
  // Treat an event as "completed" for analytics purposes either because an admin
  // explicitly marked it COMPLETED, or because its end time has already passed —
  // otherwise this table (and the Course dropdown derived from it) stays empty
  // forever unless every event is manually flipped to COMPLETED first.
  const events = await prisma.event.findMany({
    where: {
      OR: [
        { status: "COMPLETED" },
        { status: "PUBLISHED", endAt: { lt: new Date() } }
      ]
    },
    include: {
      course: { select: { id: true, name: true, hasQuiz: true } },
      courseModule: { select: { id: true, title: true } },
      assignments: {
        include: { user: { select: { id: true, name: true, role: true } } }
      },
      registrations: {
        // Excludes CANCELLED so a student whose batch/module assignment was
        // later corrected doesn't show a stale "ghost" row here alongside
        // their real, active registration — see getEventAnalytics/getAllEventsWithRegistrations
        // above for the same INACTIVE_REGISTRATION_STATUSES pattern.
        // Also excludes deactivated users — a duplicate-account cleanup marks
        // the losing side isActive: false and rewrites its rollNumber to
        // "MERGED-<userId>" (to free the real roll number for the kept
        // account) rather than deleting it outright, so its history stays
        // auditable. Without this filter, that placeholder roll number
        // leaked straight into the Student Roster as a garbage-looking row.
        where: { status: { not: "CANCELLED" }, user: { isActive: true } },
        select: {
          id: true, status: true, userId: true,
          user: {
            select: {
              id: true, name: true, email: true,
              studentProfile: { select: { id: true, rollNumber: true, cohort: true, department: true, programme: true } }
            }
          }
        }
      },
      attendances: {
        select: { status: true, userId: true, source: true }
      },
      // Every check-in regardless of status (not just PENDING/VERIFIED) —
      // needed both to tell "checked in, awaiting instructor review" apart
      // from "never checked in at all" (both otherwise fall back to
      // NOT_MARKED via attendances alone) and to surface the raw check-in
      // status as its own analytics column. Ordered so the most recent
      // check-in per user wins when a user has more than one for this event.
      checkIns: {
        select: { userId: true, status: true, checkedInAt: true },
        orderBy: { checkedInAt: "desc" }
      },
      feedbackEntries: { select: { eventRating: true, userId: true } },
      modules: {
        select: {
          id: true,
          title: true,
          maxMarks: true,
          sourceQuizId: true,
          progressEntries: {
            select: { studentProfileId: true, marksObtained: true, completedAt: true }
          }
        }
      }
    },
    orderBy: { startAt: "desc" }
  });

  // Students who signed the physical attendance sheet but have no account yet
  // (see PendingAttendance model) — without this, this table's present/absent
  // counts silently disagreed with getEventDetailsForAdmin's (which already
  // includes them), showing e.g. 24 instead of 26 for the same workshop.
  const pendingRows = await prisma.pendingAttendance.findMany({
    where: { eventId: { in: events.map(e => e.id) }, isMatched: false, status: "PRESENT" }
  });
  const pendingByEvent = {};
  for (const p of pendingRows) {
    (pendingByEvent[p.eventId] ||= []).push(p);
  }

  // Batch CSV members with no account who never signed the physical sheet
  // either — no EventRegistration (no account to register with) and no
  // PendingAttendance (that's only created for a PRESENT no-account signer,
  // see above). Without this, a genuinely absent no-account student from
  // mam's CSV upload is invisible everywhere in this table: not a
  // registration, not a pending-present row, nothing. Cross-referenced by
  // (courseModuleId, batch) since that's the CSV upload's own scoping.
  const anyPendingRows = await prisma.pendingAttendance.findMany({
    where: { eventId: { in: events.map(e => e.id) } },
    select: { eventId: true, rollNumber: true }
  });
  const pendingRollsByEvent = {};
  for (const p of anyPendingRows) {
    if (!p.rollNumber) continue; // a present no-account signer can be recorded with roll unknown (illegible sheet, etc.)
    (pendingRollsByEvent[p.eventId] ||= new Set()).add(p.rollNumber.toUpperCase());
  }

  const batchScopedEvents = events.filter(e => e.courseModuleId && e.batch);
  const csvRows = batchScopedEvents.length
    ? await prisma.batchAssignment.findMany({
        where: {
          isMatched: false,
          OR: batchScopedEvents.map(e => ({
            courseModuleId: e.courseModuleId,
            batchCode: { equals: e.batch, mode: "insensitive" }
          }))
        },
        select: { courseModuleId: true, batchCode: true, rollNumber: true, name: true, email: true }
      })
    : [];
  const csvByModuleBatch = {};
  for (const r of csvRows) {
    const key = `${r.courseModuleId}::${r.batchCode.toUpperCase()}`;
    (csvByModuleBatch[key] ||= []).push(r);
  }

  const staffDirectory = await loadStaffDirectory(prisma);

  return events.map(event => {
    // Build lookup maps
    const attendanceMap = {};
    const physicalSheetMap = {};
    event.attendances.forEach(a => {
      attendanceMap[a.userId] = a.status;
      // Kept separate from attendanceStatus so analytics can show what the
      // sheet said independently of what the app's self-check-in said, per
      // the reconciliation rule: a physical sheet signature is Present
      // regardless of check-in state, and its absence is Absent regardless
      // of check-in state.
      if (isPhysicalSheetSource(a.source)) physicalSheetMap[a.userId] = a.status;
    });

    // Most recent check-in per user wins (event.checkIns is already ordered
    // by checkedInAt desc) — a user with more than one check-in for this
    // event only gets counted once.
    const checkInStatusMap = {};
    const checkInTimeMap = {};
    event.checkIns.forEach(c => {
      if (!(c.userId in checkInStatusMap)) {
        checkInStatusMap[c.userId] = c.status;
        checkInTimeMap[c.userId] = c.checkedInAt;
      }
    });
    const checkedInUserIds = new Set(
      Object.entries(checkInStatusMap).filter(([, status]) => status === "PENDING" || status === "VERIFIED").map(([userId]) => userId)
    );
    const toCheckInDisplayStatus = (userId) => {
      const status = checkInStatusMap[userId];
      if (status === "PENDING") return "CHECKED_IN_PENDING";
      if (status === "VERIFIED") return "CHECKED_IN_VERIFIED";
      if (status === "REJECTED") return "CHECKED_IN_REJECTED";
      return "NOT_CHECKED_IN";
    };

    const feedbackMap = {};
    event.feedbackEntries.forEach(f => { feedbackMap[f.userId] = f.eventRating; });

    // Module progress keyed by studentProfileId
    const progressMap = {};
    event.modules.forEach(mod => {
      mod.progressEntries.forEach(p => {
        if (!progressMap[p.studentProfileId]) {
          progressMap[p.studentProfileId] = { marks: null, maxMarks: null, completed: false };
        }
        if (p.marksObtained != null) {
          progressMap[p.studentProfileId].marks =
            (progressMap[p.studentProfileId].marks || 0) + p.marksObtained;
          progressMap[p.studentProfileId].maxMarks =
            (progressMap[p.studentProfileId].maxMarks || 0) + (mod.maxMarks ?? 100);
        }
        if (p.completedAt) progressMap[p.studentProfileId].completed = true;
      });
    });

    // In-built quiz score, kept separate from the general score/maxScore sum
    // above — this is specifically the auto-created module holding the new
    // 10-question in-built quiz's submission (sourceQuizId set), never the
    // legacy Google-Form webhook's module or a template/bulk-import module.
    // Always out of 10 by construction (see QUIZ_QUESTION_COUNT), so a raw
    // score comparison against the pass threshold needs no scaling.
    // A topic score uploaded from the Google-Form sheet (quizScoreImport's
    // "Quiz Score" module, also out of 10) stands in when there is no in-built
    // submission, so the Result column grades on whichever score exists.
    // Whether any score source exists for this session yet (an uploaded topic
    // sheet, or an in-built quiz) — until one does, "attended but no score"
    // means "not graded yet" (Pending) rather than "did not take the quiz".
    const quizScoresAvailable = event.modules.some(m => m.sourceQuizId != null || m.title === SCORE_MODULE_TITLE);
    const quizScoreMap = {};
    for (const mod of [
      event.modules.find(m => m.title === SCORE_MODULE_TITLE && m.sourceQuizId == null),
      event.modules.find(m => m.sourceQuizId != null), // in-built quiz wins when both exist
    ]) {
      mod?.progressEntries.forEach(p => {
        if (p.marksObtained != null) quizScoreMap[p.studentProfileId] = p.marksObtained;
      });
    }

    // Per-student list with all required fields
    const students = event.registrations.map(reg => {
      const spId = reg.user.studentProfile?.id;
      const progress = spId ? progressMap[spId] : null;
      return {
        userId: reg.userId,
        name: reg.user.name,
        email: reg.user.email,
        rollNo: reg.user.studentProfile?.rollNumber || "—",
        // Prefer this event's own course+batch-scoped batch over the student's
        // flat StudentProfile.cohort — see getEventWithRegistrations for why.
        batch: event.batch || reg.user.studentProfile?.cohort || "—",
        department: reg.user.studentProfile?.department || null,
        programme: reg.user.studentProfile?.programme || null,
        attendanceStatus: attendanceMap[reg.userId] || "NOT_MARKED",
        hasCheckedIn: checkedInUserIds.has(reg.userId),
        checkInStatus: toCheckInDisplayStatus(reg.userId),
        checkedInAt: checkInTimeMap[reg.userId] ?? null,
        physicalSheetStatus: physicalSheetMap[reg.userId] ?? null,
        quizCompleted: progress?.completed || false,
        score: progress?.marks ?? null,
        maxScore: progress?.maxMarks ?? null,
        quizScore: spId ? (quizScoreMap[spId] ?? null) : null,
        rating: feedbackMap[reg.userId] || null,
        registrationStatus: reg.status
      };
    });

    // Pending (no-account-yet) signers, appended as synthetic student rows —
    // same shape/fields as a real registrant, minus anything that requires
    // an actual account (quiz/rating/registrationStatus).
    const pendingStudents = (pendingByEvent[event.id] || []).map(p => ({
      userId: null,
      name: p.name || "—",
      email: p.email || "—",
      rollNo: p.rollNumber || "—",
      batch: event.batch || "—",
      department: null,
      programme: null,
      attendanceStatus: "PRESENT",
      hasCheckedIn: true,
      checkInStatus: "NOT_CHECKED_IN",
      physicalSheetStatus: "PRESENT",
      quizCompleted: p.quizScore != null,
      // Uploaded topic score for a no-account signer (see PendingAttendance.quizScore)
      score: p.quizScore ?? null,
      maxScore: p.quizScore != null ? 10 : null,
      quizScore: p.quizScore ?? null,
      rating: null,
      registrationStatus: null,
      isPending: true
    }));
    students.push(...pendingStudents);

    const csvAbsentKey = event.courseModuleId && event.batch
      ? `${event.courseModuleId}::${event.batch.toUpperCase()}`
      : null;
    const alreadySignedRolls = pendingRollsByEvent[event.id] || new Set();
    const csvAbsentStudents = (csvByModuleBatch[csvAbsentKey] || [])
      .filter(r => !(r.rollNumber && alreadySignedRolls.has(r.rollNumber.toUpperCase())))
      .map(r => ({
        userId: null,
        name: r.name || "—",
        // BatchAssignment.email is routinely null (mam's CSV upload usually
        // only has roll+name) — fall back to the standard IITB LDAP address,
        // same convention already used when a PendingAttendance row is
        // created for a present-but-no-account signer.
        email: r.email || (r.rollNumber ? `${r.rollNumber.toLowerCase()}@iitb.ac.in` : "—"),
        rollNo: r.rollNumber || "—",
        batch: event.batch || "—",
        department: null,
        programme: null,
        attendanceStatus: "NOT_MARKED",
        hasCheckedIn: false,
        checkInStatus: "NOT_CHECKED_IN",
        // Unknown, not "ABSENT" — this roster row only proves mam's CSV
        // expected this student for the batch, not that a physical sheet was
        // actually collected for this specific session. Final attendance
        // status still resolves to Absent via the standard NOT_MARKED +
        // not-checked-in fallback, without asserting sheet data we don't have.
        physicalSheetStatus: null,
        quizCompleted: false,
        score: null,
        maxScore: null,
        quizScore: null,
        rating: null,
        registrationStatus: null,
        isPending: true
      }));
    students.push(...csvAbsentStudents);

    const instructor = event.assignments.find(a => a.role === "INSTRUCTOR");
    const associateInstructor = event.assignments.find(a => a.role === "ASSOCIATE_INSTRUCTOR");
    const volunteers = event.assignments.filter(a => a.role === "VOLUNTEER");
    // Account or typed no-account name, reduced to a first name; the key
    // (first+last) is what the Instructor view groups by, not the account id,
    // so an account and a typed name for the same person land in one bucket.
    const instructorStaff = staffDirectory(rawStaffName(event, "INSTRUCTOR"));
    const associateStaff = staffDirectory(rawStaffName(event, "ASSOCIATE_INSTRUCTOR"));

    const present = students.filter(s => s.attendanceStatus === "PRESENT");
    // Reconciliation flows almost never write a literal "ABSENT" record (see
    // docs/attendance-reconciliation-guide.md) — a genuinely absent student's
    // attendanceStatus usually stays "NOT_MARKED", so that + not-checked-in is
    // counted as absent (same fallback as the per-row "FINAL ATTENDANCE"
    // column). The few explicit ABSENT records (a staff "Mark Absent", or ones
    // left by the stale-check-in auto-reject cron before fb3b3e0 removed it)
    // count too — the frontend's student views already treat them as absent,
    // so this card must as well.
    const absent = students.filter(s =>
      s.attendanceStatus === "ABSENT" || (s.attendanceStatus === "NOT_MARKED" && !s.hasCheckedIn)
    );
    const ratings = event.feedbackEntries.map(f => f.eventRating).filter(Boolean);
    const avgRating = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : null;

    return {
      id: event.id,
      workshopName: event.title,
      courseName: event.course?.name || "—",
      courseHasQuiz: event.course?.hasQuiz ?? false,
      quizScoresAvailable,
      moduleName: event.courseModule?.title || "—",
      instructorName: instructorStaff?.display || "—",
      instructorId: instructor?.user?.id || null,
      instructorKey: instructorStaff?.key || null,
      associateInstructorName: associateStaff?.display || "—",
      associateInstructorId: associateInstructor?.user?.id || null,
      associateInstructorKey: associateStaff?.key || null,
      volunteerNames: volunteers.map(v => v.user.name),
      date: event.startAt,
      endAt: event.endAt,
      batch: event.batch || "—",
      venue: event.venue || "—",
      totalRegistered: event.registrations.length,
      totalAttended: present.length,
      totalAbsent: absent.length,
      // True once at least one attendance record for this event carries a
      // physical-sign-in-sheet source (isPhysicalSheetSource) — i.e. a sheet
      // photo has been reconciled. Drives the "Physical Sheet: Uploaded /
      // Pending" column + filter in the Workshop-Level analytics view.
      hasPhysicalSheet: Object.keys(physicalSheetMap).length > 0,
      physicalSheetCount: Object.keys(physicalSheetMap).length,
      avgRating,
      students,
      // Backward compat
      presentStudents: present.map(s => ({ name: s.name, email: s.email, rollNo: s.rollNo })),
      absentStudents: absent.map(s => ({ name: s.name, email: s.email, rollNo: s.rollNo })),
      allRegistrants: students.map(s => ({ name: s.name, email: s.email, rollNo: s.rollNo, status: s.registrationStatus }))
    };
  });
};

// GET ASSOCIATE INSTRUCTORS AND VOLUNTEERS FOR A COURSE
export const getCourseStaff = async (courseId) => {
  const events = await prisma.event.findMany({
    where: { courseId },
    select: {
      id: true,
      title: true,
      startAt: true,
      assignments: {
        where: { role: { in: ["ASSOCIATE_INSTRUCTOR", "VOLUNTEER"] } },
        include: {
          user: {
            select: {
              id: true, name: true, email: true, role: true,
              studentProfile: { select: { rollNumber: true, department: true } },
              instructorProfile: { select: { designation: true, department: true } }
            }
          }
        }
      }
    },
    orderBy: { startAt: "asc" }
  });

  const associateInstructorMap = {};
  const volunteerMap = {};

  events.forEach(event => {
    event.assignments.forEach(a => {
      if (a.role === "ASSOCIATE_INSTRUCTOR") {
        associateInstructorMap[a.user.id] = {
          id: a.user.id,
          name: a.user.name,
          email: a.user.email,
          designation: a.user.instructorProfile?.designation || "—",
          department: a.user.instructorProfile?.department || a.user.studentProfile?.department || "—"
        };
      } else if (a.role === "VOLUNTEER") {
        volunteerMap[a.user.id] = {
          id: a.user.id,
          name: a.user.name,
          email: a.user.email,
          rollNo: a.user.studentProfile?.rollNumber || "—",
          department: a.user.studentProfile?.department || "—"
        };
      }
    });
  });

  return {
    courseId,
    associateInstructors: Object.values(associateInstructorMap),
    volunteers: Object.values(volunteerMap)
  };
};

// GENERATE MASTER EXCEL EXPORT (4 sheets)
export const generateExcelExport = async () => {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Flourishing Hub";
  workbook.created = new Date();

  // Fetch all data
  const [courses, events] = await Promise.all([
    prisma.course.findMany({
      include: {
        modules: { select: { id: true, title: true } },
        _count: { select: { events: true, modules: true } }
      }
    }),
    prisma.event.findMany({
      include: {
        course: { select: { id: true, name: true, code: true, isCompulsory: true } },
        courseModule: { select: { id: true, title: true } },
        assignments: { include: { user: { select: { id: true, name: true, role: true, instructorProfile: { select: { department: true } } } } } },
        // Same two exclusions as getWorkshopAnalyticsTable above: CANCELLED
        // so a corrected batch/module assignment doesn't leave a stale ghost
        // row alongside the real one, and isActive so a deactivated
        // duplicate-account cleanup (rollNumber rewritten to "MERGED-…" to
        // free it for the kept account) doesn't leak that placeholder into
        // the export.
        registrations: {
          where: { status: { not: "CANCELLED" }, user: { isActive: true } },
          include: {
            user: {
              select: {
                id: true, name: true, email: true,
                studentProfile: { select: { id: true, rollNumber: true, cohort: true, department: true, programme: true } }
              }
            }
          }
        },
        attendances: { select: { userId: true, status: true, markedAt: true } },
        feedbackEntries: { select: { userId: true, eventRating: true } },
        modules: {
          select: {
            id: true,
            progressEntries: { select: { studentProfileId: true, marksObtained: true, completedAt: true } }
          }
        }
      },
      orderBy: { startAt: 'asc' }
    })
  ]);

  // Attendance in this export comes straight from getWorkshopAnalyticsTable —
  // the Analytics tab's own data — so the two can never disagree. It already
  // includes no-account sheet signers (unmatched PendingAttendance) and
  // no-account CSV absentees, and never counts a pending row a second time
  // once it has been matched to a real account. (This export used to rebuild
  // attendance from registrations + every pending row, which double-counted
  // matched signers, dropped no-account absentees, and showed absentees as
  // "Not Marked".) It only covers sessions that have taken place; upcoming
  // ones have no attendance yet and fall back to their registrations.
  const analyticsById = new Map((await getWorkshopAnalyticsTable()).map(r => [r.id, r]));
  // Same Present / Absent / In-progress rule as the Analytics views.
  const finalStatusOf = (s) => {
    if (s.attendanceStatus === 'PRESENT') return 'Present';
    if (s.attendanceStatus === 'ABSENT' || !s.hasCheckedIn) return 'Absent';
    return 'Verification In-progress';
  };
  // Transcript Final Status: the Student-Level view's Result rule
  // (frontend computeModuleStatus) — attended + quiz >= 4/10 is Present,
  // below 4 is Absent, attended with no score once the topic's scores exist
  // is "Quiz Not Attempted".
  const resultOf = (s, row) => {
    const sessionOver = !row.endAt || new Date(row.endAt).getTime() <= Date.now();
    if (!sessionOver && (!row.courseHasQuiz || s.quizScore == null)) return 'Pending';
    if (s.attendanceStatus === 'NOT_MARKED') return s.hasCheckedIn ? 'Verification In-progress' : 'Absent';
    if (s.attendanceStatus !== 'PRESENT') return 'Absent';
    if (!row.courseHasQuiz) return 'Present';
    if (s.quizScore == null) return row.quizScoresAvailable ? 'Quiz Not Attempted' : 'Pending';
    return s.quizScore >= 4 ? 'Present' : 'Absent';
  };
  // In-built / uploaded topic quiz scores are out of 10; other score modules keep their own max.
  const scoreOf = (s) => {
    if (s.quizScore != null) return `${s.quizScore} / 10`;
    if (s.score != null) return s.maxScore ? `${s.score} / ${s.maxScore}` : `${s.score}`;
    return '—';
  };

  const fmtDate = (d) => d ? new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—';

  // ─── Sheet A: Course-Level Summary ───
  const sheetA = workbook.addWorksheet('A - Course Summary');
  sheetA.columns = [
    { header: 'Course Code', key: 'code', width: 14 },
    { header: 'Course Title', key: 'name', width: 30 },
    { header: 'Track Type', key: 'type', width: 16 },
    { header: 'Total Students Enrolled', key: 'enrolled', width: 22 },
    { header: 'Total Sessions Run', key: 'sessions', width: 18 },
    { header: 'Global Attendance Rate (%)', key: 'attendance', width: 26 },
    { header: 'Avg Cumulative Quiz Score', key: 'avgScore', width: 26 },
    { header: 'Overall Pass Rate (%)', key: 'passRate', width: 22 },
  ];
  sheetA.getRow(1).font = { bold: true };

  for (const course of courses) {
    const courseEvents = events.filter(e => e.courseId === course.id);
    const totalReg = courseEvents.reduce((s, e) => s + e.registrations.length, 0);
    // Attendance rate over sessions that have happened, on the Analytics roster.
    const sessionRows = courseEvents.map(e => analyticsById.get(e.id)).filter(Boolean);
    const totalAttended = sessionRows.reduce((s, r) => s + r.totalAttended, 0);
    const totalPossible = sessionRows.reduce((s, r) => s + r.students.length, 0);
    const allScores = courseEvents.flatMap(e => e.modules.flatMap(m => m.progressEntries.map(p => p.marksObtained).filter(v => v != null)));
    const avgScore = allScores.length ? (allScores.reduce((a, b) => a + b, 0) / allScores.length).toFixed(2) : '—';
    const passed = allScores.filter(s => s >= (course.isCompulsory ? 4 : 3)).length;
    sheetA.addRow({
      code: course.code || '—',
      name: course.name,
      type: course.isCompulsory ? 'Compulsory' : 'Optional',
      enrolled: totalReg,
      sessions: courseEvents.length,
      attendance: totalPossible ? Math.round((totalAttended / totalPossible) * 100) : 0,
      avgScore,
      passRate: allScores.length ? Math.round((passed / allScores.length) * 100) : 0,
    });
  }

  // ─── Sheet B: Workshop & Session-Level ───
  const sheetB = workbook.addWorksheet('B - Workshop Sessions');
  sheetB.columns = [
    { header: 'Workshop Name', key: 'name', width: 30 },
    { header: 'Parent Course Code', key: 'courseCode', width: 18 },
    { header: 'Session ID', key: 'sessionId', width: 14 },
    { header: 'Target Batch', key: 'batch', width: 16 },
    { header: 'Date & Time', key: 'date', width: 24 },
    { header: 'Venue', key: 'venue', width: 20 },
    { header: 'Lead Instructor', key: 'instructor', width: 24 },
    { header: 'Associate Instructor', key: 'associate', width: 24 },
    { header: 'Pre-Registered', key: 'registered', width: 16 },
    { header: 'Attended (Verified)', key: 'attended', width: 20 },
    { header: 'Absentees', key: 'absent', width: 12 },
    { header: 'Verification In-progress', key: 'inProgress', width: 22 },
    { header: 'Passed', key: 'passed', width: 10 },
    { header: 'Failed', key: 'failed', width: 10 },
    { header: 'Avg Feedback Rating', key: 'rating', width: 20 },
  ];
  sheetB.getRow(1).font = { bold: true };

  const staffDirectory = await loadStaffDirectory(prisma);

  for (const event of events) {
    const instructorStaff = staffDirectory(rawStaffName(event, 'INSTRUCTOR'));
    const associateStaff = staffDirectory(rawStaffName(event, 'ASSOCIATE_INSTRUCTOR'));
    const session = analyticsById.get(event.id);
    const passingScore = event.course?.isCompulsory ? 4 : 3;
    const allScores = event.modules.flatMap(m => m.progressEntries.map(p => p.marksObtained).filter(v => v != null));
    const ratings = event.feedbackEntries.map(f => f.eventRating).filter(Boolean);
    sheetB.addRow({
      name: event.title,
      courseCode: event.course?.code || '—',
      sessionId: event.id.slice(-8),
      batch: event.batch || '—',
      date: fmtDate(event.startAt),
      venue: event.venue || '—',
      instructor: instructorStaff?.display || '—',
      associate: associateStaff?.display || '—',
      registered: event.registrations.length,
      // Blank for sessions that haven't happened yet.
      attended: session ? session.totalAttended : '—',
      absent: session ? session.totalAbsent : '—',
      inProgress: session ? session.students.filter(s => finalStatusOf(s) === 'Verification In-progress').length : '—',
      passed: allScores.filter(s => s >= passingScore).length,
      failed: allScores.filter(s => s < passingScore).length,
      rating: ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : '—',
    });
  }

  // ─── Sheet C: Facilitator Evaluation ───
  const sheetC = workbook.addWorksheet('C - Facilitator Evaluation');
  sheetC.columns = [
    { header: 'Instructor Name', key: 'name', width: 26 },
    { header: 'Department', key: 'dept', width: 22 },
    { header: 'Role', key: 'role', width: 16 },
    { header: 'Total Workshops', key: 'workshops', width: 18 },
    { header: 'Avg Feedback Rating', key: 'rating', width: 22 },
  ];
  sheetC.getRow(1).font = { bold: true };

  // Instructors/associates are keyed by first+last name (see utils/staffName.js)
  // so an account and a typed no-account name for the same person are one
  // row; volunteers only ever exist as accounts and stay keyed by user id.
  const facilitatorMap = {};
  const addFacilitator = (key, name, dept, role, ratings) => {
    if (!facilitatorMap[key]) facilitatorMap[key] = { name, dept, role, workshops: 0, ratings: [] };
    if (facilitatorMap[key].dept === '—' && dept !== '—') facilitatorMap[key].dept = dept;
    facilitatorMap[key].workshops += 1;
    facilitatorMap[key].ratings.push(...ratings);
  };
  for (const event of events) {
    const ratings = event.feedbackEntries.map(f => f.eventRating).filter(Boolean);
    for (const [role, label] of [['INSTRUCTOR', 'Lead'], ['ASSOCIATE_INSTRUCTOR', 'Associate']]) {
      const staff = staffDirectory(rawStaffName(event, role));
      if (!staff) continue;
      const account = event.assignments.find(a => a.role === role)?.user;
      addFacilitator(`${role}:${staff.key}`, staff.display, account?.instructorProfile?.department || '—', label, ratings);
    }
    for (const a of event.assignments.filter(a => a.role === 'VOLUNTEER')) {
      addFacilitator(`VOLUNTEER:${a.user.id}`, a.user.name, a.user.instructorProfile?.department || '—', 'Volunteer', ratings);
    }
  }
  for (const f of Object.values(facilitatorMap)) {
    sheetC.addRow({
      name: f.name,
      dept: f.dept,
      role: f.role,
      workshops: f.workshops,
      rating: f.ratings.length ? (f.ratings.reduce((a, b) => a + b, 0) / f.ratings.length).toFixed(1) : '—',
    });
  }

  // ─── Sheet D: Student Performance Transcript ───
  const sheetD = workbook.addWorksheet('D - Student Transcripts');
  sheetD.columns = [
    { header: 'Student Name', key: 'name', width: 24 },
    { header: 'Roll Number', key: 'roll', width: 14 },
    { header: 'Email', key: 'email', width: 28 },
    { header: 'Programme', key: 'programme', width: 14 },
    { header: 'Department', key: 'dept', width: 22 },
    { header: 'Batch Year', key: 'batch', width: 12 },
    { header: 'Course Code', key: 'courseCode', width: 14 },
    { header: 'Workshop Name', key: 'workshop', width: 30 },
    { header: 'Session Date', key: 'date', width: 22 },
    { header: 'Check-In Timestamp', key: 'checkin', width: 22 },
    { header: 'Attendance Status', key: 'attendance', width: 18 },
    { header: 'Quiz Score', key: 'score', width: 12 },
    { header: 'Feedback Rating', key: 'rating', width: 16 },
    { header: 'Final Status', key: 'status', width: 14 },
  ];
  sheetD.getRow(1).font = { bold: true };

  for (const event of events) {
    const feedbackMap = Object.fromEntries(event.feedbackEntries.map(f => [f.userId, f.eventRating]));
    const spByUser = Object.fromEntries(event.registrations.map(reg => [reg.userId, reg.user.studentProfile]));
    const session = analyticsById.get(event.id);

    // A session that has happened lists the Analytics roster (registrants,
    // no-account sheet signers and no-account CSV absentees); an upcoming one
    // lists its registrations, with nothing to mark yet.
    const roster = session
      ? session.students
      : event.registrations.map(reg => ({
          userId: reg.userId, name: reg.user.name, email: reg.user.email,
          rollNo: reg.user.studentProfile?.rollNumber || '—',
          programme: reg.user.studentProfile?.programme, department: reg.user.studentProfile?.department,
          attendanceStatus: 'NOT_MARKED', hasCheckedIn: false
        }));

    for (const s of roster) {
      const sp = s.userId ? spByUser[s.userId] : null;
      // Score and status come from the Analytics row too, so a no-account
      // signer's uploaded score shows and Final Status matches the Result column.
      const status = !session ? 'Upcoming' : resultOf(s, session);
      sheetD.addRow({
        name: s.name || '—',
        roll: s.rollNo || '—',
        email: s.email || '—',
        programme: s.programme || '—',
        dept: s.department || '—',
        // Prefer this event's own course+batch-scoped batch over the student's
        // flat StudentProfile.cohort — see getEventWithRegistrations for why.
        batch: event.batch || sp?.cohort || '—',
        courseCode: event.course?.code || '—',
        workshop: event.title,
        date: fmtDate(event.startAt),
        // The student's own app check-in time (not when attendance was marked).
        checkin: s.checkedInAt ? fmtDate(s.checkedInAt) : '—',
        attendance: s.attendanceStatus,
        score: session ? scoreOf(s) : '—',
        rating: s.userId && feedbackMap[s.userId] != null ? feedbackMap[s.userId] : '—',
        status: s.userId ? status : `${status} (no account yet)`,
      });
    }
  }

  // ─── Sheet E: Student Module Summary (one sheet per course) ───
  // One student, one line, one result per module — same rules as the
  // Student-Level view (frontend aggregateStudents), see buildStudentModuleSummary.
  const sessionRows = [...analyticsById.values()];
  for (const course of courses) {
    const summary = buildStudentModuleSummary(sessionRows.filter(r => r.courseName === course.name));
    if (!summary.students.length) continue;
    const isWellness = course.name === WELLNESS_COURSE;
    const sheetName = `E - ${course.code || course.name}`.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
    const sheetE = workbook.addWorksheet(sheetName);
    sheetE.columns = [
      { header: 'Student Name', key: 'name', width: 24 },
      { header: 'Roll Number', key: 'roll', width: 14 },
      { header: 'Email', key: 'email', width: 28 },
      { header: 'Department', key: 'dept', width: 22 },
      { header: 'Programme', key: 'programme', width: 14 },
      ...summary.modules.flatMap((m, i) => [
        { header: `${m} — Batch`, key: `b${i}`, width: 18 },
        { header: `${m} — ${isWellness ? 'Final Attendance' : 'Attendance'}`, key: `a${i}`, width: 18 },
        ...(course.hasQuiz ? [{ header: `${m} — Score`, key: `s${i}`, width: 12 }] : []),
      ]),
      { header: 'Modules Present', key: 'present', width: 16 },
      { header: 'Total Modules', key: 'held', width: 14 },
      { header: 'Attendance %', key: 'pct', width: 14 },
    ];
    sheetE.getRow(1).font = { bold: true };
    for (const s of summary.students) {
      const row = {
        name: s.name || '—', roll: s.rollNo || '—', email: s.email || '—',
        dept: s.department || '—', programme: s.programme || '—',
        present: s.presentCount, held: s.markedCount,
        pct: s.markedCount ? `${Math.round((s.presentCount / s.markedCount) * 100)}%` : '—',
      };
      summary.modules.forEach((m, i) => {
        const r = s.modules[m];
        row[`b${i}`] = r ? r.batches.join(' → ') || '—' : '—';
        row[`a${i}`] = r ? { PRESENT: 'Present', ABSENT: 'Absent', PENDING: 'Pending' }[r.final] : '—';
        if (course.hasQuiz) row[`s${i}`] = r?.score != null ? `${r.score} / 10` : '—';
      });
      sheetE.addRow(row);
    }
  }

  return workbook.xlsx.writeBuffer();
};

// ─── One student, one line (admin rule, 2026-10-09) ───
// Mirrors the frontend's analytics/filterUtils.ts (aggregateStudents,
// computeWellnessGrade, computeModuleStatus) so the Master Excel summary and
// the Student-Level view agree. A student with several sessions of one module
// (original batch + a Buffer make-up) gets one result for it, from a single
// chosen session: best result, then has a score, then sheet/check-in
// evidence, then latest. Attendance % is module-wise: Present modules ÷
// every module of the course, completed or pending.
const WELLNESS_COURSE = "Wellness Workshop";
const WELLNESS_PASS_SCORE = 4;

const sessionIsOver = (row) => !row.endAt || new Date(row.endAt).getTime() <= Date.now();

const wellnessFinal = (s, row) => {
  const physical = s.physicalSheetStatus === "PRESENT";
  const digital = s.checkInStatus === "CHECKED_IN_PENDING" || s.checkInStatus === "CHECKED_IN_VERIFIED";
  const quizPass = s.quizScore != null && s.quizScore >= WELLNESS_PASS_SCORE;
  if (physical && digital && quizPass) return "PRESENT";
  if (!sessionIsOver(row)) return "PENDING";
  if (physical && digital && s.quizScore == null && !row.quizScoresAvailable) return "PENDING";
  return "ABSENT";
};

// Frontend computeModuleStatus, as a rank: Present 5, attended but failed /
// unscored 4, Pending 2, Absent 1.
const moduleStatusRank = (s, row) => {
  if (!sessionIsOver(row) && (!row.courseHasQuiz || s.quizScore == null)) return 2;
  if (s.attendanceStatus === "NOT_MARKED") return s.hasCheckedIn ? 2 : 1;
  if (s.attendanceStatus !== "PRESENT") return 1;
  if (!row.courseHasQuiz) return 5;
  if (s.quizScore == null) return row.quizScoresAvailable ? 4 : 2;
  return s.quizScore >= 4 ? 5 : 4;
};

const moduleFinal = (s, row) => {
  if (row.courseName === WELLNESS_COURSE) return wellnessFinal(s, row);
  if (!sessionIsOver(row)) return "PENDING";
  if (s.attendanceStatus === "NOT_MARKED") return s.hasCheckedIn ? "PENDING" : "ABSENT";
  return s.attendanceStatus === "PRESENT" ? "PRESENT" : "ABSENT";
};

const sessionRank = ({ s, row }) => [
  row.courseName === WELLNESS_COURSE ? { PRESENT: 3, PENDING: 2, ABSENT: 1 }[wellnessFinal(s, row)] : moduleStatusRank(s, row),
  s.quizScore != null || s.score != null ? 1 : 0,
  (s.physicalSheetStatus === "PRESENT" ? 1 : 0) + (s.hasCheckedIn ? 1 : 0),
  new Date(row.date).getTime(),
];

const pickSession = (sessions) => sessions.reduce((best, cur) => {
  const a = sessionRank(cur);
  const b = sessionRank(best);
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] > b[i] ? cur : best;
  return best;
});

export const buildStudentModuleSummary = (rows) => {
  const byStudent = new Map();
  for (const row of rows) {
    for (const s of row.students) {
      const roll = s.rollNo && s.rollNo !== "—" ? s.rollNo.toUpperCase() : "";
      const key = s.userId || (roll ? `pending:${roll}` : `pending:${s.email}`);
      if (!byStudent.has(key)) byStudent.set(key, { info: s, modules: new Map() });
      const moduleKey = row.moduleName && row.moduleName !== "—" ? row.moduleName : `event:${row.id}`;
      const mods = byStudent.get(key).modules;
      if (!mods.has(moduleKey)) mods.set(moduleKey, []);
      mods.get(moduleKey).push({ s, row });
    }
  }
  const moduleNames = new Set(rows.map(r => r.moduleName).filter(m => m && m !== "—"));
  const students = [...byStudent.values()].map(({ info, modules }) => {
    const out = {
      name: info.name, rollNo: info.rollNo, email: info.email,
      department: info.department, programme: info.programme,
      // Denominator: every module of the course, completed or pending.
      presentCount: 0, markedCount: moduleNames.size, modules: {},
    };
    for (const [moduleKey, sessions] of modules) {
      const { s, row } = pickSession(sessions);
      const final = moduleFinal(s, row);
      if (final === "PRESENT") out.presentCount += 1;
      if (moduleKey.startsWith("event:")) {
        out.markedCount += 1;
        continue;
      }
      out.modules[moduleKey] = {
        final,
        // The chosen session's score, else any other session's, so a quiz the
        // student did take still shows.
        score: s.quizScore ?? sessions.map(x => x.s.quizScore).find(q => q != null) ?? null,
        batches: [...sessions]
          .sort((a, b) => new Date(a.row.date).getTime() - new Date(b.row.date).getTime())
          .map(x => x.row.batch || x.s.batch)
          .filter(b => b && b !== "—"),
      };
    }
    return out;
  });
  students.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return { modules: [...moduleNames].sort(), students };
};

// DELETE EVENT
export const deleteEvent = async (eventId) => {
  const event = await prisma.event.delete({
    where: { id: eventId }
  });

  return event;
};

// BULK DELETE SELECTED EVENTS (checkbox multi-select in Event Management)
export const bulkDeleteEvents = async (eventIds) => {
  if (!Array.isArray(eventIds) || eventIds.length === 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "eventIds must be a non-empty array");
  }
  const result = await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  return { deletedCount: result.count };
};

// DELETE ALL EVENTS OF A SPECIFIC COURSE ("delete all" scoped by course filter)
export const deleteEventsByCourse = async (courseId) => {
  if (!courseId) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "courseId is required");
  }
  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } });
  if (!course) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Course not found");
  }
  const result = await prisma.event.deleteMany({ where: { courseId } });
  return { deletedCount: result.count };
};

// DANGER ZONE: wipe Events and/or Courses (selective — admin picks the
// scope), with all their cascading registrations, attendance, check-ins,
// quiz/module progress, and feedback. Deliberately does NOT touch User
// accounts — students/staff logins survive. Callers (the controller) are
// responsible for the typed-confirmation gate; this function performs the
// deletion unconditionally once called.
export const wipeEventsAndCourses = async ({ deleteEvents, deleteCourses }) => {
  const ops = [];
  if (deleteEvents) ops.push(prisma.event.deleteMany({}));
  if (deleteCourses) ops.push(prisma.course.deleteMany({}));
  if (ops.length === 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Select at least one of deleteEvents or deleteCourses");
  }

  const results = await prisma.$transaction(ops);
  let i = 0;
  const deletedEvents = deleteEvents ? results[i++].count : 0;
  const deletedCourses = deleteCourses ? results[i++].count : 0;
  return { deletedEvents, deletedCourses };
};

// DANGER ZONE (non-destructive alternative): archive Events and/or Courses
// instead of deleting them — flips status to ARCHIVED, all data stays
// intact and can be restored by changing status back. Skips rows already
// ARCHIVED so re-running is harmless.
export const archiveEventsAndCourses = async ({ archiveEvents, archiveCourses }) => {
  const ops = [];
  if (archiveEvents) {
    ops.push(prisma.event.updateMany({ where: { status: { not: 'ARCHIVED' } }, data: { status: 'ARCHIVED' } }));
  }
  if (archiveCourses) {
    ops.push(prisma.course.updateMany({ where: { status: { not: 'ARCHIVED' } }, data: { status: 'ARCHIVED' } }));
  }
  if (ops.length === 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Select at least one of archiveEvents or archiveCourses");
  }

  const results = await prisma.$transaction(ops);
  let i = 0;
  const archivedEvents = archiveEvents ? results[i++].count : 0;
  const archivedCourses = archiveCourses ? results[i++].count : 0;
  return { archivedEvents, archivedCourses };
};

// REMOVE STAFF ASSIGNMENT
export const removeStaffAssignment = async (assignmentId) => {
  const assignment = await prisma.eventStaffAssignment.delete({
    where: { id: assignmentId }
  });

  return assignment;
};

// GET VOLUNTEER ACTIVITY DATA
export const getVolunteerActivity = async (userId) => {
  const volunteerData = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      eventAssignments: {
        where: { role: 'VOLUNTEER' },
        include: {
          event: {
            select: {
              id: true,
              title: true,
              startAt: true,
              status: true
            }
          }
        }
      },
      registrations: {
        where: { isVolunteer: true },
        include: {
          event: {
            select: {
              id: true,
              title: true,
              startAt: true,
              status: true
            }
          }
        }
      },
      attendances: {
        include: {
          event: {
            select: {
              id: true,
              title: true,
              startAt: true
            }
          }
        }
      }
    }
  });

  if (!volunteerData) {
    return null;
  }

  // Calculate volunteer statistics
  const totalAssignments = volunteerData.eventAssignments.length;
  const totalVolunteerRegistrations = volunteerData.registrations.filter(r => r.isVolunteer).length;
  const totalAttendances = volunteerData.attendances.length;
  
  // Get recent volunteer activities (last 6 months)
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  
  const recentActivities = [
    ...volunteerData.eventAssignments.filter(a => new Date(a.event.startAt) >= sixMonthsAgo),
    ...volunteerData.registrations.filter(r => r.isVolunteer && new Date(r.event.startAt) >= sixMonthsAgo)
  ];

  return {
    userId: volunteerData.id,
    name: volunteerData.name,
    email: volunteerData.email,
    totalAssignments,
    totalVolunteerRegistrations,
    totalAttendances,
    recentActivities: recentActivities.length,
    isActive: recentActivities.length > 0,
    lastActivity: recentActivities.length > 0 ? 
      Math.max(...recentActivities.map(a => new Date(a.event?.startAt || a.registeredAt).getTime())) : 
      null
  };
};

// GET ALL VOLUNTEERS WITH ACTIVITY DATA
export const getVolunteersWithActivity = async () => {
  const volunteers = await prisma.user.findMany({
    where: { 
      role: 'VOLUNTEER',
      isActive: true 
    },
    include: {
      studentProfile: true,
      eventAssignments: {
        where: { role: 'VOLUNTEER' },
        include: {
          event: {
            select: {
              id: true,
              title: true,
              startAt: true,
              status: true
            }
          }
        }
      },
      registrations: {
        where: { isVolunteer: true },
        include: {
          event: {
            select: {
              id: true,
              title: true,
              startAt: true,
              status: true
            }
          }
        }
      },
      attendances: {
        include: {
          event: {
            select: {
              id: true,
              title: true,
              startAt: true
            }
          }
        }
      }
    }
  });

  return volunteers.map(volunteer => {
    const totalAssignments = volunteer.eventAssignments.length;
    const totalVolunteerRegistrations = volunteer.registrations.filter(r => r.isVolunteer).length;
    const totalAttendances = volunteer.attendances.length;
    
    // Get recent volunteer activities (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    const recentActivities = [
      ...volunteer.eventAssignments.filter(a => new Date(a.event.startAt) >= sixMonthsAgo),
      ...volunteer.registrations.filter(r => r.isVolunteer && new Date(r.event.startAt) >= sixMonthsAgo)
    ];

    return {
      id: volunteer.id,
      name: volunteer.name,
      email: volunteer.email,
      role: volunteer.role,
      // Student profile data
      rollNumber: volunteer.studentProfile?.rollNumber,
      department: volunteer.studentProfile?.department,
      yearOfStudy: volunteer.studentProfile?.yearOfStudy,
      programme: volunteer.studentProfile?.programme,
      section: volunteer.studentProfile?.section,
      cohort: volunteer.studentProfile?.cohort,
      // Volunteer activity data
      totalAssignments,
      totalVolunteerRegistrations,
      totalAttendances,
      totalVolunteerEvents: totalAssignments + totalVolunteerRegistrations,
      recentActivities: recentActivities.length,
      isActive: recentActivities.length > 0,
      lastActivity: recentActivities.length > 0 ? 
        Math.max(...recentActivities.map(a => new Date(a.event?.startAt || a.registeredAt).getTime())) : 
        null,
      status: recentActivities.length > 0 ? 'ACTIVE' : 'INACTIVE'
    };
  });
};

// GET EVENT DETAILS FOR ADMIN
export const getEventDetailsForAdmin = async (eventId) => {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      // Excludes CANCELLED (a corrected batch/module reassignment's stale old
      // registration) and deactivated users (a merged duplicate account,
      // rollNumber rewritten to "MERGED-…") — same ghost-row leak as
      // getWorkshopAnalyticsTable above. WAITLISTED/NO_SHOW stay visible
      // here (unlike the analytics roster) since the admin managing this
      // specific event's registrations needs to see and act on those.
      registrations: {
        where: { status: { not: "CANCELLED" }, user: { isActive: true } },
        include: {
          user: {
            include: {
              studentProfile: true
            }
          }
        },
        orderBy: {
          registeredAt: 'desc'
        }
      },
      availabilityResponses: {
        where: {
          isAvailable: true
        },
        include: {
          user: true
        }
      },
      assignments: {
        where: {
          role: 'VOLUNTEER'
        },
        include: {
          user: true
        }
      },
      attendances: {
        where: {
          status: 'PRESENT'
        },
        include: {
          user: {
            include: {
              studentProfile: true
            }
          }
        },
        orderBy: {
          markedAt: 'desc'
        }
      },
      modules: { select: { id: true } },
      feedbackEntries: { select: { userId: true, eventRating: true, instructorRating: true } },
      _count: {
        select: {
          registrations: { where: { status: { not: "CANCELLED" }, user: { isActive: true } } },
          attendances: {
            where: {
              status: 'PRESENT'
            }
          }
        }
      }
    }
  });

  if (!event) {
    throw new Error("Event not found");
  }

  // Quiz score (from the Google Form webhook, POST /quiz/submit) is stored
  // as ModuleProgress against this event's EventModule(s) — not the event
  // itself — so it has to be looked up separately per student. Same for
  // feedback/rating: it's a submission (via the in-app star widget OR the
  // POST /quiz/feedback webhook), not something registration alone implies.
  const moduleIds = event.modules.map((m) => m.id);
  const studentProfileIds = event.registrations
    .map((r) => r.user.studentProfile?.id)
    .filter(Boolean);

  const moduleProgressRows = moduleIds.length && studentProfileIds.length
    ? await prisma.moduleProgress.findMany({
        where: { moduleId: { in: moduleIds }, studentProfileId: { in: studentProfileIds } },
        select: { studentProfileId: true, marksObtained: true, completedAt: true }
      })
    : [];
  const quizByStudentProfileId = new Map(moduleProgressRows.map((p) => [p.studentProfileId, p]));
  const feedbackByUserId = new Map(event.feedbackEntries.map((f) => [f.userId, f]));

  // A registrant with a PENDING check-in (showed up, instructor just hasn't
  // reviewed it yet) previously looked identical to one who never checked in
  // at all — admin had no way to tell "needs review" apart from "no-show"
  // without opening the check-in review tab separately. Surfaced here per
  // registrant instead. Most recent check-in wins if a student somehow has
  // more than one (e.g. re-checked in for a different module).
  const checkIns = await prisma.eventCheckIn.findMany({
    where: { eventId },
    orderBy: { checkedInAt: "desc" }
  });
  const checkInByUserId = new Map();
  for (const c of checkIns) {
    if (!checkInByUserId.has(c.userId)) checkInByUserId.set(c.userId, c.status);
  }

  const registrantsWithQuizAndFeedback = event.registrations.map((r) => {
    const quiz = r.user.studentProfile ? quizByStudentProfileId.get(r.user.studentProfile.id) : undefined;
    const feedback = feedbackByUserId.get(r.userId);
    return {
      ...r,
      quizScore: quiz?.marksObtained ?? null,
      quizSubmittedAt: quiz?.completedAt ?? null,
      eventRating: feedback?.eventRating ?? null,
      instructorRating: feedback?.instructorRating ?? null,
      checkInStatus: checkInByUserId.get(r.userId) ?? null
    };
  });

  // Format the response.
  // IST is a fixed UTC+5:30 offset (no DST), so shifting the UTC instant by
  // that offset and reading the components back off it as if they were UTC
  // gives the correct IST wall-clock date/time regardless of the server's
  // own timezone — toTimeString()/toISOString() alone would reflect the
  // server's (Render's, i.e. UTC) local time instead, showing e.g. 4:30 AM
  // for a workshop actually scheduled at 10:00 AM IST.
  const istInstant = new Date(event.startAt.getTime() + 5.5 * 60 * 60 * 1000);

  // Total students uploaded via the batch-assignment CSV for this event's
  // course+batch (regardless of whether they've signed up yet) — lets the
  // admin see "12 out of 346" instead of just "12", since registeredCount
  // alone only counts students who already have accounts and are matched.
  const batchUploadTotal = event.courseId && event.batch
    ? await prisma.batchAssignment.count({ where: { courseId: event.courseId, batchCode: event.batch } })
    : 0;

  // Students who signed the physical attendance sheet but have no account
  // yet (see PendingAttendance model) — shown as Present here immediately
  // rather than waiting for them to eventually sign up, so the admin count
  // matches the paper sheet today. Promoted to a real AttendanceRecord once
  // the student's email/roll number matches a verified signup (see
  // autoAssignCohortOnSignup in batchAssignment.service.js).
  const pending = await prisma.pendingAttendance.findMany({
    where: { eventId, isMatched: false, status: "PRESENT" }
  });
  const pendingAsAttendees = pending.map((p) => ({
    id: p.id,
    userId: null,
    status: p.status,
    markedAt: p.createdAt,
    source: p.source,
    isPending: true,
    user: { name: p.name, email: p.email, studentProfile: { rollNumber: p.rollNumber } }
  }));

  return {
    id: event.id,
    title: event.title,
    description: event.description,
    date: istInstant.toISOString().split('T')[0],
    time: istInstant.toISOString().slice(11, 16),
    venue: event.venue,
    mode: event.meetLink ? 'Online' : 'Offline',
    capacity: event.capacity,
    status: event.status.toLowerCase(),
    registeredCount: event._count.registrations,
    batchUploadTotal,
    attendedCount: event._count.attendances + pending.length,
    registrants: registrantsWithQuizAndFeedback,
    volunteers: [...event.availabilityResponses, ...event.assignments],
    attendees: [...event.attendances, ...pendingAsAttendees]
  };
};

// GET PENDING APPROVAL USERS
export const getPendingApprovalUsers = async () => {
  const users = await prisma.user.findMany({
    where: {
      approvalStatus: "PENDING_APPROVAL"
    },
    include: {
      studentProfile: true,
      instructorProfile: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return users;
};

// APPROVE USER
export const approveUser = async (userId) => {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      approvalStatus: "APPROVED",
      isVerified: true
    }
  });

  // Send approval email
  const { sendApprovalEmail } = await import("./email.service.js");
  await sendApprovalEmail(user.email, user.name).catch(err => 
    console.error("Failed to send approval email:", err)
  );

  return user;
};

// DECLINE USER
export const declineUser = async (userId, reason) => {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      approvalStatus: "DECLINED"
    }
  });

  // Send decline email
  const { sendDeclineEmail } = await import("./email.service.js");
  await sendDeclineEmail(user.email, user.name, reason).catch(err => 
    console.error("Failed to send decline email:", err)
  );

  return user;
};
