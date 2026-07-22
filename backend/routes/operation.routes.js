import { Router } from "express";

import {
  assignEventStaffController,
  markAttendanceController,
  reviewCheckInController,
  selfCheckInController,
  submitFeedbackController,
  updateAvailabilityController,
  updateModuleProgressController,
  getMyAttendanceController,
  getEventCheckInsController,
  verifyAllCheckInsController,
  getMyAssignedEventsController,
  getEventRegistrantsController,
  getEventAssignedVolunteersController,
  getMyCheckInController,
  getMyEventProgressController,
  getMyFeedbackController,
  getMyQuizController,
  submitMyQuizController
} from "../controllers/operation.controller.js";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  assignmentSchema,
  attendanceSchema,
  availabilitySchema,
  feedbackSchema,
  moduleProgressSchema,
  reviewCheckInSchema,
  selfCheckInSchema
} from "../validators/operation.validation.js";
import { quizSubmitSchema } from "../validators/quiz.validation.js";

export const operationRoutes = Router();

operationRoutes.use(authenticate);
operationRoutes.get("/attendance/me", getMyAttendanceController);
operationRoutes.get("/my-assigned-events", getMyAssignedEventsController);
operationRoutes.get("/:eventId/check-ins", getEventCheckInsController);
operationRoutes.post("/:eventId/check-ins/verify-all", verifyAllCheckInsController);
operationRoutes.get("/:eventId/my-check-in", getMyCheckInController);
operationRoutes.get("/:eventId/registrants", getEventRegistrantsController);
operationRoutes.get("/:eventId/event-volunteers", getEventAssignedVolunteersController);
operationRoutes.post("/:eventId/assignments", validate(assignmentSchema), assignEventStaffController);
operationRoutes.post("/:eventId/attendance", validate(attendanceSchema), markAttendanceController);
operationRoutes.post("/:eventId/availability", validate(availabilitySchema), updateAvailabilityController);
operationRoutes.post("/:eventId/check-ins", validate(selfCheckInSchema), selfCheckInController);
operationRoutes.patch("/check-ins/:checkInId", validate(reviewCheckInSchema), reviewCheckInController);
operationRoutes.post("/:eventId/feedback", validate(feedbackSchema), submitFeedbackController);
operationRoutes.post("/modules/:moduleId/progress", validate(moduleProgressSchema), updateModuleProgressController);
operationRoutes.get("/:eventId/my-progress", getMyEventProgressController);
operationRoutes.get("/:eventId/my-feedback", getMyFeedbackController);
operationRoutes.get("/:eventId/quiz", getMyQuizController);
operationRoutes.post("/:eventId/quiz/submit", validate(quizSubmitSchema), submitMyQuizController);
