import { Router } from "express";
import { submitQuizResultController, submitFormFeedbackController } from "../controllers/quiz.controller.js";

export const quizRoutes = Router();

// Public endpoints — secured by QUIZ_WEBHOOK_SECRET in the body
// Called by Google Apps Script when student submits a quiz/feedback form
quizRoutes.post("/submit", submitQuizResultController);
quizRoutes.post("/feedback", submitFormFeedbackController);
