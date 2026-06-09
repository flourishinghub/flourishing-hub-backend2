import bcrypt from "bcryptjs";

import { prisma } from "../database/prisma.js";

const PASSWORD = "Test@12345";

const istDateToUtc = (year, month, day, hour, minute = 0) =>
  new Date(Date.UTC(year, month - 1, day, hour - 5, minute - 30));

const nowIst = new Date(
  new Date().toLocaleString("en-US", {
    timeZone: "Asia/Kolkata"
  })
);

const todayYear = nowIst.getFullYear();
const todayMonth = nowIst.getMonth() + 1;
const todayDay = nowIst.getDate();
const tomorrow = new Date(nowIst);
tomorrow.setDate(tomorrow.getDate() + 1);
const yesterday = new Date(nowIst);
yesterday.setDate(yesterday.getDate() - 1);

const users = [
  {
    email: "admin@iitb.ac.in",
    name: "Aarav Admin",
    role: "ADMIN",
    adminProfile: {
      employeeId: "FH-ADMIN-001"
    }
  },
  {
    email: "student@iitb.ac.in",
    name: "Sana Student",
    role: "STUDENT",
    studentProfile: {
      rollNumber: "23CSE101",
      department: "CSE",
      yearOfStudy: 3,
      programme: "BTECH",
      section: "A",
      cohort: "2023",
      joinedAt: new Date("2023-07-15T00:00:00.000Z")
    }
  },
  {
    email: "volunteer@iitb.ac.in",
    name: "Vihaan Volunteer",
    role: "VOLUNTEER",
    studentProfile: {
      rollNumber: "22EE118",
      department: "EE",
      yearOfStudy: 4,
      programme: "BTECH",
      section: "B",
      cohort: "2022",
      joinedAt: new Date("2022-07-15T00:00:00.000Z")
    }
  },
  {
    email: "instructor@iitb.ac.in",
    name: "Dr. Meera Instructor",
    role: "INSTRUCTOR",
    instructorProfile: {
      designation: "Lead Facilitator",
      department: "Humanities and Social Sciences"
    }
  },
  {
    email: "associate.instructor@iitb.ac.in",
    name: "Rohan Associate",
    role: "ASSOCIATE_INSTRUCTOR",
    instructorProfile: {
      designation: "Associate Facilitator",
      department: "Humanities and Social Sciences"
    }
  }
];

