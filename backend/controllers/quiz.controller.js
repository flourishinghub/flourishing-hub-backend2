import { StatusCodes } from "http-status-codes";
import { submitQuizResult } from "../services/quiz.service.js";
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
