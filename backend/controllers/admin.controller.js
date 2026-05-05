import { StatusCodes } from "http-status-codes";

import {
  createEvent,
  modifyEvent,
  assignStaff,
  assignVolunteers,
  getMemberDirectory,
  getEventDetails,
  getAllEventsWithRegistrations,
  getEventWithRegistrations,
  deleteEvent,
  removeStaffAssignment,
  getVolunteersWithActivity
} from "../services/admin.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";

// CREATE EVENT
export const createEventController = asyncHandler(async (req, res) => {
  if (!req.user.adminProfile) {
    throw new ApiError(StatusCodes.FORBIDDEN, "Admin access required");
  }

  console.log("📝 Creating event with data:", req.body);
  console.log("👤 User:", req.user.name, req.user.id);

  const event = await createEvent(req.body, req.user.id);
  
  console.log("✅ Event created successfully:", event.id);
  
  res.status(StatusCodes.CREATED).json({
    success: true,
    data: event
  });
});

// MODIFY EVENT
export const modifyEventController = asyncHandler(async (req, res) => {
  if (!req.user.adminProfile) {
    throw new ApiError(StatusCodes.FORBIDDEN, "Admin access required");
  }

  const { eventId } = req.params;
  const event = await modifyEvent(eventId, req.body);
  
  res.status(StatusCodes.OK).json({
    success: true,
    data: event
  });
});

// ASSIGN INSTRUCTOR / ASSOCIATE INSTRUCTOR
export const assignStaffController = asyncHandler(async (req, res) => {
  if (!req.user.adminProfile) {
    throw new ApiError(StatusCodes.FORBIDDEN, "Admin access required");
  }

  const { eventId, userId, role } = req.body;
  
  if (!["INSTRUCTOR", "ASSOCIATE_INSTRUCTOR"].includes(role)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid staff role");
  }

  const assignment = await assignStaff(eventId, userId, role, req.user.id);
  
  res.status(StatusCodes.CREATED).json({
    success: true,
    data: assignment
  });
});

// ASSIGN VOLUNTEERS
export const assignVolunteersController = asyncHandler(async (req, res) => {
  if (!req.user.adminProfile) {
    throw new ApiError(StatusCodes.FORBIDDEN, "Admin access required");
  }

  const { eventId, userIds } = req.body;
  
  if (!Array.isArray(userIds) || userIds.length === 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User IDs array is required");
  }

  const assignments = await assignVolunteers(eventId, userIds, req.user.id);
  
  res.status(StatusCodes.CREATED).json({
    success: true,
    data: assignments
  });
});

// FETCH MEMBER DIRECTORY
export const getMemberDirectoryController = asyncHandler(async (req, res) => {
  if (req.user.role !== 'ADMIN') {
    throw new ApiError(StatusCodes.FORBIDDEN, "Admin role required");
  }

  const filters = {
    department: req.query.department,
    year: req.query.year,
    programme: req.query.programme,
    role: req.query.role,
    search: req.query.search
  };

  const members = await getMemberDirectory(filters);
  
  res.status(StatusCodes.OK).json({
    success: true,
    data: members
  });
});

// GET EVENT DETAILS
export const getEventDetailsController = asyncHandler(async (req, res) => {
  if (!req.user.adminProfile) {
    throw new ApiError(StatusCodes.FORBIDDEN, "Admin access required");
  }

  const { eventId } = req.params;
  const event = await getEventDetails(eventId);
  
  if (!event) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Event not found");
  }
  
  res.status(StatusCodes.OK).json({
    success: true,
    data: event
  });
});

// GET ALL EVENTS (Original - for backward compatibility)
export const getAllEventsController = asyncHandler(async (req, res) => {
  if (req.user.role !== 'ADMIN') {
    throw new ApiError(StatusCodes.FORBIDDEN, "Admin role required");
  }

  const filters = {
    status: req.query.status,
    type: req.query.type,
    startDate: req.query.startDate,
    endDate: req.query.endDate
  };

  const events = await getAllEventsWithRegistrations(filters);
  
  res.status(StatusCodes.OK).json({
    success: true,
    data: events
  });
});

// GET ALL EVENTS WITH REGISTRATIONS
export const getAllEventsWithRegistrationsController = asyncHandler(async (req, res) => {
  if (req.user.role !== 'ADMIN') {
    throw new ApiError(StatusCodes.FORBIDDEN, "Admin role required");
  }

  const filters = {
    status: req.query.status,
    type: req.query.type,
    startDate: req.query.startDate,
    endDate: req.query.endDate
  };

  const events = await getAllEventsWithRegistrations(filters);
  
  res.status(StatusCodes.OK).json({
    success: true,
    data: events
  });
});

// GET SINGLE EVENT WITH REGISTRATIONS
export const getEventWithRegistrationsController = asyncHandler(async (req, res) => {
  if (req.user.role !== 'ADMIN') {
    throw new ApiError(StatusCodes.FORBIDDEN, "Admin role required");
  }

  const { eventId } = req.params;
  const event = await getEventWithRegistrations(eventId);
  
  if (!event) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Event not found");
  }
  
  res.status(StatusCodes.OK).json({
    success: true,
    data: event
  });
});

// DELETE EVENT
export const deleteEventController = asyncHandler(async (req, res) => {
  if (!req.user.adminProfile) {
    throw new ApiError(StatusCodes.FORBIDDEN, "Admin access required");
  }

  const { eventId } = req.params;
  await deleteEvent(eventId);
  
  res.status(StatusCodes.OK).json({
    success: true,
    message: "Event deleted successfully"
  });
});

// REMOVE STAFF ASSIGNMENT
export const removeStaffAssignmentController = asyncHandler(async (req, res) => {
  if (!req.user.adminProfile) {
    throw new ApiError(StatusCodes.FORBIDDEN, "Admin access required");
  }

  const { assignmentId } = req.params;
  await removeStaffAssignment(assignmentId);
  
  res.status(StatusCodes.OK).json({
    success: true,
    message: "Staff assignment removed successfully"
  });
});

// GET VOLUNTEERS WITH ACTIVITY DATA
export const getVolunteersController = asyncHandler(async (req, res) => {
  if (req.user.role !== 'ADMIN') {
    throw new ApiError(StatusCodes.FORBIDDEN, "Admin role required");
  }

  const volunteers = await getVolunteersWithActivity();
  
  res.status(StatusCodes.OK).json({
    success: true,
    data: volunteers
  });
});