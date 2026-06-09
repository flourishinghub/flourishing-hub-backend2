import { StatusCodes } from "http-status-codes";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  getUserNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getUnreadCount
} from "../services/notification.service.js";

export const getNotificationsController = asyncHandler(async (req, res) => {
  const notifications = await getUserNotifications(req.user.id);
  const unreadCount = await getUnreadCount(req.user.id);
  res.status(StatusCodes.OK).json({ success: true, data: { notifications, unreadCount } });
});

export const markReadController = asyncHandler(async (req, res) => {
  await markNotificationRead(req.params.id, req.user.id);
  res.status(StatusCodes.OK).json({ success: true });
});

export const markAllReadController = asyncHandler(async (req, res) => {
  await markAllNotificationsRead(req.user.id);
  res.status(StatusCodes.OK).json({ success: true });
});
