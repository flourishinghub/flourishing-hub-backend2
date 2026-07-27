import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { authorize } from "../middleware/authorize.js";
import { validate } from "../middleware/validate.js";
import {
  listQuizzesController,
  getQuizController,
  createQuizController,
  updateQuizController,
  getQuizUsageController,
  deleteQuizController
} from "../controllers/quizLibrary.controller.js";
import { createQuizLibrarySchema, updateQuizLibrarySchema } from "../validators/quiz.validation.js";

// Reusable Quiz-library CRUD — mounted at /quiz-library. Distinct from
// routes/quiz.routes.js, which is the legacy Google-Form webhook receiver
// mounted at /quiz (POST /quiz/submit, /quiz/feedback) and is unrelated.
export const quizLibraryRoutes = Router();

quizLibraryRoutes.get("/", authenticate, authorize("ADMIN"), listQuizzesController);
quizLibraryRoutes.get("/:id", authenticate, authorize("ADMIN"), getQuizController);
quizLibraryRoutes.get("/:id/usage", authenticate, authorize("ADMIN"), getQuizUsageController);
quizLibraryRoutes.post("/", authenticate, authorize("ADMIN"), validate(createQuizLibrarySchema), createQuizController);
quizLibraryRoutes.put("/:id", authenticate, authorize("ADMIN"), validate(updateQuizLibrarySchema), updateQuizController);
quizLibraryRoutes.delete("/:id", authenticate, authorize("ADMIN"), deleteQuizController);
