import { StatusCodes } from "http-status-codes";
import { asyncHandler } from "../utils/asyncHandler.js";
import { cache } from "../utils/cache.js";
import {
  getUserNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getUnreadCount
} from "../services/notification.service.js";

// Matches the key cacheResponse builds for GET /notifications
// (routes/notification.routes.js) — cleared on any read-state change so a
// student never sees a stale unread badge for up to the cache's TTL.
const notificationsCacheKey = (userId) => `notifications:${userId}:/api/v1/notifications`;

export const getNotificationsController = asyncHandler(async (req, res) => {
  const notifications = await getUserNotifications(req.user.id);
  const unreadCount = await getUnreadCount(req.user.id);
  res.status(StatusCodes.OK).json({ success: true, data: { notifications, unreadCount } });
});

export const markReadController = asyncHandler(async (req, res) => {
  await markNotificationRead(req.params.id, req.user.id);
  cache.delete(notificationsCacheKey(req.user.id));
  res.status(StatusCodes.OK).json({ success: true });
});

export const markAllReadController = asyncHandler(async (req, res) => {
  await markAllNotificationsRead(req.user.id);
  cache.delete(notificationsCacheKey(req.user.id));
  res.status(StatusCodes.OK).json({ success: true });
});
