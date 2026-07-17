import { prisma } from "../database/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { StatusCodes } from "http-status-codes";
import { generateOTP, sendOTPEmail } from "./email.service.js";
import { autoAssignCohortOnSignup } from "./batchAssignment.service.js";

// Create and send OTP
export const createAndSendOTP = async (userId, email, name) => {
  try {
    // Generate OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Invalidate any existing OTPs for this user
    await prisma.emailVerification.updateMany({
      where: {
        userId,
        isUsed: false
      },
      data: {
        isUsed: true
      }
    });

    // Create new OTP record
    await prisma.emailVerification.create({
      data: {
        userId,
        otp,
        expiresAt,
        attempts: 0,
        isUsed: false
      }
    });

    // Send OTP email
    await sendOTPEmail(email, name, otp);

    return { success: true };
  } catch (error) {
    console.error("Error creating and sending OTP:", error);
    throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, "Failed to send OTP");
  }
};

// Verify OTP
export const verifyOTP = async (userId, otp) => {
  try {
    // Find the OTP record
    const otpRecord = await prisma.emailVerification.findFirst({
      where: {
        userId,
        otp,
        isUsed: false
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    if (!otpRecord) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid OTP");
    }

    // Check if OTP is expired
    if (new Date() > otpRecord.expiresAt) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "OTP has expired");
    }

    // Check attempts (max 5 attempts)
    if (otpRecord.attempts >= 5) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Maximum attempts exceeded. Please request a new OTP");
    }

    // Atomically claim this OTP (increment attempts + mark used in one
    // conditional write). Two near-simultaneous verify calls for the same
    // OTP — a double-tap, or two open tabs — would otherwise both pass the
    // `isUsed: false` check above before either commits, both mark the user
    // verified, and both trigger a second welcome email. Scoping the update
    // to `isUsed: false` means only the first of the two can ever match.
    const claimed = await prisma.emailVerification.updateMany({
      where: { id: otpRecord.id, isUsed: false },
      data: {
        attempts: otpRecord.attempts + 1,
        isUsed: true
      }
    });

    if (claimed.count === 0) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid OTP");
    }

    // Mark user as verified
    const verifiedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        isVerified: true
      },
      include: { studentProfile: true }
    });

    // Batch/cohort matching is deliberately deferred to here (not signup)
    // — see the comment in auth.service.js's register(). Only now is it
    // actually proven this is who they say they are.
    if (verifiedUser.studentProfile) {
      await autoAssignCohortOnSignup(
        verifiedUser.id,
        verifiedUser.email,
        verifiedUser.studentProfile.rollNumber
      ).catch(() => {});
    }

    return { success: true };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    console.error("Error verifying OTP:", error);
    throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, "Failed to verify OTP");
  }
};

// Resend OTP
export const resendOTP = async (userId) => {
  try {
    // Get user details
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new ApiError(StatusCodes.NOT_FOUND, "User not found");
    }

    if (user.isVerified) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Email already verified");
    }

    // Check if user has requested OTP recently (rate limiting - 1 minute)
    const recentOTP = await prisma.emailVerification.findFirst({
      where: {
        userId,
        createdAt: {
          gte: new Date(Date.now() - 60 * 1000) // Last 1 minute
        }
      }
    });

    if (recentOTP) {
      throw new ApiError(StatusCodes.TOO_MANY_REQUESTS, "Please wait before requesting a new OTP");
    }

    // Create and send new OTP
    return await createAndSendOTP(userId, user.email, user.name);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    console.error("Error resending OTP:", error);
    throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, "Failed to resend OTP");
  }
};
