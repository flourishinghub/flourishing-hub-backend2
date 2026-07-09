import { prisma } from "../database/prisma.js";

// Statuses that no longer occupy a seat — excluded from "occupied seat" counts.
const INACTIVE_REGISTRATION_STATUSES = ["CANCELLED", "NO_SHOW", "WAITLISTED"];

const eventCalendarItem = (event) => ({
  id: event.id,
  title: event.title,
  type: event.type,
  status: event.status,
  venue: event.venue,
  startAt: event.startAt,
  endAt: event.endAt
});

// STUDENT DASHBOARD API
export const getStudentDashboardData = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { 
      studentProfile: true 
    }
  });

  if (!user?.studentProfile) {
    throw new Error("Student profile not found");
  }

  const [registrations, moduleProgress, attendanceRecords, allEvents] = await Promise.all([
    // Event Registrations
    prisma.eventRegistration.findMany({
      where: { userId },
      include: {
        event: {
          include: {
            modules: true
          }
        }
      },
      orderBy: { registeredAt: "desc" }
    }),
    
    // Module Progress (Marks + Feedback)
    prisma.moduleProgress.findMany({
      where: {
        studentProfile: {
          userId
        }
      },
      include: {
        module: {
          include: {
            event: true
          }
        }
      },
      orderBy: { updatedAt: "desc" }
    }),
    
    // Attendance Records
    prisma.attendanceRecord.findMany({
      where: { userId },
      include: {
        event: true,
        module: true
      },
      orderBy: { markedAt: "desc" }
    }),
    
    // All Events for Calendar
    prisma.event.findMany({
      where: {
        status: "PUBLISHED"
      },
      include: {
        registrations: {
          where: { userId }
        }
      },
      orderBy: { startAt: "asc" }
    })
  ]);

  // Basic Info
  const basicInfo = {
    name: user.name,
    rollNumber: user.studentProfile.rollNumber,
    department: user.studentProfile.department,
    yearOfStudy: user.studentProfile.yearOfStudy,
    programme: user.studentProfile.programme
  };

  // Event Status
  const registeredEvents = registrations.filter(r => r.status === "REGISTERED");
  const completedEvents = registrations.filter(r => r.status === "ATTENDED");
  const upcomingEvents = registeredEvents.filter(r => new Date(r.event.startAt) > new Date());

  // Past Records (attended events)
  const attendedEvents = registrations.filter(r => r.status === "ATTENDED");

  // Marks + Feedback
  const marksAndFeedback = moduleProgress.map(mp => ({
    moduleTitle: mp.module.title,
    eventTitle: mp.module.event.title,
    marksObtained: mp.marksObtained,
    maxMarks: mp.module.maxMarks,
    completedAt: mp.completedAt
  }));

  // Calendar Data
  const calendarData = allEvents.map(event => ({
    ...eventCalendarItem(event),
    isRegistered: event.registrations.length > 0
  }));

  return {
    basicInfo,
    eventStatus: {
      registeredEvents: registeredEvents.length,
      completedEvents: completedEvents.length,
      upcomingEvents: upcomingEvents.length
    },
    pastRecords: attendedEvents,
    marksAndFeedback,
    calendarData
  };
};

