import { Router } from "express";

import {
  myDashboardController,
  studentDashboardController,
  instructorDashboardController,
  volunteerDashboardController,
  associateDashboardController,
  adminDashboardController,
  studentBundleProgressController,
  instructorFeedbackController,
  volunteerCapacityController,
} from "../controllers/dashboard.controller.js";
import { authenticate } from "../middleware/auth.js";
import { cacheResponse } from "../middleware/cacheResponse.js";

export const dashboardRoutes = Router();

// Legacy endpoint
dashboardRoutes.get("/dashboards/me", authenticate, cacheResponse("dashboard", 20), myDashboardController);

// Direct role-specific dashboard endpoints
dashboardRoutes.get("/student/dashboard", authenticate, cacheResponse("student-dashboard", 20), studentDashboardController);
dashboardRoutes.get("/instructor/dashboard", authenticate, cacheResponse("instructor-dashboard", 20), instructorDashboardController);
dashboardRoutes.get("/volunteer/dashboard", authenticate, cacheResponse("volunteer-dashboard", 20), volunteerDashboardController);
dashboardRoutes.get("/associate/dashboard", authenticate, cacheResponse("associate-dashboard", 20), associateDashboardController);
dashboardRoutes.get("/admin/dashboard", authenticate, cacheResponse("admin-dashboard", 20), adminDashboardController);

// New feature endpoints
dashboardRoutes.get("/student/bundle-progress", authenticate, studentBundleProgressController);
dashboardRoutes.get("/instructor/feedback", authenticate, instructorFeedbackController);
dashboardRoutes.get("/volunteer/capacity", authenticate, volunteerCapacityController);




