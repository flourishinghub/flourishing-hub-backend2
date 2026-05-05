import { Router } from "express";
import { getProfileController, updateProfileController } from "../controllers/profile.controller.js";
import { authenticate } from "../middleware/auth.js";

export const profileRoutes = Router();

// Get user profile
profileRoutes.get("/", authenticate, getProfileController);

// Update user profile
profileRoutes.put("/", authenticate, updateProfileController);