// INSTRUCTOR DASHBOARD API
export const getInstructorDashboardData = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { 
      instructorProfile: true 
    }
  });

  if (!user?.instructorProfile) {
    throw new Error("Instructor profile not found");
  }

  const [assignments, upcomingSessions, pastSessions, allEvents, attendanceRecords] = await Promise.all([
    // Staff Assignments
    prisma.eventStaffAssignment.findMany({
      where: { 
        userId,
        role: "INSTRUCTOR"
      },
      include: {
        event: {
          include: {
            modules: true
          }
        }
      },
      orderBy: { createdAt: "desc" }
    }),
    
    // Upcoming Sessions — "upcoming" means "not finished yet" (endAt >= now),
    // not "not started yet" (startAt >= now), so a session that's currently
    // live stays here instead of jumping to Past Sessions the moment it starts.
    prisma.eventModule.findMany({
      where: {
        endAt: { gte: new Date() },
        event: {
          assignments: {
            some: {
              userId,
              role: "INSTRUCTOR"
            }
          }
        }
      },
      include: {
        event: true
      },
      orderBy: { startAt: "asc" }
    }),

    // Past Sessions — mirrors the endAt cutoff above so a live session
    // (started, not yet ended) never appears in both buckets at once.
    prisma.eventModule.findMany({
      where: {
        endAt: { lt: new Date() },
        event: {
          assignments: {
            some: {
              userId,
              role: "INSTRUCTOR"
            }
          }
        }
      },
      include: {
        event: true
      },
      orderBy: { startAt: "desc" }
    }),
    
    // All Events for Calendar
    prisma.event.findMany({
      where: {
        assignments: {
          some: {
            userId,
            role: "INSTRUCTOR"
          }
        }
      },
      include: {
        modules: true
      },
      orderBy: { startAt: "asc" }
    }),

    // Real "students impacted" count — distinct students marked PRESENT across
    // events this instructor is assigned to (replaces the old fabricated
    // pastSessions.length * 20 placeholder on the frontend)
    prisma.attendanceRecord.findMany({
      where: {
        status: "PRESENT",
        event: { assignments: { some: { userId, role: "INSTRUCTOR" } } }
      },
      select: { userId: true }
    })
  ]);

  const studentsImpacted = new Set(attendanceRecords.map((r) => r.userId)).size;

  // Basic Info
  const basicInfo = {
    name: user.name,
    designation: user.instructorProfile.designation,
    department: user.instructorProfile.department
  };

  // Upcoming Sessions with venue, time, mode
  const upcomingSessionsData = upcomingSessions.map(session => ({
    id: session.id,
    title: session.title,
    eventTitle: session.event.title,
    courseId: session.event.courseId,
    venue: session.venue || session.event.venue,
    startAt: session.startAt,
    endAt: session.endAt,
    mode: session.meetLink ? "online" : "offline",
    meetLink: session.meetLink
  }));

  // Past Sessions
  const pastSessionsData = pastSessions.map(session => ({
    id: session.id,
    title: session.title,
    eventTitle: session.event.title,
    courseId: session.event.courseId,
    venue: session.venue || session.event.venue,
    startAt: session.startAt,
    endAt: session.endAt,
    mode: session.meetLink ? "online" : "offline"
  }));

  // Calendar Data
  const calendarData = allEvents.map(event => eventCalendarItem(event));

  return {
    basicInfo,
    upcomingSessions: upcomingSessionsData,
    pastSessions: pastSessionsData,
    calendarData,
    studentsImpacted
  };
};

