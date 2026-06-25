import bcrypt from "bcryptjs";
import { StatusCodes } from "http-status-codes";

import { prisma } from "../database/prisma.js";
import { createEvent } from "./event.service.js";
import { ApiError } from "../utils/ApiError.js";
import { createWorkbookBuffer, parseWorkbookRows } from "../utils/excel.js";

const DEFAULT_IMPORT_PASSWORD = "ChangeMe@123";

const parseMeta = (meta) => {
  if (!meta) {
    return {};
  }

  if (typeof meta === "string") {
    try {
      return JSON.parse(meta);
    } catch {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid meta JSON");
    }
  }

  return meta;
};

const normalizeString = (value) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const result = String(value).trim();
  return result || undefined;
};

const normalizeNullableString = (value) => normalizeString(value) ?? null;

const normalizeKey = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const getRowValue = (row, aliases) => {
  const entries = Object.entries(row);
  const aliasSet = new Set(aliases.map((alias) => normalizeKey(alias)));
  const matched = entries.find(([key]) => aliasSet.has(normalizeKey(key)));
  return matched?.[1];
};

const normalizeBoolean = (value, fallback = undefined) => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();

  if (["true", "yes", "1", "y"].includes(normalized)) {
    return true;
  }

  if (["false", "no", "0", "n"].includes(normalized)) {
    return false;
  }

  return fallback;
};

