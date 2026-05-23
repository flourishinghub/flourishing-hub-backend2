import bcrypt from "bcryptjs";
import { StatusCodes } from "http-status-codes";
import crypto from "node:crypto";

import { prisma } from "../database/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken
} from "../utils/jwt.js";
import { createAndSendOTP } from "./emailVerification.service.js";

const buildAuthResponse = async (user) => {
  const accessToken = signAccessToken({
    sub: user.id,
    role: user.role,
    email: user.email
  });

  const rawRefreshToken = signRefreshToken({
    sub: user.id,
    role: user.role
  });

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      token: crypto.createHash("sha256").update(rawRefreshToken).digest("hex"),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    }
  });

  return {
    accessToken,
    refreshToken: rawRefreshToken,
    user
  };
};

export const register = async (payload) => {
  if (payload.role === "ADMIN") {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "Admin accounts cannot be created through public registration"
    );
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: payload.email }
  });

  if (existingUser) {
    throw new ApiError(StatusCodes.CONFLICT, "Email is already registered");
  }

  if ((payload.role === "STUDENT" || payload.role === "VOLUNTEER") && !payload.studentProfile) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Student or volunteer registration requires student profile details"
    );
  }

  const passwordHash = await bcrypt.hash(payload.password, 12);

  const user = await prisma.user.create({
    data: {
      name: payload.name,
      email: payload.email.toLowerCase(),
      passwordHash,
      role: payload.role,
      profileImageUrl: payload.profileImageUrl,
      isVerified: false, // New users need to verify email
      studentProfile: payload.studentProfile
        ? {
            create: payload.studentProfile
          }
        : undefined,
      instructorProfile:
        payload.role === "INSTRUCTOR" || payload.instructorProfile
          ? {
              create: payload.instructorProfile || {}
            }
          : undefined,
      adminProfile: undefined
    },
    include: {
      studentProfile: true,
      instructorProfile: true,
      adminProfile: true
    }
  });

  // Send OTP email
  await createAndSendOTP(user.id, user.email, user.name);

  // Return user data without tokens (need to verify first)
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isVerified: user.isVerified
  };
};

export const login = async ({ email, password }) => {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: {
      studentProfile: true,
      instructorProfile: true,
      adminProfile: true
    }
  });

  if (!user) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, "Invalid credentials");
  }

  const validPassword = await bcrypt.compare(password, user.passwordHash);

  if (!validPassword) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, "Invalid credentials");
  }

  // Check if email is verified
  if (user.isVerified === false) {
    throw new ApiError(
      StatusCodes.FORBIDDEN, 
      "Please verify your email before logging in",
      { userId: user.id, email: user.email }
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() }
  });

  return buildAuthResponse(user);
};

export const refreshUserToken = async (refreshToken) => {
  const payload = verifyRefreshToken(refreshToken);
  const tokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");

  const storedToken = await prisma.refreshToken.findUnique({
    where: { token: tokenHash },
    include: { user: true }
  });

  if (!storedToken || storedToken.revokedAt || storedToken.expiresAt < new Date()) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, "Refresh token is invalid or expired");
  }

  const accessToken = signAccessToken({
    sub: payload.sub,
    role: payload.role
  });

  return { accessToken };
};



