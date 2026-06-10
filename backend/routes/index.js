import { Router } from "express";

import { authRoutes } from "./auth.routes.js";
import { dashboardRoutes } from "./dashboard.routes.js";
import { eventRoutes } from "./event.routes.js";
import { frontendRoutes } from "./frontend.routes.js";
import { importRoutes } from "./import.routes.js";
import { operationRoutes } from "./operation.routes.js";
import { registrationRoutes } from "./registration.routes.js";
import { userRoutes } from "./user.routes.js";
import { adminRoutes } from "./admin.routes.js";
import { profileRoutes } from "./profile.routes.js";
import { videoRoutes } from "./video.routes.js";
import courseRoutes from "./course.routes.js";
import { notificationRoutes } from "./notification.routes.js";
import { quizRoutes } from "./quiz.routes.js";

export const router = Router();

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/events", eventRoutes);
router.use("/event-operations", operationRoutes);
router.use("/registrations", registrationRoutes);
router.use("/profile", profileRoutes); // Profile management routes
router.use("/", dashboardRoutes); // Mount dashboard routes at root level
router.use("/admin", adminRoutes); // Admin management routes
router.use("/imports", importRoutes);
router.use("/frontend", frontendRoutes);
router.use("/videos", videoRoutes); // Video library routes
router.use("/courses", courseRoutes); // Course management routes
router.use("/notifications", notificationRoutes);
router.use("/quiz", quizRoutes);




