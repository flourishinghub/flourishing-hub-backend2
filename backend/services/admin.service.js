import { prisma } from "../database/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { StatusCodes } from "http-status-codes";
import { normalizeBatch } from "../utils/normalizeBatch.js";
import { cascadeBundleRegistrationForNewEvent } from "./course.service.js";
import { registerCourseBatchForEvent } from "./batchAssignment.service.js";
import { sendStaffAssignmentEmail } from "./email.service.js";

// Statuses that no longer occupy a seat — excluded from "occupied seat" / capacity counts.
const INACTIVE_REGISTRATION_STATUSES = ["CANCELLED", "NO_SHOW", "WAITLISTED"];

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

const QUIZ_QUESTION_COUNT = 10;

// In-built quiz authored directly on a standalone/open-workshop Event (no
// course/module to hang it off). Course-linked events instead inherit their
// quiz from event.courseModule — see services/courseModule.service.js.
export const getEventQuiz = async (eventId) => {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Event not found");
  }

  const quiz = await prisma.quiz.findUnique({
    where: { eventId },
    include: { questions: { orderBy: { order: "asc" } } }
  });

  return quiz || { eventId, questions: [] };
};

export const upsertEventQuiz = async (eventId, questions) => {
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
  if (!Array.isArray(questions) || questions.length !== QUIZ_QUESTION_COUNT) {
    throw new ApiError(StatusCodes.BAD_REQUEST, `Quiz must have exactly ${QUIZ_QUESTION_COUNT} questions`);
  }

  const quiz = await prisma.quiz.upsert({
    where: { eventId },
    update: {},
    create: { eventId }
  });

  await prisma.$transaction([
    prisma.quizQuestion.deleteMany({ where: { quizId: quiz.id } }),
    prisma.quizQuestion.createMany({
      data: questions.map((q, index) => ({
        quizId: quiz.id,
        order: index,
        questionText: q.questionText,
        optionA: q.optionA,
        optionB: q.optionB,
        optionC: q.optionC,
        optionD: q.optionD,
        correctOption: q.correctOption
      }))
    })
  ]);

  return getEventQuiz(eventId);
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
      course: { select: { id: true, name: true } },
      courseModule: { select: { id: true, title: true } },
      assignments: {
        include: { user: { select: { id: true, name: true, role: true } } }
      },
      registrations: {
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
        select: { status: true, userId: true }
      },
      feedbackEntries: { select: { eventRating: true, userId: true } },
      modules: {
        select: {
          id: true,
          maxMarks: true,
          progressEntries: {
            select: { studentProfileId: true, marksObtained: true, completedAt: true }
          }
        }
      }
    },
    orderBy: { startAt: "desc" }
  });

  return events.map(event => {
    // Build lookup maps
    const attendanceMap = {};
    event.attendances.forEach(a => { attendanceMap[a.userId] = a.status; });

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
        quizCompleted: progress?.completed || false,
        score: progress?.marks ?? null,
        maxScore: progress?.maxMarks ?? null,
        rating: feedbackMap[reg.userId] || null,
        registrationStatus: reg.status
      };
    });

    const instructor = event.assignments.find(a => a.role === "INSTRUCTOR");
    const associateInstructor = event.assignments.find(a => a.role === "ASSOCIATE_INSTRUCTOR");
    const volunteers = event.assignments.filter(a => a.role === "VOLUNTEER");

    const present = students.filter(s => s.attendanceStatus === "PRESENT");
    const ratings = event.feedbackEntries.map(f => f.eventRating).filter(Boolean);
    const avgRating = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : null;

    return {
      id: event.id,
      workshopName: event.title,
      courseName: event.course?.name || "—",
      moduleName: event.courseModule?.title || "—",
      instructorName: instructor?.user?.name || "—",
      instructorId: instructor?.user?.id || null,
      associateInstructorName: associateInstructor?.user?.name || "—",
      associateInstructorId: associateInstructor?.user?.id || null,
      volunteerNames: volunteers.map(v => v.user.name),
      date: event.startAt,
      batch: event.batch || "—",
      venue: event.venue || "—",
      totalRegistered: event.registrations.length,
      totalAttended: present.length,
      totalAbsent: event.attendances.filter(a => a.status === "ABSENT").length,
      avgRating,
      students,
      // Backward compat
      presentStudents: present.map(s => ({ name: s.name, email: s.email, rollNo: s.rollNo })),
      absentStudents: students.filter(s => s.attendanceStatus === "ABSENT").map(s => ({ name: s.name, email: s.email, rollNo: s.rollNo })),
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
        registrations: {
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
    const totalAttended = courseEvents.reduce((s, e) => s + e.attendances.filter(a => a.status === 'PRESENT').length, 0);
    const totalPossible = courseEvents.reduce((s, e) => s + e.registrations.length, 0);
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
    { header: 'Passed', key: 'passed', width: 10 },
    { header: 'Failed', key: 'failed', width: 10 },
    { header: 'Avg Feedback Rating', key: 'rating', width: 20 },
  ];
  sheetB.getRow(1).font = { bold: true };

  for (const event of events) {
    const instructor = event.assignments.find(a => a.role === 'INSTRUCTOR');
    const associate = event.assignments.find(a => a.role === 'ASSOCIATE_INSTRUCTOR');
    const attendedSet = new Set(event.attendances.filter(a => a.status === 'PRESENT').map(a => a.userId));
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
      instructor: instructor?.user?.name || '—',
      associate: associate?.user?.name || '—',
      registered: event.registrations.length,
      attended: attendedSet.size,
      absent: event.registrations.length - attendedSet.size,
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

  const facilitatorMap = {};
  for (const event of events) {
    const ratings = event.feedbackEntries.map(f => f.eventRating).filter(Boolean);
    for (const a of event.assignments) {
      const id = a.user.id;
      if (!facilitatorMap[id]) {
        facilitatorMap[id] = {
          name: a.user.name,
          dept: a.user.instructorProfile?.department || '—',
          role: a.role === 'INSTRUCTOR' ? 'Lead' : 'Associate',
          workshops: 0,
          ratings: []
        };
      }
      facilitatorMap[id].workshops += 1;
      facilitatorMap[id].ratings.push(...ratings);
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
    const attendanceMap = Object.fromEntries(event.attendances.map(a => [a.userId, a]));
    const feedbackMap = Object.fromEntries(event.feedbackEntries.map(f => [f.userId, f.eventRating]));
    const progressMap = {};
    event.modules.forEach(mod => {
      mod.progressEntries.forEach(p => {
        if (!progressMap[p.studentProfileId]) progressMap[p.studentProfileId] = null;
        if (p.marksObtained != null) progressMap[p.studentProfileId] = p.marksObtained;
      });
    });
    const passingScore = event.course?.isCompulsory ? 4 : 3;

    for (const reg of event.registrations) {
      const sp = reg.user.studentProfile;
      const att = attendanceMap[reg.userId];
      const score = sp ? progressMap[sp.id] : null;
      const attStatus = att?.status || 'NOT_MARKED';
      const finalStatus = attStatus === 'PRESENT' ? 'Present' : attStatus === 'ABSENT' ? 'Absent' : 'Not Marked';
      sheetD.addRow({
        name: reg.user.name,
        roll: sp?.rollNumber || '—',
        email: reg.user.email,
        programme: sp?.programme || '—',
        dept: sp?.department || '—',
        // Prefer this event's own course+batch-scoped batch over the student's
        // flat StudentProfile.cohort — see getEventWithRegistrations for why.
        batch: event.batch || sp?.cohort || '—',
        courseCode: event.course?.code || '—',
        workshop: event.title,
        date: fmtDate(event.startAt),
        checkin: att?.markedAt ? fmtDate(att.markedAt) : '—',
        attendance: attStatus,
        score: score != null ? `${score} / 5` : '—',
        rating: feedbackMap[reg.userId] != null ? feedbackMap[reg.userId] : '—',
        status: finalStatus,
      });
    }
  }

  return workbook.xlsx.writeBuffer();
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
      registrations: {
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
          registrations: true,
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

  // Format the response
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    date: event.startAt.toISOString().split('T')[0],
    time: event.startAt.toTimeString().slice(0, 5),
    venue: event.venue,
    mode: event.meetLink ? 'Online' : 'Offline',
    capacity: event.capacity,
    status: event.status.toLowerCase(),
    registeredCount: event._count.registrations,
    attendedCount: event._count.attendances,
    registrants: registrantsWithQuizAndFeedback,
    volunteers: [...event.availabilityResponses, ...event.assignments],
    attendees: event.attendances
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
