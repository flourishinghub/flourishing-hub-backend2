// Rebuilds the live Wellness grades Google Sheet now, without waiting for the cron.
// Run after a sheet or quiz upload: node scripts/sync-wellness-sheet.js
import { prisma } from "../database/prisma.js";
import { syncWellnessGradesSheet } from "../cron/wellnessSheetSync.cron.js";

try {
  const r = await syncWellnessGradesSheet();
  console.log(`Wellness sheet updated: ${r.students} students, ${r.columns} columns, ${r.seconds}s`, r.written);
} catch (err) {
  console.error("Wellness sheet sync failed:", err.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
