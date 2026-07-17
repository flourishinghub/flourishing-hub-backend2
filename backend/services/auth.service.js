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
import { createAndSendOTP, resendOTP } from "./emailVerification.service.js";
import { autoAssignCohortOnSignup } from "./batchAssignment.service.js";

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
    where: { email: payload.email.toLowerCase() }
  });

  if (existingUser) {
    if (existingUser.isVerified) {
      throw new ApiError(StatusCodes.CONFLICT, "Email is already registered");
    }
    // Unverified account from an earlier, incomplete signup (e.g. the OTP email
    // never arrived, or they closed the tab before verifying) — instead of
    // permanently locking this email out with "already registered", resend a
    // fresh OTP for the same account so they can pick up where they left off.
    await resendOTP(existingUser.id).catch((err) => {
      console.error("OTP resend during re-registration failed:", err.message);
    });
    return {
      userId: existingUser.id,
      email: existingUser.email,
      name: existingUser.name,
      role: existingUser.role,
      isVerified: existingUser.isVerified,
      requiresOTP: true
    };
  }

  if ((payload.role === "STUDENT" || payload.role === "VOLUNTEER") && !payload.studentProfile) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Student or volunteer registration requires student profile details"
    );
  }

  const passwordHash = await bcrypt.hash(payload.password, 12);

  // Check if email is IITB email
  const isIITBEmail = payload.email.toLowerCase().endsWith('@iitb.ac.in');

  let user;
  try {
    user = await prisma.user.create({
      data: {
        name: payload.name,
        email: payload.email.toLowerCase(),
        passwordHash,
        role: payload.role,
        profileImageUrl: payload.profileImageUrl,
        isVerified: isIITBEmail ? false : true, // IITB emails need OTP, others need admin approval
        approvalStatus: isIITBEmail ? "APPROVED" : "PENDING_APPROVAL", // Non-IITB emails need admin approval
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
  } catch (error) {
    // A raw Prisma unique-constraint violation (P2002) previously fell
    // straight through to the global error handler's generic "Something
    // went wrong" — the earlier findUnique(email) check above doesn't catch
    // a duplicate rollNumber (StudentProfile.rollNumber is also @unique),
    // and two near-simultaneous signups with the same email can both pass
    // that check before either INSERT commits. Surface a specific,
    // actionable message for both instead of an opaque failure.
    if (error.code === "P2002") {
      const target = Array.isArray(error.meta?.target) ? error.meta.target.join(",") : String(error.meta?.target || "");
      if (target.includes("rollNumber")) {
        throw new ApiError(StatusCodes.CONFLICT, "This roll number / employee ID is already registered to another account.");
      }
      if (target.includes("email")) {
        throw new ApiError(StatusCodes.CONFLICT, "Email is already registered");
      }
      throw new ApiError(StatusCodes.CONFLICT, "An account with these details already exists.");
    }
    throw error;
  }

  // Auto-assign cohort if BatchAssignment record exists
  if (user.studentProfile) {
    await autoAssignCohortOnSignup(user.id, user.email, payload.studentProfile?.rollNumber).catch(() => {});
  }

  if (isIITBEmail) {
    // IITB email: send OTP for verification, but don't let a failed send (SMTP
    // outage, expired app password, etc.) fail the whole registration — the
    // user is already created above, so throwing here would return an error
    // to the student while leaving them stuck: signup "failed" yet retrying
    // with the same email now says "already registered". The verify-email
    // page's Resend OTP button covers getting a working code afterward.
    await createAndSendOTP(user.id, user.email, user.name).catch((err) => {
      console.error("OTP email failed during registration:", err.message);
    });

    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isVerified: user.isVerified,
      requiresOTP: true
    };
  } else {
    // Non-IITB email: Notify user about pending approval
    const { sendPendingApprovalEmail } = await import("./email.service.js");
    await sendPendingApprovalEmail(user.email, user.name).catch(err => 
      console.error("Failed to send pending approval email:", err)
    );
    
    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      approvalStatus: user.approvalStatus,
      requiresApproval: true,
      message: "Your account has been created and is pending admin approval. You will receive an email once approved."
    };
  }
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

  // Check approval status first
  if (user.approvalStatus === "PENDING_APPROVAL") {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "Your account is pending admin approval. You will receive an email once approved."
    );
  }

  if (user.approvalStatus === "DECLINED") {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "Your account registration has been declined by the admin."
    );
  }

  // Check if email is verified (for IITB emails)
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

export const forgotPassword = async (email) => {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) {
    // Don't reveal if email exists
    return { message: "If that email is registered, you'll receive a reset link shortly." };
  }

  const resetToken = crypto.randomBytes(32).toString('hex');

  await prisma.emailVerification.create({
    data: {
      userId: user.id,
      otp: resetToken,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    }
  });

  const clientUrl = process.env.CLIENT_URL || 'https://flourishing-hub-frontend2.vercel.app';
  const resetLink = `${clientUrl}/reset-password?token=${resetToken}&userId=${user.id}`;

  const { sendPasswordResetEmail } = await import('./email.service.js');
  await sendPasswordResetEmail(user.email, user.name, resetLink).catch(err =>
    console.error("Failed to send password reset email:", err)
  );

  return { message: "If that email is registered, you'll receive a reset link shortly." };
};

export const resetPassword = async (userId, token, newPassword) => {
  const record = await prisma.emailVerification.findFirst({
    where: {
      userId,
      otp: token,
      isUsed: false,
      expiresAt: { gt: new Date() }
    }
  });

  if (!record) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid or expired reset link. Please request a new one.");
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.emailVerification.update({ where: { id: record.id }, data: { isUsed: true } }),
    prisma.refreshToken.updateMany({ where: { userId }, data: { revokedAt: new Date() } }),
  ]);

  return { message: "Password reset successfully. Please login with your new password." };
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



