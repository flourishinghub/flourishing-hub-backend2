import { StatusCodes } from "http-status-codes";
import { asyncHandler } from "../utils/asyncHandler.js";
import * as quizLibraryService from "../services/quizLibrary.service.js";

export const listQuizzesController = asyncHandler(async (req, res) => {
  const quizzes = await quizLibraryService.listQuizzes(req.query.search);
  res.status(StatusCodes.OK).json({ success: true, data: quizzes });
});

export const getQuizController = asyncHandler(async (req, res) => {
  const quiz = await quizLibraryService.getQuizById(req.params.id);
  res.status(StatusCodes.OK).json({ success: true, data: quiz });
});

export const createQuizController = asyncHandler(async (req, res) => {
  const quiz = await quizLibraryService.createQuiz(req.validated.body.title, req.validated.body.questions);
  res.status(StatusCodes.CREATED).json({ success: true, message: "Quiz created successfully", data: quiz });
});

export const updateQuizController = asyncHandler(async (req, res) => {
  const quiz = await quizLibraryService.updateQuizQuestions(
    req.params.id,
    req.validated.body.title,
    req.validated.body.questions
  );
  res.status(StatusCodes.OK).json({ success: true, message: "Quiz updated successfully", data: quiz });
});

export const getQuizUsageController = asyncHandler(async (req, res) => {
  const usage = await quizLibraryService.getQuizUsage(req.params.id);
  res.status(StatusCodes.OK).json({ success: true, data: usage });
});

export const deleteQuizController = asyncHandler(async (req, res) => {
  const result = await quizLibraryService.deleteQuiz(req.params.id);
  res.status(StatusCodes.OK).json({ success: true, message: result.message });
});
