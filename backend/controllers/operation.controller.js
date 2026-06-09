import { StatusCodes } from "http-status-codes";

import {
  assignEventStaff,
  createSelfCheckIn,
  markAttendance,
  reviewCheckIn,
  submitFeedback,
  updateAvailability,
  updateModuleProgress,
  getMyAttendance,
  getEventCheckIns,
  verifyAllCheckIns,
  getMyAssignedEvents,
  getEventRegistrants,
  getEventAssignedVolunteers,
  getMyCheckIn
} from "../services/operation.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const assignEventStaffController = asyncHandler(async (req, res) => {
  const data = await assignEventStaff(req.validated.params.eventId, req.validated.body, req.user);
  res.status(StatusCodes.CREATED).json({
    success: true,
    message: "Event staff assigned successfully",
    data
  });
});

export const markAttendanceController = asyncHandler(async (req, res) => {
  const data = await markAttendance(req.validated.params.eventId, req.validated.body, req.user);
  res.status(StatusCodes.OK).json({
    success: true,
    message: "Attendance updated successfully",
    data
  });
});

export const updateAvailabilityController = asyncHandler(async (req, res) => {
  const data = await updateAvailability(req.validated.params.eventId, req.validated.body, req.user);
  res.status(StatusCodes.OK).json({
    success: true,
    message: "Availability updated successfully",
    data
  });
});

export const selfCheckInController = asyncHandler(async (req, res) => {
  const data = await createSelfCheckIn(req.validated.params.eventId, req.validated.body, req.user);
  res.status(StatusCodes.CREATED).json({
    success: true,
    message: "Check-in submitted successfully",
    data
  });
});

export const reviewCheckInController = asyncHandler(async (req, res) => {
  const data = await reviewCheckIn(req.validated.params.checkInId, req.validated.body, req.user);
  res.status(StatusCodes.OK).json({
    success: true,
    message: "Check-in reviewed successfully",
    data
  });
});

export const submitFeedbackController = asyncHandler(async (req, res) => {
  const data = await submitFeedback(req.validated.params.eventId, req.validated.body, req.user);
  res.status(StatusCodes.OK).json({
    success: true,
    message: "Feedback submitted successfully",
    data
  });
});

export const updateModuleProgressController = asyncHandler(async (req, res) => {
  const data = await updateModuleProgress(req.validated.params.moduleId, req.validated.body, req.user);
  res.status(StatusCodes.OK).json({
    success: true,
    message: "Quiz score / module progress updated successfully",
    data
  });
});

export const getMyAttendanceController = asyncHandler(async (req, res) => {
  const data = await getMyAttendance(req.user.id);
  res.status(StatusCodes.OK).json({ success: true, data });
});

export const getEventCheckInsController = asyncHandler(async (req, res) => {
  const data = await getEventCheckIns(req.params.eventId, req.user);
  res.status(StatusCodes.OK).json({ success: true, data });
});

export const verifyAllCheckInsController = asyncHandler(async (req, res) => {
  const data = await verifyAllCheckIns(req.params.eventId, req.user);
  res.status(StatusCodes.OK).json({ success: true, message: "All pending check-ins verified", data });
});

export const getMyAssignedEventsController = asyncHandler(async (req, res) => {
  const data = await getMyAssignedEvents(req.user);
  res.status(StatusCodes.OK).json({ success: true, data });
});

export const getMyCheckInController = asyncHandler(async (req, res) => {
  const data = await getMyCheckIn(req.params.eventId, req.user);
  res.status(StatusCodes.OK).json({ success: true, data: data || null });
});

export const getEventRegistrantsController = asyncHandler(async (req, res) => {
  const data = await getEventRegistrants(req.params.eventId, req.user);
  res.status(StatusCodes.OK).json({ success: true, data });
});

export const getEventAssignedVolunteersController = asyncHandler(async (req, res) => {
  const data = await getEventAssignedVolunteers(req.params.eventId, req.user);
  res.status(StatusCodes.OK).json({ success: true, data });
});
