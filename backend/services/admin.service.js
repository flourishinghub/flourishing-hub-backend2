import { prisma } from "../database/prisma.js";

// CREATE EVENT
export const createEvent = async (eventData, createdById) => {
  try {
    // Generate unique slug with timestamp to avoid duplicates
    const baseSlug = eventData.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const timestamp = Date.now();
    const uniqueSlug = `${baseSlug}-${timestamp}`;

    console.log("🔧 Creating event with slug:", uniqueSlug);

    const event = await prisma.event.create({
      data: {
        ...eventData,
        createdById,
        slug: uniqueSlug
      },
      include: {
        modules: true,
        createdBy: true
      }
    });

    console.log("✅ Event created successfully in DB:", event.id);
    return event;
  } catch (error) {
    console.error("❌ Error creating event:", error);
    throw error;
  }
};

// MODIFY EVENT
export const modifyEvent = async (eventId, eventData, updatedById) => {
  const { instructorId, associateInstructorId, ...eventFields } = eventData;

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
          registrations: true,
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
      cohort: reg.user.studentProfile?.cohort
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
      _count: {
        select: {
          registrations: true,
          assignments: true,
          attendances: true
        }
      }
    },
    orderBy: { startAt: 'desc' }
  });

  return events.map(event => ({
    ...event,
    attendedCount: event._count.attendances,
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
        cohort: reg.user.studentProfile?.cohort
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
        _count: { select: { registrations: true } }
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
  const events = await prisma.event.findMany({
    where: { status: "COMPLETED" },
    include: {
      course: { select: { id: true, name: true } },
      courseModule: { select: { id: true, title: true } },
      assignments: {
        where: { role: "INSTRUCTOR" },
        include: { user: { select: { id: true, name: true } } },
        take: 1
      },
      registrations: {
        select: { id: true, status: true, userId: true, user: { select: { name: true, email: true, studentProfile: { select: { rollNumber: true } } } } }
      },
      attendances: {
        select: { id: true, status: true, userId: true, user: { select: { name: true, email: true, studentProfile: { select: { rollNumber: true } } } } }
      },
      feedbackEntries: { select: { eventRating: true, instructorRating: true } }
    },
    orderBy: { startAt: "desc" }
  });

  return events.map(event => {
    const totalRegistered = event.registrations.length;
    const present = event.attendances.filter(a => a.status === "PRESENT");
    const absent = event.attendances.filter(a => a.status === "ABSENT");
    const ratings = event.feedbackEntries.map(f => f.eventRating).filter(Boolean);
    const avgRating = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : null;
    const instructorName = event.assignments[0]?.user?.name || "—";

    return {
      id: event.id,
      workshopName: event.title,
      courseName: event.course?.name || "—",
      moduleName: event.courseModule?.title || "—",
      instructorName,
      date: event.startAt,
      batch: event.batch || "—",
      venue: event.venue || "—",
      totalRegistered,
      totalAttended: present.length,
      totalAbsent: absent.length,
      avgRating,
      presentStudents: present.map(a => ({
        name: a.user.name,
        email: a.user.email,
        rollNo: a.user.studentProfile?.rollNumber || "—"
      })),
      absentStudents: absent.map(a => ({
        name: a.user.name,
        email: a.user.email,
        rollNo: a.user.studentProfile?.rollNumber || "—"
      })),
      allRegistrants: event.registrations.map(r => ({
        name: r.user.name,
        email: r.user.email,
        rollNo: r.user.studentProfile?.rollNumber || "—",
        status: r.status
      }))
    };
  });
};

// DELETE EVENT
export const deleteEvent = async (eventId) => {
  const event = await prisma.event.delete({
    where: { id: eventId }
  });

  return event;
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
    registrants: event.registrations,
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
