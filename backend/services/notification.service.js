import { prisma } from "../database/prisma.js";

export const createNotification = async (userId, type, title, message, eventId = null) => {
  return prisma.notification.create({
    data: { userId, type, title, message, eventId }
  });
};

export const createNotificationsForUsers = async (userIds, type, title, message, eventId = null) => {
  return prisma.notification.createMany({
    data: userIds.map(userId => ({ userId, type, title, message, eventId }))
  });
};

export const getUserNotifications = async (userId) => {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50
  });
};

export const markNotificationRead = async (notificationId, userId) => {
  return prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { isRead: true }
  });
};

export const markAllNotificationsRead = async (userId) => {
  return prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true }
  });
};

export const getUnreadCount = async (userId) => {
  return prisma.notification.count({ where: { userId, isRead: false } });
};
