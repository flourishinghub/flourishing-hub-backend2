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
export const modifyEvent = async (eventId, eventData) => {
  const event = await prisma.event.update({
    where: { id: eventId },
    data: eventData,
    include: {
      modules: true,
      assignments: {
        include: {
          user: true
        }
      }
    }
  });

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
      students: event.registrations.filter(r => r.user.role === 'STUDENT').length,
      volunteers: event.registrations.filter(r => r.isVolunteer).length,
      fillRate: event.capacity > 0 ? Math.round((event._count.registrations / event.capacity) * 100) : 0,
      available: event.capacity - event._count.registrations
    }
  }));
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