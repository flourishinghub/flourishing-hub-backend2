import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { cacheResponse } from "../middleware/cacheResponse.js";
import {
  getNotificationsController,
  markReadController,
  markAllReadController
} from "../controllers/notification.controller.js";

export const notificationRoutes = Router();

notificationRoutes.use(authenticate);
// Polled every 30s by every logged-in session (any role) — was the
// single highest-traffic endpoint during the 14 Aug incident (3,131
// requests in 45 minutes) and had no caching at all. 15s TTL, invalidated
// immediately on mark-read below so read status never looks stale.
notificationRoutes.get("/", cacheResponse("notifications", 15), getNotificationsController);
notificationRoutes.patch("/:id/read", markReadController);
notificationRoutes.patch("/read-all", markAllReadController);