const normalizeNumber = (value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const normalizeDate = (value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const combineDateAndTime = (dateValue, timeValue) => {
  const baseDate = normalizeDate(dateValue);
  if (!baseDate) {
    return undefined;
  }

  if (timeValue === undefined || timeValue === null || timeValue === "") {
    return baseDate;
  }

  const normalizedTime = String(timeValue).trim().toLowerCase();
  const directDate = normalizeDate(timeValue);

  if (directDate && directDate.getFullYear() > 1900) {
    return directDate;
  }

  const match = normalizedTime.match(/^(\d{1,2})(?::|\.)?(\d{2})?\s*(am|pm)?$/i);
  if (!match) {
    return baseDate;
  }

  let hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  const meridiem = match[3];

  if (meridiem === "pm" && hours < 12) {
    hours += 12;
  }
  if (meridiem === "am" && hours === 12) {
    hours = 0;
  }

  const combined = new Date(baseDate);
  combined.setHours(hours, minutes, 0, 0);
  return combined;
};

const mapScheduleRowToEventPayload = (row, meta = {}) => {
  const courseName = normalizeString(
    getRowValue(row, ["courseName", "Course Name", "course", "workshop name", "workshopName"])
  );
  const tutorial = normalizeString(
    getRowValue(row, ["tutorial", "session", "batch", "Batch", "tutorial/batch"])
  );
  const sessionDate = getRowValue(row, ["sessionDate", "Session- Date", "date"]);
  const sessionTime = getRowValue(row, ["time", "sessionTime"]);
  const durationHours = normalizeNumber(
    getRowValue(row, ["duration", "Duration (hrs)", "Duration"])
  );
  const venue = normalizeString(getRowValue(row, ["venue", "location"]));
  const instructor = normalizeString(getRowValue(row, ["instructor", "faculty"]));
  const attendedCount = normalizeNumber(
    getRowValue(row, [
      "noofstudentattendedthesession",
      "No. of student attended the session",
      "capacity"
    ])
  );

  const startAt = combineDateAndTime(sessionDate, sessionTime);
  const endAt = startAt
    ? new Date(startAt.getTime() + Math.round((durationHours || 1) * 60) * 60 * 1000)
    : undefined;

  if (!courseName || !startAt || !endAt) {
    return null;
  }

  const title = courseName;
  const descriptionParts = [
    `Imported workshop schedule for ${courseName}.`,
    instructor ? `Instructor: ${instructor}.` : null,
    tutorial ? `Session: ${tutorial}.` : null
  ].filter(Boolean);

  return {
    title,
    description: descriptionParts.join(" "),
    type: normalizeString(meta.defaultType) || "WELLNESS_COURSE",
    status: normalizeString(meta.status) || "PUBLISHED",
    venue,
    meetLink: normalizeString(meta.meetLink),
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    registrationOpensAt: meta.registrationOpensAt,
    registrationClosesAt: meta.registrationClosesAt,
    capacity: attendedCount || normalizeNumber(meta.capacity),
    volunteersNeeded: normalizeNumber(meta.volunteersNeeded),
    isCampusWide: normalizeBoolean(meta.isCampusWide, true),
    allowVolunteerSignup: normalizeBoolean(meta.allowVolunteerSignup, true),
    requiresCheckIn: normalizeBoolean(meta.requiresCheckIn, true),
    templateId: normalizeString(meta.templateId),
    courseId: normalizeString(meta.courseId) || undefined,
    courseModuleId: normalizeString(meta.courseModuleId) || undefined,
    batch: tutorial || undefined,
  };
};

// Used when course + workshop module are pre-selected from the modal
const mapScheduleRowWithModule = (row, module, meta = {}) => {
  const sessionDate = getRowValue(row, ["date", "sessionDate", "Session- Date"]);
  const sessionTime = getRowValue(row, ["time", "sessionTime"]);
  const durationHours = normalizeNumber(getRowValue(row, ["duration", "Duration (hrs)", "Duration"]));
  const venue = normalizeString(getRowValue(row, ["venue", "location"]));
  const instructor = normalizeString(getRowValue(row, ["instructor", "faculty"]));
  const batch = normalizeString(getRowValue(row, ["tutorial/batch", "tutorial", "batch", "Batch", "session"]));

  const startAt = combineDateAndTime(sessionDate, sessionTime);
  if (!startAt) return null;

  const endAt = new Date(startAt.getTime() + Math.round((durationHours || 2) * 60) * 60 * 1000);

  const title = module?.title || normalizeString(getRowValue(row, ["workshop name", "workshopName", "title"])) || "Workshop";
  const descriptionParts = [
    module?.description || `Workshop session for ${title}.`,
    instructor ? `Instructor: ${instructor}.` : null,
    batch ? `Batch/Tutorial: ${batch}.` : null,
  ].filter(Boolean);

  return {
    title,
    description: descriptionParts.join(" "),
    type: "WELLNESS_COURSE",
    status: "PUBLISHED",
    venue,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    courseId: meta.courseId || undefined,
    courseModuleId: meta.courseModuleId || undefined,
    batch: batch || undefined,
    isCampusWide: true,
    allowVolunteerSignup: true,
    requiresCheckIn: true,
  };
};

const mapScheduleRowToModulePayload = (row) => {
  const tutorial = normalizeString(
    getRowValue(row, ["tutorial", "session", "batch", "Batch"])
  );
  const sessionDate = getRowValue(row, ["sessionDate", "Session- Date", "date"]);
  const sessionTime = getRowValue(row, ["time", "sessionTime"]);
  const durationHours = normalizeNumber(
    getRowValue(row, ["duration", "Duration (hrs)", "Duration"])
  );
  const venue = normalizeString(getRowValue(row, ["venue", "location"]));
  const startAt = combineDateAndTime(sessionDate, sessionTime);
  const endAt = startAt
    ? new Date(startAt.getTime() + Math.round((durationHours || 1) * 60) * 60 * 1000)
    : undefined;

  if (!tutorial || !startAt || !endAt) {
    return null;
  }

  return {
    title: tutorial,
    venue,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString()
  };
};

const isScheduleStyleEventSheet = (rows) =>
  rows.some((row) => getRowValue(row, ["Course Name"]) && getRowValue(row, ["Tutorial"]));

const buildGroupedScheduleEvents = (rows, meta = {}) => {
  const grouped = new Map();

  rows.forEach((row) => {
    const baseEvent = mapScheduleRowToEventPayload(row, meta);
    const moduleItem = mapScheduleRowToModulePayload(row);

    if (!baseEvent || !moduleItem) {
      return;
    }

    const groupKey = `${baseEvent.title}__${baseEvent.startAt}`;
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        ...baseEvent,
        venue: baseEvent.venue || "Multiple Venues",
        capacity: baseEvent.capacity || undefined,
        modules: []
      });
    }

    const current = grouped.get(groupKey);
    current.modules.push({
      title: moduleItem.title,
      venue: moduleItem.venue,
      startAt: moduleItem.startAt,
      endAt: moduleItem.endAt
    });
    current.startAt =
      new Date(moduleItem.startAt) < new Date(current.startAt) ? moduleItem.startAt : current.startAt;
    current.endAt =
      new Date(moduleItem.endAt) > new Date(current.endAt) ? moduleItem.endAt : current.endAt;
    current.capacity = Math.max(current.capacity || 0, baseEvent.capacity || 0) || undefined;
  });

  return [...grouped.values()];
};

