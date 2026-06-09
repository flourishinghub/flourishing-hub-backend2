import cron from "node-cron";
import { prisma } from "../database/prisma.js";
import { sendReminderEmail } from "../services/email.service.js";
import { createNotificationsForUsers } from "../services/notification.service.js";

// Runs every hour at minute 0 — checks for events starting in 24±1 hours
export const startReminderCron = () => {
  cron.schedule("0 * * * *", async () => {
    try {
      const now = new Date();
      const from = new Date(now.getTime() + 23 * 60 * 60 * 1000);
      const to = new Date(now.getTime() + 25 * 60 * 60 * 1000);

      const upcomingEvents = await prisma.event.findMany({
        where: {
          status: "PUBLISHED",
          startAt: { gte: from, lte: to }
        },
        include: {
          registrations: {
            include: { user: { select: { id: true, name: true, email: true } } }
          },
          assignments: {
            include: { user: { select: { id: true, name: true, email: true } } }
          }
        }
      });

      for (const event of upcomingEvents) {
        const allUsers = [
          ...event.registrations.map(r => r.user),
          ...event.assignments.map(a => a.user)
        ];

        const uniqueUsers = [...new Map(allUsers.map(u => [u.id, u])).values()];
        const userIds = uniqueUsers.map(u => u.id);

        // In-app notifications
        if (userIds.length) {
          await createNotificationsForUsers(
            userIds,
            "REMINDER",
            `Reminder: ${event.title}`,
            `Your workshop "${event.title}" is tomorrow at ${new Date(event.startAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })} IST`,
            event.id
          ).catch(() => {});
        }

        // Emails (non-blocking per user)
        for (const user of uniqueUsers) {
          sendReminderEmail(user.email, user.name, event.title, event.startAt, event.venue).catch(() => {});
        }

        console.log(`Sent reminders for event: ${event.title} (${uniqueUsers.length} users)`);
      }
    } catch (err) {
      console.error("Reminder cron error:", err);
    }
  });

  console.log("Reminder cron job started (runs every hour)");
};
