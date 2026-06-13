import { Router } from "express";

import {
  loginController,
  meController,
  refreshController,
  registerController,
  verifyOTPController,
  resendOTPController,
  forgotPasswordController,
  resetPasswordController
} from "../controllers/auth.controller.js";
import { authenticate } from "../middleware/auth.js";
import { authLimiter } from "../middleware/rateLimit.js";
import { validate } from "../middleware/validate.js";
import { loginSchema, refreshSchema, registerSchema } from "../validators/auth.validation.js";

export const authRoutes = Router();

authRoutes.post("/register", authLimiter, validate(registerSchema), registerController);
authRoutes.post("/login", authLimiter, validate(loginSchema), loginController);
authRoutes.post("/refresh", authLimiter, validate(refreshSchema), refreshController);
authRoutes.get("/me", authenticate, meController);

// OTP verification routes
authRoutes.post("/verify-otp", authLimiter, verifyOTPController);
authRoutes.post("/resend-otp", authLimiter, resendOTPController);

// Password reset routes
authRoutes.post("/forgot-password", authLimiter, forgotPasswordController);
authRoutes.post("/reset-password", authLimiter, resetPasswordController);