const importTemplates = {
  USERS: [
    {
      name: "Users",
      rows: [
        {
          name: "Aarav Patel",
          email: "aarav@iitb.ac.in",
          role: "STUDENT",
          rollNumber: "CS2023-014",
          department: "CSE",
          yearOfStudy: 3,
          programme: "BTECH",
          section: "A",
          cohort: "2023-27",
          profileImageUrl: "",
          password: "ChangeMe@123"
        },
        {
          name: "Dr. Reynolds",
          email: "reynolds@iitb.ac.in",
          role: "ADMIN",
          employeeId: "FH-ADMIN-01",
          profileImageUrl: "",
          password: "ChangeMe@123"
        }
      ]
    }
  ],
  EVENTS: [
    {
      name: "Events",
      rows: [
        {
          title: "Tech & Stress: Industry Panel",
          description: "Guest panel for internships, deadlines, and balance.",
          type: "OPEN_WORKSHOP",
          status: "PUBLISHED",
          venue: "Main Auditorium",
          meetLink: "",
          startAt: "2026-05-10T17:30:00.000Z",
          endAt: "2026-05-10T19:00:00.000Z",
          registrationOpensAt: "2026-05-01T00:00:00.000Z",
          registrationClosesAt: "2026-05-10T15:00:00.000Z",
          capacity: 150,
          volunteersNeeded: 5,
          isCampusWide: true,
          allowVolunteerSignup: true,
          requiresCheckIn: true,
          templateId: ""
        }
      ]
    }
  ],
  EVENT_REGISTRATIONS: [
    {
      name: "Registrations",
      rows: [
        {
          eventId: "",
          eventSlug: "",
          eventTitle: "Tech & Stress: Industry Panel",
          userEmail: "aarav@iitb.ac.in",
          status: "REGISTERED",
          isVolunteer: false,
          notes: "Imported in bulk"
        }
      ]
    }
  ],
  ATTENDANCE: [
    {
      name: "Attendance",
      rows: [
        {
          eventId: "",
          eventSlug: "",
          eventTitle: "Tech & Stress: Industry Panel",
          moduleId: "",
          moduleTitle: "",
          userEmail: "aarav@iitb.ac.in",
          attendanceStatus: "PRESENT",
          source: "excel-import"
        }
      ]
    }
  ],
  MARKS: [
    {
      name: "Marks",
      rows: [
        {
          eventId: "",
          eventSlug: "",
          eventTitle: "Building Calm Habits",
          moduleId: "",
          moduleTitle: "Recognizing digital overload",
          userEmail: "aarav@iitb.ac.in",
          marksObtained: 8,
          completedAt: "2026-05-10T19:10:00.000Z"
        }
      ]
    }
  ]
};

const resolveEvent = async (row, meta = {}) => {
  const eventId = normalizeString(row.eventId) || normalizeString(meta.eventId);
  const eventSlug = normalizeString(row.eventSlug) || normalizeString(meta.eventSlug);
  const eventTitle = normalizeString(row.eventTitle) || normalizeString(meta.eventTitle);

  const event = await prisma.event.findFirst({
    where: {
      OR: [
        ...(eventId ? [{ id: eventId }] : []),
        ...(eventSlug ? [{ slug: eventSlug }] : []),
        ...(eventTitle ? [{ title: eventTitle }] : [])
      ]
    }
  });

  if (!event) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Referenced event not found");
  }

  return event;
};

