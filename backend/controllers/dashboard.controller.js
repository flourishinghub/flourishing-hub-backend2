import { StatusCodes } from "http-status-codes";

import {
  getAdminDashboard,
  getStaffDashboard,
  getStudentDashboard,
  getStudentDashboardData,
  getInstructorDashboardData,
  getVolunteerDashboardData,
  getAssociateDashboardData,
  getAdminDashboardData,
  getStudentBundleProgress,
  getInstructorFeedback,
  getVolunteerCapacity,
} from "../services/dashboard.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";

export const myDashboardController = asyncHandler(async (req, res) => {
  let data;

  if (req.user.role === "ADMIN") {
    data = await getAdminDashboard();
  } else if (["INSTRUCTOR", "VOLUNTEER"].includes(req.user.role)) {
    data = await getStaffDashboard(req.user.id);
  } else {
    data = await getStudentDashboard(req.user.id);
  }

  res.status(StatusCodes.OK).json({
    success: true,
    data
  });
});

export const studentDashboardController = asyncHandler(async (req, res) => {
  if (!req.user.studentProfile) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Student profile not found");
  }

  const data = await getStudentDashboardData(req.user.id);
  
  res.status(StatusCodes.OK).json({
    success: true,
    data
  });
});

export const instructorDashboardController = asyncHandler(async (req, res) => {
  if (!req.user.instructorProfile) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Instructor profile not found");
  }

  const data = await getInstructorDashboardData(req.user.id);
  
  res.status(StatusCodes.OK).json({
    success: true,
    data
  });
});

export const volunteerDashboardController = asyncHandler(async (req, res) => {
  if (req.user.role !== "VOLUNTEER") {
    throw new ApiError(StatusCodes.FORBIDDEN, "Volunteer role required");
  }

  const data = await getVolunteerDashboardData(req.user.id);

  res.status(StatusCodes.OK).json({
    success: true,
    data
  });
});

export const associateDashboardController = asyncHandler(async (req, res) => {
  if (req.user.role !== "ASSOCIATE_INSTRUCTOR") {
    throw new ApiError(StatusCodes.FORBIDDEN, "Associate instructor role required");
  }

  const data = await getAssociateDashboardData(req.user.id);

  res.status(StatusCodes.OK).json({
    success: true,
    data
  });
});

export const adminDashboardController = asyncHandler(async (req, res) => {
  if (req.user.role !== 'ADMIN') {
    throw new ApiError(StatusCodes.FORBIDDEN, "Admin role required");
  }

  const data = await getAdminDashboardData();

  res.status(StatusCodes.OK).json({
    success: true,
    data
  });
});

export const studentBundleProgressController = asyncHandler(async (req, res) => {
  if (req.user.role !== "STUDENT") {
    throw new ApiError(StatusCodes.FORBIDDEN, "Student role required");
  }

  const data = await getStudentBundleProgress(req.user.id);
  res.status(StatusCodes.OK).json({ success: true, data });
});

export const instructorFeedbackController = asyncHandler(async (req, res) => {
  if (!["INSTRUCTOR", "ASSOCIATE_INSTRUCTOR"].includes(req.user.role)) {
    throw new ApiError(StatusCodes.FORBIDDEN, "Instructor role required");
  }
  const data = await getInstructorFeedback(req.user.id);
  res.status(StatusCodes.OK).json({ success: true, data });
});

export const volunteerCapacityController = asyncHandler(async (req, res) => {
  if (req.user.role !== "VOLUNTEER") {
    throw new ApiError(StatusCodes.FORBIDDEN, "Volunteer role required");
  }

  const data = await getVolunteerCapacity(req.user.id);
  res.status(StatusCodes.OK).json({ success: true, data });
});



