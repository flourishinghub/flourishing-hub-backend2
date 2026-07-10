import cron from "node-cron";
import { prisma } from "../database/prisma.js";
import { sendReminderEmail, sendTodayReminderEmail, sendSessionCompletedEmail } from "../services/email.service.js";
import { createNotificationsForUsers } from "../services/notification.service.js";

// IST is UTC+5:30 — "today" for a morning-of reminder means the IST calendar
// day, not the server's (UTC on Render) calendar day, which would roll over
// 5.5 hours early and miss/misfire around midnight IST.
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

const getTodayIstBounds = () => {
  const istNow = new Date(Date.now() + IST_OFFSET_MS);
  const y = istNow.getUTCFullYear();
  const m = istNow.getUTCMonth();
  const d = istNow.getUTCDate();
  return {
    from: new Date(Date.UTC(y, m, d, 0, 0, 0, 0) - IST_OFFSET_MS),
    to: new Date(Date.UTC(y, m, d, 23, 59, 59, 999) - IST_OFFSET_MS)
  };
};

const sendRemindersForWindow = async (fromOffset, toOffset, label) => {
  const now = new Date();
  const from = new Date(now.getTime() + fromOffset);
  const to   = new Date(now.getTime() + toOffset);

  const upcomingEvents = await prisma.event.findMany({
    where: { status: "PUBLISHED", startAt: { gte: from, lte: to } },
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

    if (userIds.length) {
      await createNotificationsForUsers(
        userIds,
        "REMINDER",
        `⏰ Reminder: ${event.title}`,
        `Your workshop "${event.title}" starts ${label} at ${new Date(event.startAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })} IST${event.venue ? ` — ${event.venue}` : ''}.`,
        event.id
      ).catch(() => {});
    }

    for (const user of uniqueUsers) {
      sendReminderEmail(user.email, user.name, event.title, event.startAt, event.venue).catch(() => {});
    }

    console.log(`[${label}] Sent reminders for: ${event.title} (${uniqueUsers.length} users)`);
  }
};

// Every event scheduled anywhere in today's IST calendar day gets one
// same-day morning email, separate from (and in addition to) the 24h/1h
// countdown reminders below.
const sendMorningOfReminders = async () => {
  const { from, to } = getTodayIstBounds();

  const todaysEvents = await prisma.event.findMany({
    where: { status: "PUBLISHED", startAt: { gte: from, lte: to } },
    include: {
      registrations: { include: { user: { select: { id: true, name: true, email: true } } } },
      assignments: { include: { user: { select: { id: true, name: true, email: true } } } }
    }
  });

  for (const event of todaysEvents) {
    const allUsers = [
      ...event.registrations.map(r => r.user),
      ...event.assignments.map(a => a.user)
    ];
    const uniqueUsers = [...new Map(allUsers.map(u => [u.id, u])).values()];
    const userIds = uniqueUsers.map(u => u.id);

    if (userIds.length) {
      await createNotificationsForUsers(
        userIds,
        "REMINDER",
        `📅 Today: ${event.title}`,
        `Your workshop "${event.title}" is today at ${new Date(event.startAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })} IST${event.venue ? ` — ${event.venue}` : ''}.`,
        event.id
      ).catch(() => {});
    }

    for (const user of uniqueUsers) {
      sendTodayReminderEmail(user.email, user.name, event.title, event.startAt, event.venue).catch(() => {});
    }

    console.log(`[morning-of] Sent today's-event reminders for: ${event.title} (${uniqueUsers.length} users)`);
  }
};

// Sends a "session completed" email 5 minutes after an event's endAt, once
// per event. Bounded to a 6–20-min-ago window (not just "endAt in the past")
// so a fresh deploy/restart never mass-emails every historical event that
// happens to still have completionEmailSentAt unset — and completionEmailSentAt
// itself is the de-dupe guard against re-sending on the next tick.
export const sendSessionCompletedNotices = async () => {
  const now = new Date();
  const endedAfter = new Date(now.getTime() - 20 * 60 * 1000);
  const endedBefore = new Date(now.getTime() - 6 * 60 * 1000);

  const justCompletedEvents = await prisma.event.findMany({
    where: {
      status: { not: "CANCELLED" },
      endAt: { gte: endedAfter, lte: endedBefore },
      completionEmailSentAt: null
    },
    include: {
      registrations: { include: { user: { select: { id: true, name: true, email: true } } } },
      assignments: { include: { user: { select: { id: true, name: true, email: true } } } }
    }
  });

  for (const event of justCompletedEvents) {
    // Mark first, before sending — if a send fails/hangs partway through the
    // user list, the next tick shouldn't re-email everyone who already got it.
    await prisma.event.update({ where: { id: event.id }, data: { completionEmailSentAt: now } });

    const allUsers = [
      ...event.registrations.map(r => r.user),
      ...event.assignments.map(a => a.user)
    ];
    const uniqueUsers = [...new Map(allUsers.map(u => [u.id, u])).values()];
    const userIds = uniqueUsers.map(u => u.id);

    if (userIds.length) {
      await createNotificationsForUsers(
        userIds,
        "REMINDER",
        `✅ Session Completed: ${event.title}`,
        `Your workshop "${event.title}" has ended${event.venue ? ` — ${event.venue}` : ''}.`,
        event.id
      ).catch(() => {});
    }

    for (const user of uniqueUsers) {
      sendSessionCompletedEmail(user.email, user.name, event.title, event.startAt, event.venue).catch(() => {});
    }

    console.log(`[session-completed] Sent completion notice for: ${event.title} (${uniqueUsers.length} users)`);
  }
};

// Runs every hour at minute 0, plus a dedicated daily run at 8:00 AM IST
// (02:30 UTC) for the same-day morning reminder.
export const startReminderCron = () => {
  cron.schedule("0 * * * *", async () => {
    try {
      // 24-hour reminder (23–25 hours window)
      await sendRemindersForWindow(23 * 60 * 60 * 1000, 25 * 60 * 60 * 1000, "tomorrow");
      // 1-hour reminder (55–65 minutes window)
      await sendRemindersForWindow(55 * 60 * 1000, 65 * 60 * 1000, "in 1 hour");
    } catch (err) {
      console.error("Reminder cron error:", err);
    }
  });

  // Explicit UTC timezone — this is the one schedule here that depends on
  // firing at an absolute instant (8:00 AM IST = 02:30 UTC); the hourly job
  // above doesn't care what timezone the server clock is in, but this one
  // would silently fire at the wrong IST time if the server's local zone
  // isn't UTC.
  cron.schedule("30 2 * * *", async () => {
    try {
      await sendMorningOfReminders();
    } catch (err) {
      console.error("Morning-of reminder cron error:", err);
    }
  }, { timezone: "UTC" });

  // Every minute — the 5-minutes-after-completion email needs much tighter
  // timing than the hourly job above can give.
  cron.schedule("* * * * *", async () => {
    try {
      await sendSessionCompletedNotices();
    } catch (err) {
      console.error("Session-completed reminder cron error:", err);
    }
  });

  console.log("Reminder cron job started (runs every hour — 24h & 1h reminders — plus a daily 8:00 AM IST same-day reminder — plus a per-minute session-completed check)");
};
