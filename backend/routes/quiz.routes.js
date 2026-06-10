import { Router } from "express";
import { submitQuizResultController } from "../controllers/quiz.controller.js";

export const quizRoutes = Router();

// Public endpoint — secured by QUIZ_WEBHOOK_SECRET in the body
// Called by Google Apps Script when student submits a quiz form
quizRoutes.post("/submit", submitQuizResultController);
