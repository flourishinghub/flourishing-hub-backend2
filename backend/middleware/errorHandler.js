import { StatusCodes } from "http-status-codes";

import { ApiError } from "../utils/ApiError.js";

export const errorHandler = (error, _req, res, _next) => {
  const statusCode = error.statusCode || StatusCodes.INTERNAL_SERVER_ERROR;
  const isKnownError = error instanceof ApiError;
  const isProduction = process.env.NODE_ENV === "production";

  // Unexpected/unhandled errors (e.g. raw Prisma exceptions) can contain internal
  // details — table/column names, query fragments, stack info. Only forward the
  // real message in production for errors we deliberately threw as ApiError with a
  // safe, user-facing message. Always log the real error server-side.
  if (!isKnownError) {
    console.error("Unhandled error:", error);
  }

  const message = !isProduction || isKnownError ? error.message || "Something went wrong" : "Something went wrong";

  res.status(statusCode).json({
    success: false,
    message,
    details: isKnownError ? error.details || null : null
  });
};