const eventConfigs = [
  {
    slug: "mindful-leadership-intensive",
    title: "Mindful Leadership Intensive",
    description:
      "A live event for testing event-day registration, check-in, attendance, and staff coordination.",
    type: "OPEN_WORKSHOP",
    status: "PUBLISHED",
    venue: "Student Activity Centre",
    startAt: istDateToUtc(todayYear, todayMonth, todayDay, 18, 0),
    endAt: istDateToUtc(todayYear, todayMonth, todayDay, 20, 0),
    registrationOpensAt: istDateToUtc(todayYear, todayMonth, todayDay - 5, 9, 0),
    registrationClosesAt: istDateToUtc(todayYear, todayMonth, todayDay, 17, 30),
    capacity: 80,
    volunteersNeeded: 4,
    modules: [
      {
        title: "Session 1: Grounding and Focus",
        description: "Opening session for grounding and practical focus habits.",
        startAt: istDateToUtc(todayYear, todayMonth, todayDay, 18, 0),
        endAt: istDateToUtc(todayYear, todayMonth, todayDay, 19, 0),
        maxMarks: 10
      },
      {
        title: "Session 2: Peer Reflection Circle",
        description: "Interactive reflection and discussion round.",
        startAt: istDateToUtc(todayYear, todayMonth, todayDay, 19, 0),
        endAt: istDateToUtc(todayYear, todayMonth, todayDay, 20, 0),
        maxMarks: 10
      }
    ]
  },
  {
    slug: "resilience-lab-upcoming",
    title: "Resilience Lab",
    description:
      "An upcoming event used to test availability, self-assignment, and new registrations.",
    type: "WELLNESS_COURSE",
    status: "PUBLISHED",
    venue: "Wellness Studio",
    startAt: istDateToUtc(
      tomorrow.getFullYear(),
      tomorrow.getMonth() + 1,
      tomorrow.getDate(),
      17,
      0
    ),
    endAt: istDateToUtc(
      tomorrow.getFullYear(),
      tomorrow.getMonth() + 1,
      tomorrow.getDate(),
      19,
      0
    ),
    registrationOpensAt: istDateToUtc(todayYear, todayMonth, todayDay - 2, 9, 0),
    registrationClosesAt: istDateToUtc(
      tomorrow.getFullYear(),
      tomorrow.getMonth() + 1,
      tomorrow.getDate(),
      16,
      0
    ),
    capacity: 60,
    volunteersNeeded: 3,
    modules: [
      {
        title: "Session 1: Stress Reset",
        description: "Guided resilience reset practice.",
        startAt: istDateToUtc(
          tomorrow.getFullYear(),
          tomorrow.getMonth() + 1,
          tomorrow.getDate(),
          17,
          0
        ),
        endAt: istDateToUtc(
          tomorrow.getFullYear(),
          tomorrow.getMonth() + 1,
          tomorrow.getDate(),
          18,
          0
        ),
        maxMarks: 10
      },
      {
        title: "Session 2: Action Planning",
        description: "Personal action planning module.",
        startAt: istDateToUtc(
          tomorrow.getFullYear(),
          tomorrow.getMonth() + 1,
          tomorrow.getDate(),
          18,
          0
        ),
        endAt: istDateToUtc(
          tomorrow.getFullYear(),
          tomorrow.getMonth() + 1,
          tomorrow.getDate(),
          19,
          0
        ),
        maxMarks: 10
      }
    ]
  },
  {
    slug: "career-clarity-completed",
    title: "Career Clarity Workshop",
    description:
      "A completed event so the student dashboard can show attendance, module completion, and feedback submission.",
    type: "PLACEMENT_WORKSHOP",
    status: "COMPLETED",
    venue: "Seminar Hall 2",
    startAt: istDateToUtc(
      yesterday.getFullYear(),
      yesterday.getMonth() + 1,
      yesterday.getDate(),
      15,
      0
    ),
    endAt: istDateToUtc(
      yesterday.getFullYear(),
      yesterday.getMonth() + 1,
      yesterday.getDate(),
      17,
      0
    ),
    registrationOpensAt: istDateToUtc(
      yesterday.getFullYear(),
      yesterday.getMonth() + 1,
      yesterday.getDate() - 4,
      9,
      0
    ),
    registrationClosesAt: istDateToUtc(
      yesterday.getFullYear(),
      yesterday.getMonth() + 1,
      yesterday.getDate(),
      14,
      0
    ),
    capacity: 100,
    volunteersNeeded: 2,
    modules: [
      {
        title: "Session 1: Career Mapping",
        description: "Goal setting and opportunity mapping.",
        startAt: istDateToUtc(
          yesterday.getFullYear(),
          yesterday.getMonth() + 1,
          yesterday.getDate(),
          15,
          0
        ),
        endAt: istDateToUtc(
          yesterday.getFullYear(),
          yesterday.getMonth() + 1,
          yesterday.getDate(),
          16,
          0
        ),
        maxMarks: 20
      },
      {
        title: "Session 2: Interview Reflection",
        description: "Practice and reflection session.",
        startAt: istDateToUtc(
          yesterday.getFullYear(),
          yesterday.getMonth() + 1,
          yesterday.getDate(),
          16,
          0
        ),
        endAt: istDateToUtc(
          yesterday.getFullYear(),
          yesterday.getMonth() + 1,
          yesterday.getDate(),
          17,
          0
        ),
        maxMarks: 20
      }
    ]
  }
];

