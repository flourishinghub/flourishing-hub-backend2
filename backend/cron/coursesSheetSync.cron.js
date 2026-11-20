import cron from "node-cron";
import { env } from "../config/index.js";
import { prisma } from "../database/prisma.js";
import { getWorkshopAnalyticsTable } from "../services/admin.service.js";
import { buildCourseAttendanceTable } from "../services/courseAttendanceExport.service.js";
import { postTabsToSheet } from "../services/sheetWebApp.service.js";

// Keeps one Google Sheet with the live attendance of every course except
// Wellness (which has its own sheet, wellnessSheetSync.cron.js): one tab per
// course, the same rows and columns as the admin Student view CSV export for
// that course (other filters "All"), minus test accounts.

// [tab title, exact course name]
const COURSE_TABS = [
  ["MTC", "Mentor Training Course (2026-2027)"],
  ["CCFR", "Confident Communication for Researchers"],
  ["Confident Communication", "Confident Communication Course"],
  ["Emotional Fitness", "Emotional Fitness"],
  ["Interview Psychology", "Interview Psychology"],
  ["PFA", "Psychological First Aid"],
  ["Stress Management", "Stress Management"],
  ["Career Readiness", "Career Readiness Courses"],
  ["Crack that Interview", "Crack that Interview"]
];
const INFO_TAB = "About";
// Arbitrary constant, distinct from the Wellness sheet's: one instance syncs at a time.
const SYNC_LOCK_KEY = 74_301_023;

const istStamp = (d) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 16).replace("T", " ") + " IST";

export const isCoursesSheetConfigured = () => Boolean(env.COURSES_SHEET_WEBAPP_URL && env.COURSES_SHEET_SECRET);

export const syncCoursesSheet = async () => {
  if (!isCoursesSheetConfigured()) throw new Error("COURSES_SHEET_WEBAPP_URL / COURSES_SHEET_SECRET not set");
  const started = new Date();
  const workshops = await getWorkshopAnalyticsTable();
  const tabs = [];
  const counts = [];
  for (const [title, courseName] of COURSE_TABS) {
    const { header, rows } = await buildCourseAttendanceTable(courseName, {
      excludeRolls: env.WELLNESS_SHEET_EXCLUDE_ROLLS,
      workshops
    });
    tabs.push({ title, values: [header, ...rows] });
    counts.push([title, courseName, String(rows.length)]);
  }
  tabs.push({
    title: INFO_TAB,
    values: [
      ["Last updated", istStamp(new Date())],
      ["Source", "Flourishing Hub admin → Analytics → Student view, Course = the tab's course, other filters All"],
      ["Rule", "MTC: before 3 Oct 2026 check-in OR sheet = Present, from 3 Oct sheet only. Every other course: sheet only."],
      ["Note", `Updated automatically by the website (schedule "${env.COURSES_SHEET_CRON}", UTC). Edits in the course tabs are overwritten; copy a tab to work on it.`],
      [],
      ["Tab", "Course", "Students"],
      ...counts
    ]
  });
  const written = await postTabsToSheet(env.COURSES_SHEET_WEBAPP_URL, env.COURSES_SHEET_SECRET, tabs);
  return { counts, written, seconds: Math.round((Date.now() - started) / 1000) };
};

// Every Render instance runs this cron; a transaction-scoped advisory lock lets
// only one of them do the (heavy) rebuild per tick.
const syncWithLock = async () => {
  try {
    await prisma.$transaction(
      async (tx) => {
        const [{ locked }] = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(${SYNC_LOCK_KEY}) AS locked`;
        if (!locked) return;
        const r = await syncCoursesSheet();
        console.log(`[courses-sheet] synced ${r.counts.length} courses in ${r.seconds}s`);
      },
      { maxWait: 10_000, timeout: 15 * 60_000 }
    );
  } catch (err) {
    console.error("[courses-sheet] sync failed:", err.message);
  }
};

export const startCoursesSheetCron = () => {
  if (!isCoursesSheetConfigured()) {
    console.log("[courses-sheet] not configured, cron not started");
    return;
  }
  cron.schedule(env.COURSES_SHEET_CRON, syncWithLock);
  console.log(`[courses-sheet] cron started (${env.COURSES_SHEET_CRON})`);
};
