import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import {
  getNotificationsController,
  markReadController,
  markAllReadController
} from "../controllers/notification.controller.js";

export const notificationRoutes = Router();

notificationRoutes.use(authenticate);
notificationRoutes.get("/", getNotificationsController);
notificationRoutes.patch("/:id/read", markReadController);
notificationRoutes.patch("/read-all", markAllReadController);
