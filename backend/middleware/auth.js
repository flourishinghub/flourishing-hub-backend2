import { StatusCodes } from "http-status-codes";

import { prisma } from "../database/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { verifyAccessToken } from "../utils/jwt.js";

export const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.split(" ")[1] : null;

  if (!token) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, "Authentication required");
  }

  try {
    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({
      where: payload.sub ? { id: payload.sub } : { email: payload.email },
      include: {
        studentProfile: true,
        instructorProfile: true,
        adminProfile: true
      }
    });

    if (!user || !user.isActive) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, "User account is inactive");
    }

    req.user = user;
    req.frontendRole = typeof payload.frontendRole === "string" ? payload.frontendRole : undefined;
    next();
  } catch (error) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, "Authentication required");
  }
});

// Same as authenticate, but for public routes that still want to know who
// the caller is when a valid token happens to be sent (e.g. GET /events, so
// a logged-in student's batch-scoped visibility can be applied) — never
// rejects the request; just proceeds with no req.user if the token is
// missing, expired, or invalid.
export const authenticateOptional = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.split(" ")[1] : null;

  if (!token) {
    return next();
  }

  try {
    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({
      where: payload.sub ? { id: payload.sub } : { email: payload.email },
      include: {
        studentProfile: true,
        instructorProfile: true,
        adminProfile: true
      }
    });

    if (user?.isActive) {
      req.user = user;
      req.frontendRole = typeof payload.frontendRole === "string" ? payload.frontendRole : undefined;
    }
  } catch {
    // Invalid/expired token on a public route — proceed unauthenticated.
  }

  next();
});



