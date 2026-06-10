import { StatusCodes } from "http-status-codes";

import { prisma } from "../database/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { toCsv } from "../utils/csv.js";
import { createWorkbookBuffer } from "../utils/excel.js";
import { buildPagination } from "../utils/pagination.js";
import { slugify } from "../utils/slugify.js";

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

const publicEventInclude = {
  modules: {
    orderBy: {
      startAt: "asc"
    }
  },
  _count: {
    select: {
      registrations: true,
      attendances: true,
      availabilityResponses: true
    }
  }
};

const mapModulePayload = (moduleItem, eventStartAt) => {
  const startAt = moduleItem.startAt
    ? new Date(moduleItem.startAt)
    : new Date(eventStartAt.getTime() + (moduleItem.startOffsetDays || 0) * 24 * 60 * 60 * 1000);
  const endAt = moduleItem.endAt
    ? new Date(moduleItem.endAt)
    : new Date(startAt.getTime() + (moduleItem.durationMinutes || 60) * 60 * 1000);

  return {
    title: moduleItem.title,
    description: moduleItem.description,
    venue: moduleItem.venue,
    meetLink: moduleItem.meetLink,
    startAt,
    endAt,
    maxMarks: moduleItem.maxMarks,
    quizLink: moduleItem.quizLink,
    feedbackLink: moduleItem.feedbackLink
  };
};

const resolveTemplateModules = async (payload) => {
  if (!payload.templateId) {
    return payload.modules || [];
  }

  const template = await prisma.eventTemplate.findUnique({
    where: { id: payload.templateId }
  });

  if (!template) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Event template not found");
  }

  if (payload.modules?.length) {
    return payload.modules;
  }

  return Array.isArray(template.defaultModules) ? template.defaultModules : [];
};

export const createEvent = async (payload, createdById) => {
  const baseSlug = slugify(payload.title);
  const slug = `${baseSlug}-${Date.now()}`;
  const startAt = new Date(payload.startAt);
  const rawEndAt = new Date(payload.endAt);
  const endAt = rawEndAt <= startAt
    ? new Date(startAt.getTime() + 2 * 60 * 60 * 1000)
    : rawEndAt;
  const templateModules = await resolveTemplateModules(payload);

  const event = await prisma.event.create({
    data: {
      title: payload.title,
      slug,
      description: payload.description,
      type: payload.type,
      status: payload.status,
      bannerImageUrl: payload.bannerImageUrl,
      venue: payload.venue,
      meetLink: payload.meetLink,
      startAt,
      endAt,
      registrationOpensAt: payload.registrationOpensAt ? new Date(payload.registrationOpensAt) : undefined,
      registrationClosesAt: payload.registrationClosesAt ? new Date(payload.registrationClosesAt) : undefined,
      capacity: payload.capacity,
      volunteersNeeded: payload.volunteersNeeded,
      isCampusWide: payload.isCampusWide ?? true,
      allowVolunteerSignup: payload.allowVolunteerSignup ?? true,
      requiresCheckIn: payload.requiresCheckIn ?? true,
      templateId: payload.templateId,
      createdById,
      modules: templateModules.length
        ? {
            create: templateModules.map((moduleItem) => mapModulePayload(moduleItem, startAt))
          }
        : undefined
    },
    include: {
      modules: true,
      createdBy: { select: { id: true, name: true, email: true } }
    }
  });

  // Create staff assignments for instructor and associate instructor
  const staffToAssign = [
    payload.instructorId && { userId: payload.instructorId, role: "INSTRUCTOR" },
    payload.associateInstructorId && { userId: payload.associateInstructorId, role: "ASSOCIATE_INSTRUCTOR" },
  ].filter(Boolean);

  if (staffToAssign.length) {
    await prisma.eventStaffAssignment.createMany({
      data: staffToAssign.map((s) => ({
        eventId: event.id,
        userId: s.userId,
        role: s.role,
        assignedById: createdById,
      })),
      skipDuplicates: true,
    });
  }

  return event;
};

export const listEvents = async (query) => {
  const pagination = buildPagination(query.page, query.limit);

  const where = {
    status: query.status || "PUBLISHED",
    ...(query.type ? { type: query.type } : {}),
    // By default exclude events that fully ended (endAt < now), unless caller passes activeOnly=false
    ...(query.activeOnly !== "false"
      ? { endAt: { gte: new Date() } }
      : {}),
    ...(query.upcomingOnly === "true"
      ? {
          startAt: {
            gte: new Date()
          }
        }
      : {}),
    ...(query.from || query.to
      ? {
          startAt: {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lte: new Date(query.to) } : {})
          }
        }
      : {})
  };

  const [items, total] = await Promise.all([
    prisma.event.findMany({
      where,
      include: publicEventInclude,
      skip: pagination.skip,
      take: pagination.limit,
      orderBy: { startAt: "asc" }
    }),
    prisma.event.count({ where })
  ]);

  return {
    items,
    total,
    page: pagination.page,
    limit: pagination.limit
  };
};

