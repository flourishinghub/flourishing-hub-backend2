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
  removeStaffAssignmentController,
  getVolunteersController,
  getEventDetailsForAdminController,
  getPendingApprovalUsersController,
  approveUserController,
  declineUserController,
  createEventFromModuleController,
  getEventAnalyticsController,
  getWorkshopAnalyticsTableController
} from "../controllers/admin.controller.js";
import { authenticate } from "../middleware/auth.js";

export const adminRoutes = Router();

// Event Management
adminRoutes.post("/events", authenticate, createEventController);
adminRoutes.put("/events/:eventId", authenticate, modifyEventController);
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