const resolveModule = async (eventId, row, meta = {}) => {
  const moduleId = normalizeString(row.moduleId) || normalizeString(meta.moduleId);
  const moduleTitle = normalizeString(row.moduleTitle) || normalizeString(meta.moduleTitle);

  if (!moduleId && !moduleTitle) {
    return null;
  }

  const module = await prisma.eventModule.findFirst({
    where: {
      eventId,
      OR: [
        ...(moduleId ? [{ id: moduleId }] : []),
        ...(moduleTitle ? [{ title: moduleTitle }] : [])
      ]
    }
  });

  if (!module) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Referenced module not found");
  }

  return module;
};

const resolveUser = async (row) => {
  const userId = normalizeString(row.userId);
  const userEmail = normalizeString(row.userEmail || row.email)?.toLowerCase();

  const user = await prisma.user.findFirst({
    where: {
      OR: [
        ...(userId ? [{ id: userId }] : []),
        ...(userEmail ? [{ email: userEmail }] : [])
      ]
    },
    include: {
      studentProfile: true
    }
  });

  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Referenced user not found");
  }

  return user;
};

const executeImportRows = async (rows, handler) => {
  const result = {
    processed: 0,
    created: 0,
    updated: 0,
    failed: 0,
    errors: []
  };

  for (let index = 0; index < rows.length; index += 1) {
    try {
      const summary = await handler(rows[index], index);
      result.processed += 1;
      result.created += summary.created || 0;
      result.updated += summary.updated || 0;
    } catch (error) {
      result.failed += 1;
      result.errors.push({
        row: index + 2,
        message: error.message
      });
    }
  }

  return result;
};

const importUsers = async (rows, meta) => {
  const defaultPassword = normalizeString(meta.defaultPassword) || DEFAULT_IMPORT_PASSWORD;

  return executeImportRows(rows, async (row) => {
    const email = normalizeString(row.email)?.toLowerCase();
    const role = normalizeString(row.role);
    const name = normalizeString(row.name);

    if (!email || !email.endsWith("@iitb.ac.in")) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "User email must be an IITB email");
    }

    if (!name || !role) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "User name and role are required");
    }

    const existingUser = await prisma.user.findUnique({
      where: { email },
      include: {
        studentProfile: true,
        instructorProfile: true,
        adminProfile: true
      }
    });

    const password = normalizeString(row.password) || defaultPassword;
    const passwordHash = await bcrypt.hash(password, 10);
    const employeeId = normalizeString(row.employeeId);

    const data = {
      name,
      email,
      role,
      profileImageUrl: normalizeNullableString(row.profileImageUrl),
      employeeId: role === "ADMIN" ? employeeId : null,
      ...(existingUser ? {} : { passwordHash })
    };

    if (role === "STUDENT" || role === "VOLUNTEER") {
      data.studentProfile = {
        upsert: {
          create: {
            rollNumber: normalizeString(row.rollNumber),
            department: normalizeString(row.department),
            yearOfStudy: normalizeNumber(row.yearOfStudy),
            programme: normalizeString(row.programme),
            section: normalizeNullableString(row.section),
            cohort: normalizeNullableString(row.cohort)
          },
          update: {
            rollNumber: normalizeString(row.rollNumber),
            department: normalizeString(row.department),
            yearOfStudy: normalizeNumber(row.yearOfStudy),
            programme: normalizeString(row.programme),
            section: normalizeNullableString(row.section),
            cohort: normalizeNullableString(row.cohort)
          }
        }
      };
    }

    if (role === "INSTRUCTOR") {
      data.instructorProfile = {
        upsert: {
          create: {
            designation: normalizeNullableString(row.designation),
            department: normalizeNullableString(row.department)
          },
          update: {
            designation: normalizeNullableString(row.designation),
            department: normalizeNullableString(row.department)
          }
        }
      };
    }

    if (role === "ADMIN" && employeeId) {
      data.adminProfile = {
        upsert: {
          create: { employeeId },
          update: { employeeId }
        }
      };
    }

    if (existingUser) {
      await prisma.user.update({
        where: { id: existingUser.id },
        data
      });
      return { updated: 1 };
    }

    await prisma.user.create({
      data
    });
    return { created: 1 };
  });
};

