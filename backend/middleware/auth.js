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



