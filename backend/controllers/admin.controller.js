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
  bulkDeleteEvents,
  deleteEventsByCourse,
  wipeEventsAndCourses,
  archiveEventsAndCourses,
  removeStaffAssignment,
  getVolunteersWithActivity,
  getEventDetailsForAdmin,
  getPendingApprovalUsers,
  approveUser,
  declineUser,
  createEventFromModule,
  getEventAnalytics,
  getWorkshopAnalyticsTable,
  getCourseStaff,
  generateExcelExport
} from "../services/admin.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";

// CREATE EVENT
export const createEventController = asyncHandler(async (req, res) => {
  if (req.user.role !== 'ADMIN') {
    throw new ApiError(StatusCodes.FORBIDDEN, "Admin role required");
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
  if (req.user.role !== 'ADMIN') {
    throw new ApiError(StatusCodes.FORBIDDEN, "Admin role required");
  }

  const { eventId } = req.params;
  const event = await modifyEvent(eventId, req.body, req.user.id);
  
  res.status(StatusCodes.OK).json({
    success: true,
    data: event
  });
});

// ASSIGN INSTRUCTOR / ASSOCIATE INSTRUCTOR
export const assignStaffController = asyncHandler(async (req, res) => {
  if (req.user.role !== 'ADMIN') {
    throw new ApiError(StatusCodes.FORBIDDEN, "Admin role required");
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
  if (req.user.role !== 'ADMIN') {
    throw new ApiError(StatusCodes.FORBIDDEN, "Admin role required");
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
  if (req.user.role !== 'ADMIN') {
    throw new ApiError(StatusCodes.FORBIDDEN, "Admin role required");
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
  if (req.user.role !== 'ADMIN') {
    throw new ApiError(StatusCodes.FORBIDDEN, "Admin role required");
  }

  const { eventId } = req.params;
  await deleteEvent(eventId);

  res.status(StatusCodes.OK).json({
    success: true,
    message: "Event deleted successfully"
  });
});

// BULK DELETE SELECTED EVENTS
export const bulkDeleteEventsController = asyncHandler(async (req, res) => {
  if (req.user.role !== 'ADMIN') {
    throw new ApiError(StatusCodes.FORBIDDEN, "Admin role required");
  }

  const { eventIds } = req.body;
  const result = await bulkDeleteEvents(eventIds);

  res.status(StatusCodes.OK).json({
    success: true,
    message: `${result.deletedCount} event(s) deleted successfully`,
    data: result
  });
});

// DELETE ALL EVENTS OF A SPECIFIC COURSE
export const deleteEventsByCourseController = asyncHandler(async (req, res) => {
  if (req.user.role !== 'ADMIN') {
    throw new ApiError(StatusCodes.FORBIDDEN, "Admin role required");
  }

  const { courseId } = req.params;
  const result = await deleteEventsByCourse(courseId);

  res.status(StatusCodes.OK).json({
    success: true,
    message: `${result.deletedCount} event(s) deleted successfully`,
    data: result
  });
});

// DANGER ZONE: WIPE Events and/or Courses (admin picks the scope, not
// Users). Requires the caller to send the exact confirmation phrase — this
// is the server-side half of the safety gate; the admin UI's typed-
// confirmation box is the other half.
export const wipeEventsAndCoursesController = asyncHandler(async (req, res) => {
  if (req.user.role !== 'ADMIN') {
    throw new ApiError(StatusCodes.FORBIDDEN, "Admin role required");
  }

  const { confirm, deleteEvents, deleteCourses } = req.body;
  if (confirm !== 'DELETE ALL') {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Send { "confirm": "DELETE ALL" } to proceed — this action is irreversible');
  }

  const result = await wipeEventsAndCourses({ deleteEvents: !!deleteEvents, deleteCourses: !!deleteCourses });

  res.status(StatusCodes.OK).json({
    success: true,
    message: `Deleted ${result.deletedEvents} event(s) and ${result.deletedCourses} course(s)`,
    data: result
  });
});

// DANGER ZONE (non-destructive): ARCHIVE Events and/or Courses instead of
// deleting them — data is preserved, just hidden from active views. Still
// gated behind a lighter confirmation since it's reversible.
export const archiveEventsAndCoursesController = asyncHandler(async (req, res) => {
  if (req.user.role !== 'ADMIN') {
    throw new ApiError(StatusCodes.FORBIDDEN, "Admin role required");
  }

  const { archiveEvents, archiveCourses } = req.body;
  const result = await archiveEventsAndCourses({ archiveEvents: !!archiveEvents, archiveCourses: !!archiveCourses });

  res.status(StatusCodes.OK).json({
    success: true,
    message: `Archived ${result.archivedEvents} event(s) and ${result.archivedCourses} course(s)`,
    data: result
  });
});

// REMOVE STAFF ASSIGNMENT
export const removeStaffAssignmentController = asyncHandler(async (req, res) => {
  if (req.user.role !== 'ADMIN') {
    throw new ApiError(StatusCodes.FORBIDDEN, "Admin role required");
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


// GET EVENT DETAILS FOR ADMIN (with registrants, volunteers, attendees)
export const getEventDetailsForAdminController = asyncHandler(async (req, res) => {
  if (req.user.role !== 'ADMIN') {
    throw new ApiError(StatusCodes.FORBIDDEN, "Admin role required");
  }

  const { eventId } = req.params;
  const eventDetails = await getEventDetailsForAdmin(eventId);

  res.status(StatusCodes.OK).json({
    success: true,
    data: eventDetails
  });
});

// Get pending approval users
export const getPendingApprovalUsersController = asyncHandler(async (req, res) => {
  // Check if user is admin
  if (req.user.role !== "ADMIN") {
    return res.status(StatusCodes.FORBIDDEN).json({
      success: false,
      message: "Only admins can view pending approvals"
    });
  }

  const users = await getPendingApprovalUsers();

  res.status(StatusCodes.OK).json({
    success: true,
    data: users
  });
});

// Approve user
export const approveUserController = asyncHandler(async (req, res) => {
  // Check if user is admin
  if (req.user.role !== "ADMIN") {
    return res.status(StatusCodes.FORBIDDEN).json({
      success: false,
      message: "Only admins can approve users"
    });
  }

  const { userId } = req.params;
  const user = await approveUser(userId);

  res.status(StatusCodes.OK).json({
    success: true,
    message: "User approved successfully",
    data: user
  });
});

// Decline user
export const declineUserController = asyncHandler(async (req, res) => {
  // Check if user is admin
  if (req.user.role !== "ADMIN") {
    return res.status(StatusCodes.FORBIDDEN).json({
      success: false,
      message: "Only admins can decline users"
    });
  }

  const { userId } = req.params;
  const { reason } = req.body;
  const user = await declineUser(userId, reason);

  res.status(StatusCodes.OK).json({
    success: true,
    message: "User declined successfully",
    data: user
  });
});

// CREATE EVENT FROM MODULE
export const createEventFromModuleController = asyncHandler(async (req, res) => {
  if (req.user.role !== 'ADMIN') {
    throw new ApiError(StatusCodes.FORBIDDEN, "Admin role required");
  }

  const { moduleId } = req.body;
  if (!moduleId) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "moduleId is required");
  }

  const event = await createEventFromModule(moduleId, req.body, req.user.id);
  res.status(StatusCodes.CREATED).json({ success: true, data: event });
});

// GET EVENT ANALYTICS
export const getEventAnalyticsController = asyncHandler(async (req, res) => {
  if (req.user.role !== "ADMIN") {
    throw new ApiError(StatusCodes.FORBIDDEN, "Admin role required");
  }

  const filters = {
    courseId: req.query.courseId,
    moduleId: req.query.moduleId
  };

  const analytics = await getEventAnalytics(filters);
  res.status(StatusCodes.OK).json({ success: true, data: analytics });
});

// GET WORKSHOP ANALYTICS TABLE
export const getWorkshopAnalyticsTableController = asyncHandler(async (req, res) => {
  if (req.user.role !== "ADMIN") {
    throw new ApiError(StatusCodes.FORBIDDEN, "Admin role required");
  }
  const data = await getWorkshopAnalyticsTable();
  res.status(StatusCodes.OK).json({ success: true, data });
});

// GET COURSE STAFF (associate instructors + volunteers)
export const getCourseStaffController = asyncHandler(async (req, res) => {
  if (req.user.role !== "ADMIN") {
    throw new ApiError(StatusCodes.FORBIDDEN, "Admin role required");
  }
  const { courseId } = req.params;
  const data = await getCourseStaff(courseId);
  res.status(StatusCodes.OK).json({ success: true, data });
});

// EXPORT MASTER EXCEL (4 sheets)
export const exportExcelController = asyncHandler(async (req, res) => {
  if (req.user.role !== "ADMIN") {
    throw new ApiError(StatusCodes.FORBIDDEN, "Admin role required");
  }
  const buffer = await generateExcelExport();
  const filename = `flourishing-hub-report-${new Date().toISOString().split('T')[0]}.xlsx`;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.status(StatusCodes.OK).send(buffer);
});
