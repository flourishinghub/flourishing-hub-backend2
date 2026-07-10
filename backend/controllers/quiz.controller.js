import { StatusCodes } from "http-status-codes";
import { submitQuizResult, submitFormFeedback } from "../services/quiz.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";

export const submitQuizResultController = asyncHandler(async (req, res) => {
  const { email, eventId, courseId, eventTitle, score, secret } = req.body;

  // Either eventId (single/optional workshop) or courseId (compulsory
  // course bundled across multiple per-batch events — resolved server-side
  // to whichever one this student is registered for) is required.
  if (!email || (!eventId && !courseId) || score === undefined || score === null || !secret) {
    return res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      message: "email, (eventId or courseId), score, and secret are required"
    });
  }

  const numericScore = Number(score);
  if (!Number.isFinite(numericScore) || numericScore < 0 || numericScore > 5) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "score must be a valid number between 0 and 5");
  }

  const result = await submitQuizResult({
    email,
    eventId,
    courseId,
    eventTitle,
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
  const { email, eventId, courseId, eventTitle, eventRating, instructorRating, eventComment, instructorComment, secret } = req.body;

  if (!email || (!eventId && !courseId) || eventRating === undefined || eventRating === null || !secret) {
    return res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      message: "email, (eventId or courseId), eventRating, and secret are required"
    });
  }

  const result = await submitFormFeedback({
    email,
    eventId,
    courseId,
    eventTitle,
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
