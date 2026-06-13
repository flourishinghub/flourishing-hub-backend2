import { StatusCodes } from "http-status-codes";

import { login, refreshUserToken, register, forgotPassword, resetPassword } from "../services/auth.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { verifyOTP, resendOTP } from "../services/emailVerification.service.js";
import { sendWelcomeEmail } from "../services/email.service.js";

export const registerController = asyncHandler(async (req, res) => {
  const response = await register(req.validated.body);
  res.status(StatusCodes.CREATED).json({
    success: true,
    message: "User registered successfully. Please check your email for OTP verification.",
    data: response
  });
});

export const loginController = asyncHandler(async (req, res) => {
  const response = await login(req.validated.body);
  res.status(StatusCodes.OK).json({
    success: true,
    message: "Login successful",
    data: response
  });
});

export const refreshController = asyncHandler(async (req, res) => {
  const response = await refreshUserToken(req.validated.body.refreshToken);
  res.status(StatusCodes.OK).json({
    success: true,
    message: "Token refreshed successfully",
    data: response
  });
});

export const meController = asyncHandler(async (req, res) => {
  res.status(StatusCodes.OK).json({
    success: true,
    data: req.user
  });
});

// Verify OTP
export const verifyOTPController = asyncHandler(async (req, res) => {
  const { userId, otp } = req.body;

  await verifyOTP(userId, otp);

  // Get user details to send welcome email
  const { prisma } = await import("../database/prisma.js");
  const user = await prisma.user.findUnique({
    where: { id: userId }
  });

  // Send welcome email (non-blocking)
  if (user) {
    sendWelcomeEmail(user.email, user.name, user.role).catch(err => 
      console.error("Failed to send welcome email:", err)
    );
  }

  res.status(StatusCodes.OK).json({
    success: true,
    message: "Email verified successfully"
  });
});

// Resend OTP
export const resendOTPController = asyncHandler(async (req, res) => {
  const { userId } = req.body;

  await resendOTP(userId);

  res.status(StatusCodes.OK).json({
    success: true,
    message: "OTP sent successfully"
  });
});

// Forgot Password
export const forgotPasswordController = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const result = await forgotPassword(email);
  res.status(StatusCodes.OK).json({ success: true, message: result.message });
});

// Reset Password
export const resetPasswordController = asyncHandler(async (req, res) => {
  const { userId, token, newPassword } = req.body;
  const result = await resetPassword(userId, token, newPassword);
  res.status(StatusCodes.OK).json({ success: true, message: result.message });
});



