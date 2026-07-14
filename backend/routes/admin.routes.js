import { Router } from "express";

import {
  createEventController,
  modifyEventController,
  assignStaffController,
  assignVolunteersController,
  getMemberDirectoryController,
  getEventDetailsController,
  getAllEventsController,
  getAllEventsWithRegistrationsController,
  getEventWithRegistrationsController,
  deleteEventController,
  bulkDeleteEventsController,
  deleteEventsByCourseController,
  wipeAllEventsAndCoursesController,
  removeStaffAssignmentController,
  getVolunteersController,
  getEventDetailsForAdminController,
  getPendingApprovalUsersController,
  approveUserController,
  declineUserController,
  createEventFromModuleController,
  getEventAnalyticsController,
  getWorkshopAnalyticsTableController,
  getCourseStaffController,
  exportExcelController
} from "../controllers/admin.controller.js";
import { authenticate } from "../middleware/auth.js";

export const adminRoutes = Router();

// Event Management
adminRoutes.post("/events", authenticate, createEventController);
adminRoutes.put("/events/:eventId", authenticate, modifyEventController);
// These two must be declared before the generic "/events/:eventId" delete
// route below, otherwise Express would match "/events/bulk" as eventId="bulk".
adminRoutes.delete("/events/bulk", authenticate, bulkDeleteEventsController);
adminRoutes.delete("/events/course/:courseId", authenticate, deleteEventsByCourseController);
// DANGER ZONE — wipes every Event and every Course (not Users). Requires
// { confirm: "DELETE ALL" } in the body. Declared standalone since it isn't
// scoped to a single event/course.
adminRoutes.delete("/danger-zone/events-and-courses", authenticate, wipeAllEventsAndCoursesController);
adminRoutes.delete("/events/:eventId", authenticate, deleteEventController);
adminRoutes.get("/events", authenticate, getAllEventsController);
adminRoutes.get("/events-with-registrations", authenticate, getAllEventsWithRegistrationsController);
adminRoutes.get("/events/:eventId/details", authenticate, getEventDetailsForAdminController); // New detailed route
adminRoutes.get("/events/:eventId", authenticate, getEventDetailsController);
adminRoutes.get("/events/:eventId/registrations", authenticate, getEventWithRegistrationsController);

// Staff Assignment
adminRoutes.post("/assign-staff", authenticate, assignStaffController);
adminRoutes.post("/assign-volunteers", authenticate, assignVolunteersController);
adminRoutes.delete("/assignments/:assignmentId", authenticate, removeStaffAssignmentController);

// Member Directory
adminRoutes.get("/members", authenticate, getMemberDirectoryController);

// Volunteers Management
adminRoutes.get("/volunteers", authenticate, getVolunteersController);


// User Approval Management
adminRoutes.get("/pending-approvals", authenticate, getPendingApprovalUsersController);
adminRoutes.post("/users/:userId/approve", authenticate, approveUserController);
adminRoutes.post("/users/:userId/decline", authenticate, declineUserController);

// Workshop Analytics
adminRoutes.get("/events/analytics", authenticate, getEventAnalyticsController);
adminRoutes.get("/analytics/workshops", authenticate, getWorkshopAnalyticsTableController);

// Create Event from Module
adminRoutes.post("/events/from-module", authenticate, createEventFromModuleController);

// Course Staff
adminRoutes.get("/courses/:courseId/staff", authenticate, getCourseStaffController);

// Export Master Excel
adminRoutes.get("/analytics/export-excel", authenticate, exportExcelController);
