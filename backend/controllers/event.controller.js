import { StatusCodes } from "http-status-codes";

import {
  bulkCreateEvents,
  createEvent,
  deleteEvent,
  exportEventData,
  getEventById,
  getEventRecord,
  listEvents,
  updateEvent
} from "../services/event.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { prisma } from "../database/prisma.js";

export const createEventController = asyncHandler(async (req, res) => {
  const data = await createEvent(req.validated.body, req.user.id);
  res.status(StatusCodes.CREATED).json({
    success: true,
    message: "Event created successfully",
    data
  });
});

export const bulkCreateEventsController = asyncHandler(async (req, res) => {
  const data = await bulkCreateEvents(req.validated.body.events, req.user.id);
  res.status(StatusCodes.CREATED).json({
    success: true,
    message: "Bulk event creation completed",
    data
  });
});

export const listEventsController = asyncHandler(async (req, res) => {
  const data = await listEvents(req.validated.query, req.user);
  res.status(StatusCodes.OK).json({
    success: true,
    data
  });
});

export const getEventController = asyncHandler(async (req, res) => {
  const data = await getEventById(req.params.eventId);
  res.status(StatusCodes.OK).json({
    success: true,
    data
  });
});

export const updateEventController = asyncHandler(async (req, res) => {
  const data = await updateEvent(req.validated.params.eventId, req.validated.body);
  res.status(StatusCodes.OK).json({
    success: true,
    message: "Event updated successfully",
    data
  });
});

export const deleteEventController = asyncHandler(async (req, res) => {
  await deleteEvent(req.params.eventId);
  res.status(StatusCodes.OK).json({
    success: true,
    message: "Event deleted successfully"
  });
});

export const getEventRecordController = asyncHandler(async (req, res) => {
  const data = await getEventRecord(req.params.eventId);
  res.status(StatusCodes.OK).json({
    success: true,
    data
  });
});

export const exportEventDataController = asyncHandler(async (req, res) => {
  const data = await exportEventData(req.params.eventId, req.query.moduleId);
  const format = String(req.query.format || "csv").toLowerCase();

  if (format === "xlsx") {
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${data.fileName}.xlsx"`);
    res.status(StatusCodes.OK).send(data.xlsx);
    return;
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${data.fileName}.csv"`);
  res.status(StatusCodes.OK).send(data.csv);
});

export const expressVolunteerInterestController = asyncHandler(async (req, res) => {
  const { eventId } = req.params;
  const userId = req.user.id;

  // Check if already expressed interest
  const existing = await prisma.eventAvailability.findUnique({
    where: {
      eventId_userId: { eventId, userId }
    }
  });

  if (existing) {
    return res.status(StatusCodes.OK).json({
      success: true,
      message: "Interest already registered"
    });
  }

  // Create interest record
  await prisma.eventAvailability.create({
    data: {
      eventId,
      userId,
      isAvailable: true,
      note: "Volunteer interest"
    }
  });

  res.status(StatusCodes.CREATED).json({
    success: true,
    message: "Volunteer interest registered successfully"
  });
});

export const getEventVolunteersController = asyncHandler(async (req, res) => {
  const { eventId } = req.params;

  // Get interested volunteers (EventAvailability)
  const interestedVolunteers = await prisma.eventAvailability.findMany({
    where: {
      eventId,
      isAvailable: true
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          employeeId: true
        }
      }
    }
  });

  // Get assigned volunteers (EventStaffAssignment)
  const assignedVolunteers = await prisma.eventStaffAssignment.findMany({
    where: {
      eventId,
      role: 'VOLUNTEER'
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          employeeId: true
        }
      }
    }
  });

  const assignedUserIds = assignedVolunteers.map(a => a.userId);

  res.status(StatusCodes.OK).json({
    success: true,
    data: {
      interested: interestedVolunteers.filter(v => !assignedUserIds.includes(v.userId)),
      assigned: assignedVolunteers
    }
  });
});

export const assignVolunteerController = asyncHandler(async (req, res) => {
  const { eventId, userId } = req.params;

  // Check if already assigned
  const existing = await prisma.eventStaffAssignment.findFirst({
    where: {
      eventId,
      userId,
      role: 'VOLUNTEER'
    }
  });

  if (existing) {
    return res.status(StatusCodes.OK).json({
      success: true,
      message: 'Volunteer already assigned'
    });
  }

  // Create assignment
  await prisma.eventStaffAssignment.create({
    data: {
      eventId,
      userId,
      role: 'VOLUNTEER',
      assignedById: req.user.id
    }
  });

  res.status(StatusCodes.CREATED).json({
    success: true,
    message: 'Volunteer assigned successfully'
  });
});

export const unassignVolunteerController = asyncHandler(async (req, res) => {
  const { eventId, userId } = req.params;

  // Find and delete the assignment
  const assignment = await prisma.eventStaffAssignment.findFirst({
    where: {
      eventId,
      userId,
      role: 'VOLUNTEER'
    }
  });

  if (!assignment) {
    return res.status(StatusCodes.NOT_FOUND).json({
      success: false,
      message: 'Assignment not found'
    });
  }

  // Delete both assignment and interest in a transaction
  await prisma.$transaction([
    // Delete the assignment
    prisma.eventStaffAssignment.delete({
      where: {
        id: assignment.id
      }
    }),
    // Delete the interest (if exists)
    prisma.eventAvailability.deleteMany({
      where: {
        eventId,
        userId
      }
    })
  ]);

  res.status(StatusCodes.OK).json({
    success: true,
    message: 'Volunteer unassigned successfully'
  });
});

export const withdrawVolunteerInterestController = asyncHandler(async (req, res) => {
  const { eventId } = req.params;
  const userId = req.user.id;

  // Find and delete the interest record
  const interest = await prisma.eventAvailability.findUnique({
    where: {
      eventId_userId: { eventId, userId }
    }
  });

  if (!interest) {
    return res.status(StatusCodes.NOT_FOUND).json({
      success: false,
      message: 'Interest not found'
    });
  }

  await prisma.eventAvailability.delete({
    where: {
      eventId_userId: { eventId, userId }
    }
  });

  res.status(StatusCodes.OK).json({
    success: true,
    message: 'Interest withdrawn successfully'
  });
});