const importEvents = async (rows, meta, createdById) => {
  // Module-based import: course + workshop selected from the modal
  if (meta.courseId && meta.courseModuleId) {
    const module = await prisma.courseModule.findUnique({
      where: { id: meta.courseModuleId },
      select: { id: true, title: true, description: true }
    });

    return executeImportRows(rows, async (row) => {
      const payload = mapScheduleRowWithModule(row, module, meta);
      if (!payload) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "Row missing date or time");
      }
      await createEvent(payload, createdById);
      return { created: 1 };
    });
  }

  return isScheduleStyleEventSheet(rows)
    ? executeImportRows(buildGroupedScheduleEvents(rows, meta), async (payload) => {
        if (!payload.title || !payload.description || !payload.type || !payload.startAt || !payload.endAt) {
          throw new ApiError(StatusCodes.BAD_REQUEST, "Event row is missing required fields");
        }

        await createEvent(payload, createdById);
        return { created: 1 };
      })
    : executeImportRows(rows, async (row) => {
    const standardPayload = {
      title: normalizeString(row.title),
      description: normalizeString(row.description),
      type: normalizeString(row.type),
      status: normalizeString(row.status) || "PUBLISHED",
      bannerImageUrl: normalizeString(row.bannerImageUrl),
      venue: normalizeString(row.venue),
      meetLink: normalizeString(row.meetLink),
      startAt: normalizeDate(row.startAt)?.toISOString(),
      endAt: normalizeDate(row.endAt)?.toISOString(),
      registrationOpensAt: normalizeDate(row.registrationOpensAt)?.toISOString(),
      registrationClosesAt: normalizeDate(row.registrationClosesAt)?.toISOString(),
      capacity: normalizeNumber(row.capacity),
      volunteersNeeded: normalizeNumber(row.volunteersNeeded),
      isCampusWide: normalizeBoolean(row.isCampusWide, true),
      allowVolunteerSignup: normalizeBoolean(row.allowVolunteerSignup, true),
      requiresCheckIn: normalizeBoolean(row.requiresCheckIn, true),
      templateId: normalizeString(row.templateId) || normalizeString(meta.templateId)
    };

    const payload =
      standardPayload.title && standardPayload.startAt
        ? standardPayload
        : mapScheduleRowToEventPayload(row, meta);

    if (!payload || !payload.title || !payload.description || !payload.type || !payload.startAt || !payload.endAt) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Event row is missing required fields");
    }

    await createEvent(payload, createdById);
    return { created: 1 };
  });
};

const importRegistrations = async (rows, meta) =>
  executeImportRows(rows, async (row) => {
    const event = await resolveEvent(row, meta);
    const user = await resolveUser(row);
    const registrationStatus = normalizeString(row.status) || "REGISTERED";
    const isVolunteer = normalizeBoolean(row.isVolunteer, false) ?? false;
    const notes = normalizeNullableString(row.notes);

    const existing = await prisma.eventRegistration.findUnique({
      where: {
        eventId_userId: {
          eventId: event.id,
          userId: user.id
        }
      }
    });

    await prisma.eventRegistration.upsert({
      where: {
        eventId_userId: {
          eventId: event.id,
          userId: user.id
        }
      },
      create: {
        eventId: event.id,
        userId: user.id,
        status: registrationStatus,
        isVolunteer,
        notes
      },
      update: {
        status: registrationStatus,
        isVolunteer,
        notes
      }
    });

    return existing ? { updated: 1 } : { created: 1 };
  });

const importAttendance = async (rows, meta, createdById) =>
  executeImportRows(rows, async (row) => {
    const event = await resolveEvent(row, meta);
    const user = await resolveUser(row);
    const moduleItem = await resolveModule(event.id, row, meta);
    const status = normalizeString(row.attendanceStatus || row.status) || "PRESENT";
    const source = normalizeString(row.source) || "excel-import";

    const existing = await prisma.attendanceRecord.findFirst({
      where: {
        eventId: event.id,
        moduleId: moduleItem?.id || null,
        userId: user.id
      },
      orderBy: {
        markedAt: "desc"
      }
    });

    if (existing) {
      await prisma.attendanceRecord.update({
        where: { id: existing.id },
        data: {
          status,
          markedById: createdById,
          markedAt: new Date(),
          source
        }
      });
    } else {
      await prisma.attendanceRecord.create({
        data: {
          eventId: event.id,
          moduleId: moduleItem?.id,
          userId: user.id,
          status,
          markedById: createdById,
          source
        }
      });
    }

    await prisma.eventRegistration.updateMany({
      where: {
        eventId: event.id,
        userId: user.id
      },
      data:
        status === "PRESENT"
          ? {
              status: "ATTENDED",
              checkedInAt: new Date()
            }
          : {}
    });

    return existing ? { updated: 1 } : { created: 1 };
  });

