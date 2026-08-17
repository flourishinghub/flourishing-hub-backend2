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
  submitMyQuizController,
  getMyFeedbackFormController,
  submitMyFeedbackFormController,
  getEventLiveSummaryController,
  getEventQuizForStaffController,
  getEventFeedbackFormForStaffController
} from "../controllers/operation.controller.js";
import { authenticate } from "../middleware/auth.js";
import { cacheResponse } from "../middleware/cacheResponse.js";
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
import { feedbackFormSubmitSchema } from "../validators/feedback.validation.js";

export const operationRoutes = Router();

operationRoutes.use(authenticate);
// 6 parallel queries, hit on every dashboard mount — was uncached.
operationRoutes.get("/attendance/me", cacheResponse("my-attendance", 15), getMyAttendanceController);
operationRoutes.get("/my-assigned-events", getMyAssignedEventsController);
operationRoutes.get("/:eventId/check-ins", getEventCheckInsController);
operationRoutes.post("/:eventId/check-ins/verify-all", verifyAllCheckInsController);
operationRoutes.get("/:eventId/live-summary", getEventLiveSummaryController);
operationRoutes.get("/:eventId/staff-quiz", getEventQuizForStaffController);
operationRoutes.get("/:eventId/staff-feedback-form", getEventFeedbackFormForStaffController);
operationRoutes.get("/:eventId/my-check-in", cacheResponse("my-check-in", 4), getMyCheckInController);
operationRoutes.get("/:eventId/registrants", getEventRegistrantsController);
operationRoutes.get("/:eventId/event-volunteers", getEventAssignedVolunteersController);
operationRoutes.post("/:eventId/assignments", validate(assignmentSchema), assignEventStaffController);
operationRoutes.post("/:eventId/attendance", validate(attendanceSchema), markAttendanceController);
operationRoutes.post("/:eventId/availability", validate(availabilitySchema), updateAvailabilityController);
operationRoutes.post("/:eventId/check-ins", validate(selfCheckInSchema), selfCheckInController);
operationRoutes.patch("/check-ins/:checkInId", validate(reviewCheckInSchema), reviewCheckInController);
operationRoutes.post("/:eventId/feedback", validate(feedbackSchema), submitFeedbackController);
operationRoutes.post("/modules/:moduleId/progress", validate(moduleProgressSchema), updateModuleProgressController);
operationRoutes.get("/:eventId/my-progress", cacheResponse("my-progress", 8), getMyEventProgressController);
operationRoutes.get("/:eventId/my-feedback", getMyFeedbackController);
operationRoutes.get("/:eventId/quiz", cacheResponse("quiz", 8), getMyQuizController);
operationRoutes.post("/:eventId/quiz/submit", validate(quizSubmitSchema), submitMyQuizController);
operationRoutes.get("/:eventId/feedback-form", cacheResponse("feedback-form", 8), getMyFeedbackFormController);
operationRoutes.post(
  "/:eventId/feedback-form/submit",
  validate(feedbackFormSubmitSchema),
  submitMyFeedbackFormController
);