// VOLUNTEER DASHBOARD API
export const getVolunteerDashboardData = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId }
  });

  const [allEvents, volunteerInterests, volunteerAssignments, attendanceRecords, registeredEvents] = await Promise.all([
    // All available events (for volunteering)
    prisma.event.findMany({
      where: {
        status: "PUBLISHED",
        startAt: { gte: new Date() }
      },
      orderBy: { startAt: "asc" },
      take: 20
    }),
    
    // Volunteer interest registrations (expressed interest)
    prisma.eventAvailability.findMany({
      where: { 
        userId,
        isAvailable: true
      },
      include: {
        event: true
      },
      orderBy: { respondedAt: "desc" }
    }),
    
    // Actual assignments (selected by admin)
    prisma.eventStaffAssignment.findMany({
      where: { 
        userId,
        role: "VOLUNTEER"
      },
      include: {
        event: {
          include: {
            assignments: {
              where: {
                role: "INSTRUCTOR"
              },
              include: {
                user: true
              }
            }
          }
        }
      },
      orderBy: { createdAt: "desc" }
    }),
    
    // Attendance records (workshops attended as participant)
    prisma.attendanceRecord.findMany({
      where: { 
        userId,
        status: "PRESENT"
      },
      include: {
        event: {
          include: {
            assignments: {
              where: {
                role: "INSTRUCTOR"
              },
              include: {
                user: true
              }
            }
          }
        }
      }
    }),
    
    // Registered events (as participant/student)
    prisma.eventRegistration.findMany({
      where: { 
        userId,
        status: "REGISTERED"
      },
      include: {
        event: {
          include: {
            assignments: {
              where: {
                role: "INSTRUCTOR"
              },
              include: {
                user: true
              }
            }
          }
        }
      },
      orderBy: { registeredAt: "desc" }
    })
  ]);

  // Separate assignments by status
  const assignedDuties = volunteerAssignments.filter(a => 
    new Date(a.event.startAt) > new Date()
  );
  
  const completedDuties = volunteerAssignments.filter(a => 
    new Date(a.event.endAt) < new Date()
  );

  // Calculate hours volunteered (from completed duties)
  const hoursVolunteered = completedDuties.reduce((total, assignment) => {
    const event = assignment.event;
    if (event.startAt && event.endAt) {
      const hours = (new Date(event.endAt).getTime() - new Date(event.startAt).getTime()) / (1000 * 60 * 60);
      return total + hours;
    }
    return total;
  }, 0);

  // Count workshops attended (as participant, not volunteer)
  const workshopsAttended = attendanceRecords.length;

  // Get interested event IDs
  const interestedEventIds = volunteerInterests.map(vi => vi.eventId);
  const assignedEventIds = volunteerAssignments.map(va => va.eventId);
  const registeredEventIds = registeredEvents.map(reg => reg.eventId);

  // Format available events
  const availableEvents = allEvents.map(event => ({
    id: event.id,
    title: event.title,
    startAt: event.startAt,
    endAt: event.endAt,
    venue: event.venue,
    status: assignedEventIds.includes(event.id) 
      ? 'ASSIGNED' 
      : interestedEventIds.includes(event.id) 
      ? 'INTERESTED' 
      : registeredEventIds.includes(event.id)
      ? 'REGISTERED'
      : 'AVAILABLE'
  }));

  // Format assigned duties (My Duties section) - VOLUNTEERING
  const myDuties = assignedDuties.map(assignment => ({
    eventId: assignment.eventId,
    title: assignment.event.title,
    date: assignment.event.startAt,
    venue: assignment.event.venue,
    role: assignment.role || 'VOLUNTEER',
    status: 'ASSIGNED',
    type: 'VOLUNTEERING'
  }));

  // Format registered events (as participant) - ATTENDING
  const myRegistrations = registeredEvents
    .filter(reg => new Date(reg.event.startAt) > new Date())
    .map(reg => ({
      eventId: reg.eventId,
      title: reg.event.title,
      date: reg.event.startAt,
      venue: reg.event.venue,
      role: 'PARTICIPANT',
      status: 'REGISTERED',
      type: 'ATTENDING'
    }));

  // Combine both volunteering and attending commitments
  const allCommitments = [...myDuties, ...myRegistrations].sort((a, b) => 
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  // Format completed duties (volunteering)
  const completedVolunteerEvents = completedDuties.map(assignment => {
    const instructor = assignment.event.assignments.find(a => a.role === 'INSTRUCTOR');
    return {
      eventId: assignment.eventId,
      title: assignment.event.title,
      date: assignment.event.startAt,
      venue: assignment.event.venue,
      role: assignment.role || 'VOLUNTEER',
      instructorName: instructor ? instructor.user.name : 'N/A',
      engagementType: 'VOLUNTEERING',
      marks: null,
      maxMarks: null,
      starRating: null
    };
  });

  // Format completed attendance (as participant)
  const completedAttendanceEvents = attendanceRecords
    .filter(record => new Date(record.event.endAt) < new Date())
    .map(record => {
      const instructor = record.event.assignments.find(a => a.role === 'INSTRUCTOR');
      return {
        eventId: record.eventId,
        title: record.event.title,
        date: record.event.startAt,
        venue: record.event.venue,
        role: 'PARTICIPANT',
        instructorName: instructor ? instructor.user.name : 'N/A',
        engagementType: 'ATTENDING',
        marks: null,
        maxMarks: null,
        starRating: null
      };
    });

  // Combine all completed events
  const allCompletedEvents = [...completedVolunteerEvents, ...completedAttendanceEvents].sort((a, b) => 
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  return {
    name: user.name,
    rollNo: user.employeeId || 'N/A',
    programme: 'Volunteer',
    department: 'N/A',
    year: 1,
    batch: 'N/A',
    sessionsVolunteered: volunteerAssignments.length,
    completedDuties: completedDuties.length,
    hoursVolunteered: Math.round(hoursVolunteered),
    workshopsAttended: workshopsAttended,
    availableEvents: availableEvents,
    myDuties: myDuties,
    myCommitments: allCommitments,
    completedEvents: allCompletedEvents,
    interestedEventIds: interestedEventIds,
    assignedEventIds: assignedEventIds
  };
};

// ASSOCIATE INSTRUCTOR DASHBOARD API
export const getAssociateDashboardData = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId }
  });

  const [assignments, registrants, attendanceRecords, volunteerPool] = await Promise.all([
    // Associate Instructor Assignments
    prisma.eventStaffAssignment.findMany({
      where: { 
        userId,
        role: "ASSOCIATE_INSTRUCTOR"
      },
      include: {
        event: {
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
            }
          }
        }
      },
      orderBy: { createdAt: "desc" }
    }),
    
    // Event Registrations for assigned events
    prisma.eventRegistration.findMany({
      where: {
        event: {
          assignments: {
            some: {
              userId,
              role: "ASSOCIATE_INSTRUCTOR"
            }
          }
        }
      },
      include: {
        user: {
          include: {
            studentProfile: true
          }
        },
        event: true
      },
      orderBy: { registeredAt: "desc" }
    }),
    
    // Attendance Records for assigned events
    prisma.attendanceRecord.findMany({
      where: {
        event: {
          assignments: {
            some: {
              userId,
              role: "ASSOCIATE_INSTRUCTOR"
            }
          }
        }
      },
      include: {
        user: {
          include: {
            studentProfile: true
          }
        },
        event: true,
        module: true
      },
      orderBy: { markedAt: "desc" }
    }),
    
    // Volunteer Pool (Event Availability)
    prisma.eventAvailability.findMany({
      where: {
        isAvailable: true,
        event: {
          assignments: {
            some: {
              userId,
              role: "ASSOCIATE_INSTRUCTOR"
            }
          }
        }
      },
      include: {
        user: true,
        event: true
      },
      orderBy: { respondedAt: "desc" }
    })
  ]);

  // Basic Info
  const basicInfo = {
    name: user.name,
    email: user.email
  };

  // List of Registrants
  const registrantsList = registrants.map(reg => ({
    id: reg.id,
    userName: reg.user.name,
    userEmail: reg.user.email,
    rollNumber: reg.user.studentProfile?.rollNumber,
    department: reg.user.studentProfile?.department,
    eventTitle: reg.event.title,
    status: reg.status,
    registeredAt: reg.registeredAt,
    isVolunteer: reg.isVolunteer
  }));

  // Attendance Control Access
  const attendanceControlAccess = attendanceRecords.map(record => ({
    id: record.id,
    userName: record.user.name,
    rollNumber: record.user.studentProfile?.rollNumber,
    eventTitle: record.event.title,
    moduleTitle: record.module?.title,
    status: record.status,
    markedAt: record.markedAt,
    canModify: true // Associate instructors can mark attendance
  }));

  // Volunteer Pool
  const volunteerPoolData = volunteerPool.map(vol => ({
    id: vol.id,
    userName: vol.user.name,
    userEmail: vol.user.email,
    eventTitle: vol.event.title,
    isAvailable: vol.isAvailable,
    note: vol.note,
    respondedAt: vol.respondedAt
  }));

  // Abilities
  const abilities = {
    canMarkAttendance: true,
    canSelectVolunteers: true,
    canActivateQuizFeedback: true // This would be a flag-only operation
  };

  return {
    basicInfo,
    registrants: registrantsList,
    attendanceControlAccess,
    volunteerPool: volunteerPoolData,
    abilities
  };
};

