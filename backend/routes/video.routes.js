import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import {
  getVideosController,
  getVideoByIdController,
  incrementVideoViewController,
  createVideoController,
  updateVideoController,
  deleteVideoController
} from "../controllers/video.controller.js";

export const videoRoutes = Router();

// Public routes (authenticated users)
videoRoutes.get("/", authenticate, getVideosController);
videoRoutes.get("/:videoId", authenticate, getVideoByIdController);
videoRoutes.post("/:videoId/view", authenticate, incrementVideoViewController);

// Admin only routes (role check done in controller)
videoRoutes.post("/", authenticate, createVideoController);
videoRoutes.put("/:videoId", authenticate, updateVideoController);
videoRoutes.delete("/:videoId", authenticate, deleteVideoController);
