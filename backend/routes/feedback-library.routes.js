import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { authorize } from "../middleware/authorize.js";
import { validate } from "../middleware/validate.js";
import {
  listFormsController,
  getFormController,
  createFormController,
  updateFormController,
  getFormUsageController,
  deleteFormController
} from "../controllers/feedbackLibrary.controller.js";
import { createFeedbackFormSchema, updateFeedbackFormSchema } from "../validators/feedback.validation.js";

// Reusable Feedback-library CRUD — mounted at /feedback-library. Same
// reference-by-id architecture as /quiz-library (see quiz-library.routes.js).
export const feedbackLibraryRoutes = Router();

feedbackLibraryRoutes.get("/", authenticate, authorize("ADMIN"), listFormsController);
feedbackLibraryRoutes.get("/:id", authenticate, authorize("ADMIN"), getFormController);
feedbackLibraryRoutes.get("/:id/usage", authenticate, authorize("ADMIN"), getFormUsageController);
feedbackLibraryRoutes.post(
  "/",
  authenticate,
  authorize("ADMIN"),
  validate(createFeedbackFormSchema),
  createFormController
);
feedbackLibraryRoutes.put(
  "/:id",
  authenticate,
  authorize("ADMIN"),
  validate(updateFeedbackFormSchema),
  updateFormController
);
feedbackLibraryRoutes.delete("/:id", authenticate, authorize("ADMIN"), deleteFormController);