export const getEventById = async (eventId) =>
  prisma.event.findUnique({
    where: { id: eventId },
    include: publicEventInclude
  });

export const updateEvent = async (eventId, payload) => {
  const existingEvent = await prisma.event.findUnique({
    where: { id: eventId }
  });

  if (!existingEvent) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Event not found");
  }

  const moduleData = payload.modules
    ? {
        deleteMany: {},
        create: payload.modules.map((moduleItem) =>
          mapModulePayload(
            moduleItem,
            payload.startAt ? new Date(payload.startAt) : existingEvent.startAt
          )
        )
      }
    : undefined;

  const updatedEvent = await prisma.event.update({
    where: { id: eventId },
    data: {
      ...(payload.title ? { title: payload.title, slug: `${slugify(payload.title)}-${Date.now()}` } : {}),
      ...(payload.description ? { description: payload.description } : {}),
      ...(payload.type ? { type: payload.type } : {}),
      ...(payload.status ? { status: payload.status } : {}),
      ...(payload.bannerImageUrl !== undefined ? { bannerImageUrl: payload.bannerImageUrl } : {}),
      ...(payload.venue !== undefined ? { venue: payload.venue } : {}),
      ...(payload.meetLink !== undefined ? { meetLink: payload.meetLink } : {}),
      ...(payload.startAt ? { startAt: new Date(payload.startAt) } : {}),
      ...(payload.endAt ? {
        endAt: (() => {
          const s = payload.startAt ? new Date(payload.startAt) : null;
          const e = new Date(payload.endAt);
          return s && e <= s ? new Date(s.getTime() + 2 * 60 * 60 * 1000) : e;
        })()
      } : {}),
      ...(payload.registrationOpensAt
        ? { registrationOpensAt: new Date(payload.registrationOpensAt) }
        : {}),
      ...(payload.registrationClosesAt
        ? { registrationClosesAt: new Date(payload.registrationClosesAt) }
        : {}),
      ...(payload.capacity !== undefined ? { capacity: payload.capacity } : {}),
      ...(payload.volunteersNeeded !== undefined ? { volunteersNeeded: payload.volunteersNeeded } : {}),
      ...(payload.isCampusWide !== undefined ? { isCampusWide: payload.isCampusWide } : {}),
      ...(payload.allowVolunteerSignup !== undefined
        ? { allowVolunteerSignup: payload.allowVolunteerSignup }
        : {}),
      ...(payload.requiresCheckIn !== undefined ? { requiresCheckIn: payload.requiresCheckIn } : {}),
      ...(payload.templateId !== undefined ? { templateId: payload.templateId } : {}),
      ...(moduleData ? { modules: moduleData } : {})
    },
    include: { modules: true }
  });

  // Update staff assignments if instructorId / associateInstructorId provided
  const rolesToUpdate = [
    payload.instructorId !== undefined && "INSTRUCTOR",
    payload.associateInstructorId !== undefined && "ASSOCIATE_INSTRUCTOR",
  ].filter(Boolean);

  if (rolesToUpdate.length) {
    await prisma.eventStaffAssignment.deleteMany({
      where: { eventId, role: { in: rolesToUpdate } },
    });

    const newAssignments = [
      payload.instructorId && { userId: payload.instructorId, role: "INSTRUCTOR" },
      payload.associateInstructorId && { userId: payload.associateInstructorId, role: "ASSOCIATE_INSTRUCTOR" },
    ].filter((a) => a && a.userId);

    if (newAssignments.length) {
      await prisma.eventStaffAssignment.createMany({
        data: newAssignments.map((a) => ({
          eventId,
          userId: a.userId,
          role: a.role,
          assignedById: existingEvent.createdById,
        })),
        skipDuplicates: true,
      });
    }
  }

  return updatedEvent;
};

export const deleteEvent = async (eventId) => {
  await prisma.event.delete({
    where: { id: eventId }
  });
};

export const bulkCreateEvents = async (events, createdById) =>
  Promise.all(events.map((eventPayload) => createEvent(eventPayload, createdById)));