// ADMIN DASHBOARD API
export const getAdminDashboardData = async () => {
  try {
    const [
      totalUsers,
      totalEvents,
      totalRegistrations,
      attendanceStats,
      eventsByType,
      usersByRole,
      recentActivity
    ] = await Promise.all([
      // Total Users
      prisma.user.count({
        where: { isActive: true }
      }),
      
      // Total Events
      prisma.event.count(),
      
      // Total Registrations
      prisma.eventRegistration.count(),
      
      // Attendance Stats
      prisma.attendanceRecord.groupBy({
        by: ["status"],
        _count: {
          _all: true
        }
      }),
      
      // Events by Type
      prisma.event.groupBy({
        by: ["type"],
        _count: {
          _all: true
        }
      }),
      
      // Users by Role
      prisma.user.groupBy({
        by: ["role"],
        _count: {
          _all: true
        },
        where: { isActive: true }
      }),
      
      // Recent Activity (last 10 registrations)
      prisma.eventRegistration.findMany({
        take: 10,
        include: {
          user: {
            include: {
              studentProfile: true
            }
          },
          event: true
        },
        orderBy: { registeredAt: "desc" }
      })
    ]);

    const attendanceStatsFormatted = {
      present: attendanceStats.find(stat => stat.status === "PRESENT")?._count._all || 0,
      absent: attendanceStats.find(stat => stat.status === "ABSENT")?._count._all || 0,
      excused: attendanceStats.find(stat => stat.status === "EXCUSED")?._count._all || 0
    };

    return {
      totals: {
        totalUsers,
        totalEvents,
        totalRegistrations
      },
      attendanceStats: attendanceStatsFormatted,
      eventsByType,
      usersByRole,
      recentActivity: recentActivity.map(activity => ({
        id: activity.id,
        userName: activity.user.name,
        rollNumber: activity.user.studentProfile?.rollNumber,
        eventTitle: activity.event.title,
        registeredAt: activity.registeredAt,
        status: activity.status
      }))
    };
  } catch (error) {
    console.error('Error in getAdminDashboardData:', error);
    throw error;
  }
};

