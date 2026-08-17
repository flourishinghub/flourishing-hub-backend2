import { StatusCodes } from "http-status-codes";

import { prisma } from "../database/prisma.js";
import { cache } from "../utils/cache.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { verifyAccessToken } from "../utils/jwt.js";

// Every authenticated request re-ran this exact lookup from scratch — under
// concurrent load (e.g. hundreds of students polling their dashboard/
// check-in status every few seconds) that's the same user row fetched
// dozens of times a second. A short TTL cache collapses that to one DB hit
// per user per window; 5s is short enough that a role/approval-status
// change (rare, admin-driven) is still visible almost immediately.
const AUTH_CACHE_TTL_SECONDS = 5;

const loadUser = async (payload) => {
  const cacheKey = `auth-user:${payload.sub || payload.email}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const user = await prisma.user.findUnique({
    where: payload.sub ? { id: payload.sub } : { email: payload.email },
    include: {
      studentProfile: true,
      instructorProfile: true,
      adminProfile: true
    }
  });

  if (user) cache.set(cacheKey, user, AUTH_CACHE_TTL_SECONDS);
  return user;
};

export const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.split(" ")[1] : null;

  if (!token) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, "Authentication required");
  }

  try {
    const payload = verifyAccessToken(token);
    const user = await loadUser(payload);

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
    const user = await loadUser(payload);

    if (user?.isActive) {
      req.user = user;
      req.frontendRole = typeof payload.frontendRole === "string" ? payload.frontendRole : undefined;
    }
  } catch {
    // Invalid/expired token on a public route — proceed unauthenticated.
  }

  next();
});



