import cron from "node-cron";
import { env } from "../config/index.js";
import { prisma } from "../database/prisma.js";
import { buildWellnessGradesTable } from "../services/wellnessGradesExport.service.js";
import { postTabsToSheet } from "../services/sheetWebApp.service.js";

// Keeps one Google Sheet with the live Wellness Student-view grades, so the
// course coordinator always opens the same file instead of receiving a new CSV
// after every session. Same rows and columns as the admin Student view CSV
// export (Course = Wellness Workshop, other filters "All"), minus test accounts.

const DATA_TAB = "Wellness Grades";
const INFO_TAB = "About";
// Arbitrary constant: only one backend instance syncs at a time.
const SYNC_LOCK_KEY = 74_301_022;

const istStamp = (d) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 16).replace("T", " ") + " IST";

export const isWellnessSheetConfigured = () => Boolean(env.WELLNESS_SHEET_WEBAPP_URL && env.WELLNESS_SHEET_SECRET);

export const syncWellnessGradesSheet = async () => {
  if (!isWellnessSheetConfigured()) throw new Error("WELLNESS_SHEET_WEBAPP_URL / WELLNESS_SHEET_SECRET not set");
  const started = new Date();
  const { header, rows } = await buildWellnessGradesTable({ excludeRolls: env.WELLNESS_SHEET_EXCLUDE_ROLLS });
  const written = await postTabsToSheet(env.WELLNESS_SHEET_WEBAPP_URL, env.WELLNESS_SHEET_SECRET, [
    { title: DATA_TAB, values: [header, ...rows] },
    {
      title: INFO_TAB,
      values: [
        ["Last updated", istStamp(new Date())],
        ["Students", String(rows.length)],
        ["Source", "Flourishing Hub admin → Analytics → Student view, Course = Wellness Workshop, other filters All"],
        ["Note", `Updated automatically by the website (schedule "${env.WELLNESS_SHEET_CRON}", UTC). Edits in the "${DATA_TAB}" tab are overwritten; copy it to another tab to work on it.`]
      ]
    }
  ]);
  return { students: rows.length, columns: header.length, written, seconds: Math.round((Date.now() - started) / 1000) };
};

// Every Render instance runs this cron; a transaction-scoped advisory lock lets
// only one of them do the (heavy) rebuild per tick.
const syncWithLock = async () => {
  try {
    await prisma.$transaction(
      async (tx) => {
        const [{ locked }] = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(${SYNC_LOCK_KEY}) AS locked`;
        if (!locked) return;
        const r = await syncWellnessGradesSheet();
        console.log(`[wellness-sheet] synced ${r.students} students in ${r.seconds}s`);
      },
      { maxWait: 10_000, timeout: 15 * 60_000 }
    );
  } catch (err) {
    console.error("[wellness-sheet] sync failed:", err.message);
  }
};

export const startWellnessSheetCron = () => {
  if (!isWellnessSheetConfigured()) {
    console.log("[wellness-sheet] not configured, cron not started");
    return;
  }
  cron.schedule(env.WELLNESS_SHEET_CRON, syncWithLock);
  console.log(`[wellness-sheet] cron started (${env.WELLNESS_SHEET_CRON})`);
};