// STUDENT BUNDLE PROGRESS API
export const getStudentBundleProgress = async (userId) => {
  const [courses, attendedByEvent, attendedByReg, myRegistrations] = await Promise.all([
    prisma.course.findMany({
      where: { status: "ACTIVE" },
      include: {
        events: {
          where: { status: { in: ["PUBLISHED", "COMPLETED"] } },
          select: { id: true, title: true, startAt: true, batch: true, courseModuleId: true },
          orderBy: { startAt: "asc" },
        },
        modules: {
          where: { isActive: true },
          select: { id: true, title: true, order: true },
          orderBy: { order: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.attendanceRecord.findMany({
      where: { userId, status: "PRESENT" },
      select: { eventId: true },
    }),
    prisma.eventRegistration.findMany({
      where: { userId, status: "ATTENDED" },
      select: { eventId: true },
    }),
    // userId is the leftmost column of @@index([userId, registeredAt]) on
    // EventRegistration, so this is a single indexed lookup, not a scan.
    prisma.eventRegistration.findMany({
      where: { userId },
      select: { eventId: true },
    }),
  ]);

  const attendedIds = new Set([
    ...attendedByEvent.map((r) => r.eventId),
    ...attendedByReg.map((r) => r.eventId),
  ]);
  const registeredEventIds = new Set(myRegistrations.map((r) => r.eventId));

  return courses
    .map((course) => {
      // Only count workshops this student is actually registered for — a
      // course previously showed every one of its workshops to every
      // student regardless of registration, so a batch that was never
      // enrolled in a bundle still saw it at 0% instead of not seeing it
      // at all.
      const myWorkshops = course.events.filter((e) => registeredEventIds.has(e.id));
      if (myWorkshops.length === 0) return null;

      const attended = myWorkshops.filter((e) => attendedIds.has(e.id)).length;

      // Compulsory bundle courses: template modules with no scheduled event
      // yet (for this student's batch, or at all) are still part of their
      // bundle — surfaced as pending so totalWorkshops reflects the whole
      // bundle, not just whatever has been scheduled so far.
      let pendingWorkshops = [];
      if (course.isCompulsory) {
        const studentBatch = myWorkshops.find((w) => w.batch)?.batch ?? null;
        const scheduledModuleIds = new Set(
          course.events
            .filter((e) => e.courseModuleId && (e.batch === studentBatch || !e.batch))
            .map((e) => e.courseModuleId)
        );
        pendingWorkshops = course.modules
          .filter((m) => !scheduledModuleIds.has(m.id))
          .map((m) => ({ id: m.id, title: m.title }));
      }

      const total = myWorkshops.length + pendingWorkshops.length;
      return {
        courseId: course.id,
        courseName: course.name,
        isCompulsory: course.isCompulsory,
        totalWorkshops: total,
        attended,
        percentage: total > 0 ? Math.round((attended / total) * 100) : 0,
        pendingWorkshops,
      };
    })
    .filter(Boolean);
};

// INSTRUCTOR FEEDBACK PORTAL API
export const getInstructorFeedback = async (userId) => {
  const assignments = await prisma.eventStaffAssignment.findMany({
    // Associate instructors run the workshop alongside the lead instructor and should
    // see feedback for their sessions too — not just users with the INSTRUCTOR role.
    where: { userId, role: { in: ["INSTRUCTOR", "ASSOCIATE_INSTRUCTOR"] } },
    include: {
      event: {
        include: {
          feedbackEntries: {
            select: {
              eventRating: true,
              instructorRating: true,
              eventComment: true,
              instructorComment: true,
              createdAt: true,
            },
          },
          _count: {
            select: {
              registrations: { where: { status: { notIn: INACTIVE_REGISTRATION_STATUSES } } }
            }
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return assignments.map((a) => {
    const fb = a.event.feedbackEntries;
    const withInstructorRating = fb.filter((f) => f.instructorRating != null);
    const avgEvent = fb.length ? fb.reduce((s, f) => s + f.eventRating, 0) / fb.length : null;
    const avgInstructor = withInstructorRating.length
      ? withInstructorRating.reduce((s, f) => s + f.instructorRating, 0) / withInstructorRating.length
      : null;

    return {
      eventId: a.eventId,
      eventTitle: a.event.title,
      totalRegistrations: a.event._count.registrations,
      totalFeedback: fb.length,
      avgEventRating: avgEvent !== null ? Math.round(avgEvent * 10) / 10 : null,
      avgInstructorRating: avgInstructor !== null ? Math.round(avgInstructor * 10) / 10 : null,
      comments: fb
        .filter((f) => f.instructorComment || f.eventComment)
        .map((f) => ({
          eventComment: f.eventComment || null,
          instructorComment: f.instructorComment || null,
          createdAt: f.createdAt,
        })),
    };
  });
};

// VOLUNTEER REAL-TIME CAPACITY API
export const getVolunteerCapacity = async (userId) => {
  const assignments = await prisma.eventStaffAssignment.findMany({
    where: { userId, role: "VOLUNTEER" },
    include: {
      event: {
        include: {
          _count: {
            select: {
              registrations: { where: { status: { notIn: INACTIVE_REGISTRATION_STATUSES } } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const eventIds = assignments.map((a) => a.eventId);

  const checkedInCounts = await prisma.eventRegistration.groupBy({
    by: ["eventId"],
    where: { eventId: { in: eventIds }, status: "ATTENDED" },
    _count: { _all: true },
  });

  const checkedInMap = new Map(checkedInCounts.map((c) => [c.eventId, c._count._all]));

  return assignments.map((a) => ({
    eventId: a.eventId,
    title: a.event.title,
    venue: a.event.venue,
    startAt: a.event.startAt,
    endAt: a.event.endAt,
    status: a.event.status,
    capacity: a.event.capacity,
    totalRegistered: a.event._count.registrations,
    checkedIn: checkedInMap.get(a.eventId) || 0,
  }));
};

// LEGACY FUNCTIONS (keeping for backward compatibility)
export const getStudentDashboard = async (userId) => {
  const [user, registrations, completedProgress, pendingModules, openEvents] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      include: { studentProfile: true }
    }),
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
    }),
    prisma.moduleProgress.findMany({
      where: {
        studentProfile: {
          userId
        },
        completedAt: {
          not: null
        }
      },
      include: {
        module: {
          include: {
            event: true
          }
        }
      },
      orderBy: {
        completedAt: "desc"
      }
    }),
    prisma.eventModule.findMany({
      where: {
        startAt: {
          gte: new Date()
        },
        event: {
          registrations: {
            some: {
              userId
            }
          }
        }
      },
      include: {
        event: true
      },
      orderBy: {
        startAt: "asc"
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
        modules: true,
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

  const registeredEvents = registrations.map((entry) => entry.event);
  const calendarEntries = registeredEvents
    .map(eventCalendarItem)
    .sort((left, right) => left.startAt.getTime() - right.startAt.getTime());

  const activityLogs = [
    ...completedProgress.map((entry) => ({
      type: "MODULE_COMPLETED",
      title: entry.module.title,
      eventTitle: entry.module.event.title,
      at: entry.completedAt,
      marksObtained: entry.marksObtained
    })),
    ...registrations.map((entry) => ({
      type: "EVENT_REGISTRATION",
      title: entry.event.title,
      at: entry.registeredAt,
      status: entry.status
    }))
  ].sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime());

  return {
    basicInfo: user,
    activeCourseProgress: {
      completedModules: completedProgress,
      totalModules: completedProgress.length + pendingModules.length
    },
    pendingModules,
    openEvents,
    registeredEvents: registrations,
    pastRecords: registrations.filter((entry) => ["ATTENDED", "NO_SHOW"].includes(entry.status)),
    schedule: pendingModules,
    calendar: {
      upcoming: calendarEntries.filter((entry) => entry.startAt >= new Date()),
      past: calendarEntries.filter((entry) => entry.startAt < new Date())
    },
    activityLogs
  };
};

export const getStaffDashboard = async (userId) => {
  const [user, upcomingEvents, assignedEvents, availabilityResponses] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      include: { instructorProfile: true, studentProfile: true }
    }),
    prisma.event.findMany({
      where: {
        status: "PUBLISHED",
        startAt: {
          gte: new Date()
        }
      },
      include: {
        assignments: {
          where: {
            userId
          }
        },
        availabilityResponses: {
          where: {
            userId
          }
        },
        _count: {
          select: {
            registrations: true,
            attendances: true
          }
        }
      },
      orderBy: {
        startAt: "asc"
      },
      take: 20
    }),
    prisma.event.findMany({
      where: {
        assignments: {
          some: {
            userId
          }
        }
      },
      include: {
        _count: {
          select: {
            registrations: true,
            attendances: true
          }
        }
      },
      orderBy: {
        startAt: "asc"
      }
    }),
    prisma.eventAvailability.findMany({
      where: { userId },
      include: {
        event: true
      },
      orderBy: {
        respondedAt: "desc"
      }
    })
  ]);

  return {
    basicInfo: user,
    upcomingEvents,
    assignedEvents,
    availabilityResponses,
    schedule: upcomingEvents,
    currentStatus: {
      totalAssignedEvents: assignedEvents.length,
      totalAvailabilityResponses: availabilityResponses.length
    }
  };
};

export const getAdminDashboard = async () => {
  const [
    totalUsers,
    totalEvents,
    totalRegistrations,
    pendingCheckIns,
    activeVolunteers,
    eventsByType,
    engagementByDepartment,
    feedbackStats
  ] = await Promise.all([
    prisma.user.count(),
    prisma.event.count(),
    prisma.eventRegistration.count(),
    prisma.eventCheckIn.count({
      where: {
        status: "PENDING"
      }
    }),
    prisma.eventStaffAssignment.count({
      where: {
        role: "VOLUNTEER"
      }
    }),
    prisma.event.groupBy({
      by: ["type"],
      _count: {
        _all: true
      }
    }),
    prisma.studentProfile.groupBy({
      by: ["department"],
      _count: {
        _all: true
      }
    }),
    prisma.feedback.aggregate({
      _avg: {
        eventRating: true,
        instructorRating: true
      },
      _count: {
        _all: true
      }
    })
  ]);

  return {
    totals: {
      totalUsers,
      totalEvents,
      totalRegistrations,
      pendingCheckIns,
      activeVolunteers
    },
    eventsByType,
    engagementByDepartment,
    feedbackStats
  };
};