export const getEventRecord = async (eventId) => {
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
              studentProfile: true
            }
          }
        }
      },
      attendances: true,
      checkIns: true,
      assignments: {
        include: {
          user: {
            include: {
              studentProfile: true,
              instructorProfile: true
            }
          }
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
        }
      },
      feedbackEntries: true
    }
  });

  if (!event) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Event not found");
  }

  const moduleIds = event.modules.map((moduleItem) => moduleItem.id);
  const progressEntries = moduleIds.length
    ? await prisma.moduleProgress.findMany({
        where: {
          moduleId: {
            in: moduleIds
          }
        },
        include: {
          studentProfile: true,
          module: true
        }
      })
    : [];

  const roster = event.registrations.map((registration) => {
    const registrationNotes = parseRegistrationNotes(registration.notes);
    const feedback = event.feedbackEntries.find((entry) => entry.userId === registration.userId);
    const attendance = event.attendances
      .filter((entry) => entry.userId === registration.userId)
      .sort((left, right) => right.markedAt.getTime() - left.markedAt.getTime())[0];
    const checkIns = event.checkIns.filter((entry) => entry.userId === registration.userId);
    const quizEntries = progressEntries.filter(
      (entry) => entry.studentProfile.userId === registration.userId
    );

    return {
      registrationId: registration.id,
      userId: registration.user.id,
      name: registration.user.name,
      email: registration.user.email,
      profileImageUrl: registration.user.profileImageUrl,
      rollNumber: registration.user.studentProfile?.rollNumber || null,
      department: registration.user.studentProfile?.department || null,
      programme: registration.user.studentProfile?.programme || null,
      yearOfStudy: registration.user.studentProfile?.yearOfStudy || null,
      registrationStatus: registration.status,
      registeredAt: registration.registeredAt,
      sessionLabel: registrationNotes.sessionLabel || null,
      checkedInAt: registration.checkedInAt,
      attendanceStatus: attendance?.status || null,
      checkInStatus: checkIns[0]?.status || null,
      eventRating: feedback?.eventRating || null,
      instructorRating: feedback?.instructorRating || null,
      eventComment: feedback?.eventComment || null,
      instructorComment: feedback?.instructorComment || null,
      quizScores: quizEntries.map((entry) => ({
        moduleId: entry.moduleId,
        moduleTitle: entry.module.title,
        marksObtained: entry.marksObtained,
        completedAt: entry.completedAt
      }))
    };
  });

  const feedbackWithInstructorRating = event.feedbackEntries.filter(
    (entry) => entry.instructorRating !== null
  );

  return {
    event: {
      id: event.id,
      title: event.title,
      type: event.type,
      status: event.status,
      venue: event.venue,
      startAt: event.startAt,
      endAt: event.endAt
    },
    summary: {
      totalRegistrants: event.registrations.length,
      totalAttended: roster.filter((entry) => entry.attendanceStatus === "PRESENT").length,
      avgEventRating:
        event.feedbackEntries.length > 0
          ? event.feedbackEntries.reduce((sum, entry) => sum + entry.eventRating, 0) /
            event.feedbackEntries.length
          : null,
      avgInstructorRating:
        feedbackWithInstructorRating.length > 0
          ? feedbackWithInstructorRating.reduce((sum, entry) => sum + entry.instructorRating, 0) /
            feedbackWithInstructorRating.length
          : null
    },
    modules: event.modules,
    assignments: event.assignments,
    availabilityResponses: event.availabilityResponses,
    roster
  };
};

const buildEventExportRows = (record, moduleId) => {
  const filteredRoster = moduleId
    ? record.roster.map((entry) => ({
        ...entry,
        quizScores: entry.quizScores.filter((quizScore) => quizScore.moduleId === moduleId)
      }))
    : record.roster;

  return filteredRoster.map((entry) => ({
    eventId: record.event.id,
    eventTitle: record.event.title,
    participantName: entry.name,
    participantEmail: entry.email,
    rollNumber: entry.rollNumber,
    sessionName: entry.sessionLabel,
    department: entry.department,
    programme: entry.programme,
    yearOfStudy: entry.yearOfStudy,
    registrationStatus: entry.registrationStatus,
    checkedInAt: entry.checkedInAt,
    attendanceStatus: entry.attendanceStatus,
    checkInStatus: entry.checkInStatus,
    eventRating: entry.eventRating,
    instructorRating: entry.instructorRating,
    eventFeedback: entry.eventComment,
    instructorFeedback: entry.instructorComment,
    quizSummary: entry.quizScores
      .map((score) => `${score.moduleTitle}:${score.marksObtained ?? ""}`)
      .join(" | ")
  }));
};

export const exportEventData = async (eventId, moduleId) => {
  const record = await getEventRecord(eventId);
  const rows = buildEventExportRows(record, moduleId);

  return {
    fileName: `event-${record.event.id}-report`,
    csv: toCsv(rows),
    xlsx: await createWorkbookBuffer([
      {
        name: "Participants",
        rows
      }
    ])
  };
};