const importMarks = async (rows, meta) =>
  executeImportRows(rows, async (row) => {
    const event = await resolveEvent(row, meta);
    const user = await resolveUser(row);
    const moduleItem = await resolveModule(event.id, row, meta);

    if (!moduleItem) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Module is required for marks import");
    }

    if (!user.studentProfile) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Marks can only be imported for student profiles");
    }

    const existing = await prisma.moduleProgress.findUnique({
      where: {
        studentProfileId_moduleId: {
          studentProfileId: user.studentProfile.id,
          moduleId: moduleItem.id
        }
      }
    });

    await prisma.moduleProgress.upsert({
      where: {
        studentProfileId_moduleId: {
          studentProfileId: user.studentProfile.id,
          moduleId: moduleItem.id
        }
      },
      create: {
        studentProfileId: user.studentProfile.id,
        moduleId: moduleItem.id,
        marksObtained: normalizeNumber(row.marksObtained),
        completedAt: normalizeDate(row.completedAt) || new Date()
      },
      update: {
        marksObtained: normalizeNumber(row.marksObtained),
        completedAt: normalizeDate(row.completedAt) || existing?.completedAt || new Date()
      }
    });

    return existing ? { updated: 1 } : { created: 1 };
  });

export const createImportJob = async (payload, createdById) =>
  prisma.importJob.create({
    data: {
      ...payload,
      createdById
    }
  });

export const listImportJobs = async () =>
  prisma.importJob.findMany({
    include: {
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });

export const processImportUpload = async ({ type, fileName, fileBuffer, meta, courseId, courseModuleId }, createdById) => {
  const normalizedType = normalizeString(type);
  const parsedMeta = parseMeta(meta);
  if (courseId) parsedMeta.courseId = courseId;
  if (courseModuleId) parsedMeta.courseModuleId = courseModuleId;
  const allowedTypes = new Set([
    "USERS",
    "EVENTS",
    "EVENT_REGISTRATIONS",
    "ATTENDANCE",
    "MARKS"
  ]);

  if (!normalizedType) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Import type is required");
  }

  if (!allowedTypes.has(normalizedType)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Unsupported import type");
  }

  if (!fileBuffer) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Import file is required");
  }

  const job = await prisma.importJob.create({
    data: {
      type: normalizedType,
      status: "PROCESSING",
      fileName,
      createdById,
      meta: parsedMeta
    }
  });

  try {
    const rows = await parseWorkbookRows(fileBuffer, { fileName });

    if (!rows.length) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "No data rows found in uploaded file");
    }

    const result =
      normalizedType === "USERS"
        ? await importUsers(rows, parsedMeta)
        : normalizedType === "EVENTS"
          ? await importEvents(rows, parsedMeta, createdById)
          : normalizedType === "EVENT_REGISTRATIONS"
            ? await importRegistrations(rows, parsedMeta)
            : normalizedType === "ATTENDANCE"
              ? await importAttendance(rows, parsedMeta, createdById)
              : await importMarks(rows, parsedMeta);

    return prisma.importJob.update({
      where: { id: job.id },
      data: {
        status: result.failed === rows.length ? "FAILED" : "COMPLETED",
        result
      }
    });
  } catch (error) {
    await prisma.importJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        result: {
          message: error.message
        }
      }
    });
    throw error;
  }
};

export const buildImportTemplate = async (type) => {
  const template = importTemplates[type];

  if (!template) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Import template not found");
  }

  return createWorkbookBuffer(template);
};
