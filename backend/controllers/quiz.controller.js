import { StatusCodes } from "http-status-codes";
import { submitQuizResult, submitFormFeedback } from "../services/quiz.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";

export const submitQuizResultController = asyncHandler(async (req, res) => {
  const { email, eventId, score, secret } = req.body;

  if (!email || !eventId || score === undefined || score === null || !secret) {
    return res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      message: "email, eventId, score, and secret are required"
    });
  }

  const numericScore = Number(score);
  if (!Number.isFinite(numericScore) || numericScore < 0 || numericScore > 5) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "score must be a valid number between 0 and 5");
  }

  const result = await submitQuizResult({
    email,
    eventId,
    score: numericScore,
    secret
  });

  res.status(StatusCodes.OK).json({
    success: true,
    message: "Quiz result saved successfully",
    data: result
  });
});

// Called by Google Apps Script when the feedback/rating Form is submitted —
// used for compulsory workshops (alongside the quiz score above) and optional
// workshops (rating only, no quiz).
export const submitFormFeedbackController = asyncHandler(async (req, res) => {
  const { email, eventId, eventRating, instructorRating, eventComment, instructorComment, secret } = req.body;

  if (!email || !eventId || eventRating === undefined || eventRating === null || !secret) {
    return res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      message: "email, eventId, eventRating, and secret are required"
    });
  }

  const result = await submitFormFeedback({
    email,
    eventId,
    eventRating: Number(eventRating),
    instructorRating,
    eventComment,
    instructorComment,
    secret
  });

  res.status(StatusCodes.OK).json({
    success: true,
    message: "Feedback saved successfully",
    data: result
  });
});
