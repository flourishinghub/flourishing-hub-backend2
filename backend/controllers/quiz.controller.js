import { StatusCodes } from "http-status-codes";
import { submitQuizResult, submitFormFeedback } from "../services/quiz.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const submitQuizResultController = asyncHandler(async (req, res) => {
  const { email, eventId, score, secret } = req.body;

  if (!email || !eventId || score === undefined || score === null || !secret) {
    return res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      message: "email, eventId, score, and secret are required"
    });
  }

  const result = await submitQuizResult({
    email,
    eventId,
    score: Number(score),
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
