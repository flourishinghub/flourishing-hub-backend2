import { StatusCodes } from "http-status-codes";
import * as courseService from "../services/course.service.js";

export const getAllCourses = async (req, res, next) => {
  try {
    const { status } = req.query;
    const courses = await courseService.getAllCourses({ status });
    res.status(StatusCodes.OK).json({ success: true, data: courses });
  } catch (error) {
    next(error);
  }
};

export const getCourseById = async (req, res, next) => {
  try {
    const { courseId } = req.params;
    const course = await courseService.getCourseById(courseId);
    res.status(StatusCodes.OK).json({ success: true, data: course });
  } catch (error) {
    next(error);
  }
};

export const createCourse = async (req, res, next) => {
  try {
    const course = await courseService.createCourse(req.body);
    res.status(StatusCodes.CREATED).json({
      success: true,
      data: course,
      message: "Course created successfully",
    });
  } catch (error) {
    next(error);
  }
};

export const updateCourse = async (req, res, next) => {
  try {
    const { courseId } = req.params;
    const course = await courseService.updateCourse(courseId, req.body);
    res.status(StatusCodes.OK).json({
      success: true,
      data: course,
      message: "Course updated successfully",
    });
  } catch (error) {
    next(error);
  }
};

export const deleteCourse = async (req, res, next) => {
  try {
    const { courseId } = req.params;
    const result = await courseService.deleteCourse(courseId);
    res.status(StatusCodes.OK).json({ success: true, message: result.message });
  } catch (error) {
    next(error);
  }
};

export const getCourseAnalytics = async (req, res, next) => {
  try {
    const { courseId } = req.params;
    const analytics = await courseService.getCourseAnalytics(courseId);
    res.status(StatusCodes.OK).json({ success: true, data: analytics });
  } catch (error) {
    next(error);
  }
};

export const bulkEnrollToCourse = async (req, res, next) => {
  try {
    if (req.user.role !== "ADMIN") {
      return res.status(StatusCodes.FORBIDDEN).json({ success: false, message: "Admin only" });
    }
    const { courseId } = req.params;
    const { userEmails } = req.body;
    if (!Array.isArray(userEmails) || userEmails.length === 0) {
      return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: "userEmails array is required" });
    }
    const result = await courseService.bulkEnrollToCourse(courseId, userEmails);
    res.status(StatusCodes.OK).json({ success: true, data: result, message: `Enrolled ${result.enrolled} registrations across ${result.workshopCount} workshops` });
  } catch (error) {
    next(error);
  }
};
