import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { authorize } from "../middleware/authorize.js";
import { validate } from "../middleware/validate.js";
import {
  getVideosController,
  getVideoByIdController,
  incrementVideoViewController,
  createVideoController,
  updateVideoController,
  deleteVideoController
} from "../controllers/video.controller.js";
import { createVideoSchema, updateVideoSchema } from "../validators/video.validation.js";

export const videoRoutes = Router();

// Public routes (authenticated users)
videoRoutes.get("/", authenticate, getVideosController);
videoRoutes.get("/:videoId", authenticate, getVideoByIdController);
videoRoutes.post("/:videoId/view", authenticate, incrementVideoViewController);

// Admin only routes
videoRoutes.post("/", authenticate, authorize("ADMIN"), validate(createVideoSchema), createVideoController);
videoRoutes.put("/:videoId", authenticate, authorize("ADMIN"), validate(updateVideoSchema), updateVideoController);
videoRoutes.delete("/:videoId", authenticate, authorize("ADMIN"), deleteVideoController);