const main = async () => {
  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  await prisma.feedback.deleteMany();
  await prisma.attendanceRecord.deleteMany();
  await prisma.eventCheckIn.deleteMany();
  await prisma.moduleProgress.deleteMany();
  await prisma.eventAvailability.deleteMany();
  await prisma.eventStaffAssignment.deleteMany();
  await prisma.eventRegistration.deleteMany();
  await prisma.eventModule.deleteMany();
  await prisma.importJob.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.event.deleteMany({
    where: {
      slug: {
        in: eventConfigs.map((event) => event.slug)
      }
    }
  });

  for (const seedUser of users) {
    const existing = await prisma.user.findUnique({
      where: {
        email: seedUser.email
      }
    });

    const user = existing
      ? await prisma.user.update({
          where: {
            id: existing.id
          },
          data: {
            name: seedUser.name,
            passwordHash,
            role: seedUser.role,
            isActive: true
          }
        })
      : await prisma.user.create({
          data: {
            name: seedUser.name,
            email: seedUser.email,
            passwordHash,
            role: seedUser.role
          }
        });

    if (seedUser.studentProfile) {
      await prisma.studentProfile.upsert({
        where: {
          userId: user.id
        },
        update: seedUser.studentProfile,
        create: {
          userId: user.id,
          ...seedUser.studentProfile
        }
      });
    }

    if (seedUser.instructorProfile) {
      await prisma.instructorProfile.upsert({
        where: {
          userId: user.id
        },
        update: seedUser.instructorProfile,
        create: {
          userId: user.id,
          ...seedUser.instructorProfile
        }
      });
    }

    if (seedUser.adminProfile) {
      await prisma.adminProfile.upsert({
        where: {
          userId: user.id
        },
        update: seedUser.adminProfile,
        create: {
          userId: user.id,
          ...seedUser.adminProfile
        }
      });
    }
  }

  const admin = await prisma.user.findUniqueOrThrow({
    where: {
      email: "admin@iitb.ac.in"
    }
  });
  const student = await prisma.user.findUniqueOrThrow({
    where: {
      email: "student@iitb.ac.in"
    },
    include: {
      studentProfile: true
    }
  });
  const volunteer = await prisma.user.findUniqueOrThrow({
    where: {
      email: "volunteer@iitb.ac.in"
    },
    include: {
      studentProfile: true
    }
  });
  const instructor = await prisma.user.findUniqueOrThrow({
    where: {
      email: "instructor@iitb.ac.in"
    }
  });
  const associate = await prisma.user.findUniqueOrThrow({
    where: {
      email: "associate.instructor@iitb.ac.in"
    }
  });

  const createdEvents = [];

  for (const eventConfig of eventConfigs) {
    const event = await prisma.event.create({
      data: {
        title: eventConfig.title,
        slug: eventConfig.slug,
        description: eventConfig.description,
        type: eventConfig.type,
        status: eventConfig.status,
        venue: eventConfig.venue,
        startAt: eventConfig.startAt,
        endAt: eventConfig.endAt,
        registrationOpensAt: eventConfig.registrationOpensAt,
        registrationClosesAt: eventConfig.registrationClosesAt,
        capacity: eventConfig.capacity,
        volunteersNeeded: eventConfig.volunteersNeeded,
        createdById: admin.id,
        modules: {
          create: eventConfig.modules
        }
      },
      include: {
        modules: {
          orderBy: {
            startAt: "asc"
          }
        }
      }
    });

    createdEvents.push(event);
  }

  const todayEvent = createdEvents.find((event) => event.slug === "mindful-leadership-intensive");
  const upcomingEvent = createdEvents.find((event) => event.slug === "resilience-lab-upcoming");
  const completedEvent = createdEvents.find((event) => event.slug === "career-clarity-completed");

  const todaySession = todayEvent.modules[0];
  const upcomingSession = upcomingEvent.modules[0];
  const completedSession = completedEvent.modules[0];

  await prisma.eventRegistration.createMany({
    data: [
      {
        eventId: todayEvent.id,
        userId: student.id,
        status: "REGISTERED",
        notes: JSON.stringify({
          sessionId: todaySession.id,
          sessionLabel: todaySession.title
        })
      },
      {
        eventId: upcomingEvent.id,
        userId: student.id,
        status: "REGISTERED",
        notes: JSON.stringify({
          sessionId: upcomingSession.id,
          sessionLabel: upcomingSession.title
        })
      },
      {
        eventId: completedEvent.id,
        userId: student.id,
        status: "ATTENDED",
        checkedInAt: new Date(completedSession.startAt.getTime() + 10 * 60 * 1000),
        notes: JSON.stringify({
          sessionId: completedSession.id,
          sessionLabel: completedSession.title
        })
      },
      {
        eventId: todayEvent.id,
        userId: volunteer.id,
        status: "REGISTERED",
        isVolunteer: true,
        notes: JSON.stringify({
          sessionId: todaySession.id,
          sessionLabel: todaySession.title
        })
      }
    ]
  });

  await prisma.eventAvailability.createMany({
    data: [
      {
        eventId: todayEvent.id,
        userId: instructor.id,
        isAvailable: true,
        note: "Available for today evening."
      },
      {
        eventId: todayEvent.id,
        userId: associate.id,
        isAvailable: true,
        note: "Can support both sessions."
      },
      {
        eventId: todayEvent.id,
        userId: volunteer.id,
        isAvailable: true,
        note: "Ready to help at the check-in desk."
      },
      {
        eventId: upcomingEvent.id,
        userId: instructor.id,
        isAvailable: true,
        note: "Open for the upcoming session."
      },
      {
        eventId: upcomingEvent.id,
        userId: associate.id,
        isAvailable: true,
        note: "Available if needed."
      },
      {
        eventId: upcomingEvent.id,
        userId: volunteer.id,
        isAvailable: true,
        note: "Can volunteer tomorrow."
      }
    ]
  });

  await prisma.eventStaffAssignment.createMany({
    data: [
      {
        eventId: todayEvent.id,
        userId: instructor.id,
        role: "INSTRUCTOR",
        assignedById: admin.id,
        notes: "Lead facilitator"
      },
      {
        eventId: todayEvent.id,
        userId: associate.id,
        role: "ASSOCIATE_INSTRUCTOR",
        assignedById: admin.id,
        notes: "Supporting facilitation"
      },
      {
        eventId: todayEvent.id,
        userId: volunteer.id,
        role: "VOLUNTEER",
        assignedById: admin.id,
        notes: "Front desk support"
      },
      {
        eventId: completedEvent.id,
        userId: instructor.id,
        role: "INSTRUCTOR",
        assignedById: admin.id,
        notes: "Completed session lead"
      }
    ]
  });

  await prisma.eventCheckIn.createMany({
    data: [
      {
        eventId: completedEvent.id,
        moduleId: completedSession.id,
        userId: student.id,
        status: "VERIFIED",
        checkedInAt: new Date(completedSession.startAt.getTime() + 10 * 60 * 1000),
        verifiedById: admin.id,
        note: "Checked in on arrival."
      }
    ]
  });

  await prisma.attendanceRecord.createMany({
    data: [
      {
        eventId: completedEvent.id,
        moduleId: completedSession.id,
        userId: student.id,
        status: "PRESENT",
        markedById: admin.id,
        markedAt: new Date(completedSession.endAt.getTime() - 15 * 60 * 1000),
        source: "SEED_SCRIPT"
      }
    ]
  });

  if (student.studentProfile) {
    await prisma.moduleProgress.createMany({
      data: [
        {
          studentProfileId: student.studentProfile.id,
          moduleId: completedEvent.modules[0].id,
          marksObtained: 18,
          completedAt: new Date(completedEvent.modules[0].endAt)
        },
        {
          studentProfileId: student.studentProfile.id,
          moduleId: completedEvent.modules[1].id,
          marksObtained: 17,
          completedAt: new Date(completedEvent.modules[1].endAt)
        }
      ]
    });
  }

  console.log(
    JSON.stringify(
      {
        seeded: true,
        credentials: users.map((user) => ({
          role: user.role,
          email: user.email,
          password: PASSWORD
        })),
        events: createdEvents.map((event) => ({
          title: event.title,
          slug: event.slug,
          status: event.status
        }))
      },
      null,
      2
    )
  );
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
