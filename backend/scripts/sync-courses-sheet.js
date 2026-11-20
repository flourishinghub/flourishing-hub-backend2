// Rebuilds the live courses attendance Google Sheet (MTC + other courses, one tab
// each) now, without waiting for the cron. Run after a sheet upload:
//   node scripts/sync-courses-sheet.js
import { prisma } from "../database/prisma.js";
import { syncCoursesSheet } from "../cron/coursesSheetSync.cron.js";

try {
  const r = await syncCoursesSheet();
  console.log(`Courses sheet updated in ${r.seconds}s`);
  r.counts.forEach(([tab, , n]) => console.log(`  ${tab}: ${n} students`));
} catch (err) {
  console.error("Courses sheet sync failed:", err.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
