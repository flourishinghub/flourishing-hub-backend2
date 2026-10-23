import { getWorkshopAnalyticsTable } from "./admin.service.js";

// Builds the same table as the admin Student view CSV export for the Wellness
// course (Course = Wellness Workshop, every other filter "All"): one line per
// student, one result per module. This is a port of the frontend logic in
// app/admin/_components/tabs/analytics/filterUtils.ts (aggregateStudents,
// pickModuleSession, computeWellnessGrade) and StudentFilterView.tsx exportCSV.
// Keep the two in sync: a change there must be repeated here, or the Google
// Sheet and the downloaded CSV will disagree.

const WELLNESS_COURSE = "Wellness Workshop";
const PASS_MARK = 4;
const SESSION_RANK = { PRESENT: 3, PENDING: 2, ABSENT: 1 };
const NOT_SET = "—";

const sessionOver = (row) => !row.endAt || new Date(row.endAt).getTime() <= Date.now();

const computeWellnessGrade = (student, row) => {
  const physical = student.physicalSheetStatus === "PRESENT";
  const digital =
    student.checkInStatus === "CHECKED_IN_PENDING" ||
    student.checkInStatus === "CHECKED_IN_VERIFIED";
  const quizScore = student.quizScore ?? null;
  const quizPass = quizScore != null && quizScore >= PASS_MARK;
  let final;
  if (physical && digital && quizPass) final = "PRESENT";
  else if (!sessionOver(row)) final = "PENDING";
  else if (physical && digital && quizScore == null && !row.quizScoresAvailable) final = "PENDING";
  else final = "ABSENT";
  return { physical, digital, quizScore, quizPass, final };
};

// Best session of a module: result, then has a score, then evidence, then latest.
const sessionRank = ({ student, row }) => [
  SESSION_RANK[computeWellnessGrade(student, row).final],
  student.quizScore != null || student.score != null ? 1 : 0,
  (student.physicalSheetStatus === "PRESENT" ? 1 : 0) + (student.hasCheckedIn ? 1 : 0),
  new Date(row.date).getTime()
];

const pickModuleSession = (sessions) =>
  sessions.reduce((best, cur) => {
    const a = sessionRank(cur);
    const b = sessionRank(best);
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? cur : best;
    return best;
  });

const gradeLabel = (g) => (g.final === "PRESENT" ? "PP" : g.final === "PENDING" ? "Pending" : "NP");

/**
 * @param {{ excludeRolls?: string[] }} options rolls (any case) left out, e.g. test accounts
 * @returns {Promise<{ header: string[], rows: string[][] }>}
 */
export const buildWellnessGradesTable = async ({ excludeRolls = [] } = {}) => {
  const excluded = new Set(excludeRolls.map((r) => r.trim().toUpperCase()).filter(Boolean));
  const workshops = (await getWorkshopAnalyticsTable()).filter((r) => r.courseName === WELLNESS_COURSE);
  const moduleNames = [...new Set(workshops.map((r) => r.moduleName).filter((m) => m && m !== NOT_SET))].sort();

  const students = new Map();
  for (const row of workshops) {
    for (const student of row.students) {
      const roll = student.rollNo && student.rollNo !== NOT_SET ? student.rollNo.toUpperCase() : "";
      const key = student.userId || (roll ? `pending:${roll}` : `pending:${student.email}`);
      if (!students.has(key)) {
        students.set(key, {
          name: student.name,
          email: student.email,
          rollNo: student.rollNo,
          batches: [],
          present: 0,
          marked: 0,
          sessionsByModule: new Map()
        });
      }
      const agg = students.get(key);
      if (student.batch && student.batch !== NOT_SET && !agg.batches.includes(student.batch)) {
        agg.batches.push(student.batch);
      }
      const moduleKey = row.moduleName && row.moduleName !== NOT_SET ? row.moduleName : `event:${row.id}`;
      if (!agg.sessionsByModule.has(moduleKey)) agg.sessionsByModule.set(moduleKey, []);
      agg.sessionsByModule.get(moduleKey).push({ student, row });
    }
  }

  const header = ["Roll No", "Student Name", "Email", "Batch", "Attendance % (module-wise)"];
  for (const m of moduleNames) {
    for (const col of ["Batch", "Physical Attendance", "Digital Attendance", "Quiz (out of 10)", "Quiz Result", "Grade"]) {
      header.push(`${m} — ${col}`);
    }
  }

  const rows = [];
  // Same row order as the website export (filterUtils.ts aggregateStudents).
  const ordered = [...students.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const agg of ordered) {
    if (excluded.has(String(agg.rollNo || "").toUpperCase())) continue;
    // Attendance % denominator = every module of the course, completed or pending.
    agg.marked = moduleNames.length;
    const grades = {};
    const batchesByModule = {};
    for (const [moduleKey, sessions] of agg.sessionsByModule) {
      const chosen = pickModuleSession(sessions);
      const g = computeWellnessGrade(chosen.student, chosen.row);
      if (g.final === "PRESENT") agg.present++;
      if (moduleKey.startsWith("event:")) {
        agg.marked++;
        continue;
      }
      // Score fallback from another session of the same module.
      if (g.quizScore == null) {
        const other = sessions.map((x) => x.student.quizScore).find((q) => q != null);
        if (other != null) {
          g.quizScore = other;
          g.quizPass = other >= PASS_MARK;
        }
      }
      grades[moduleKey] = g;
      batchesByModule[moduleKey] = [...sessions]
        .sort((a, b) => new Date(a.row.date) - new Date(b.row.date))
        .map((x) => x.row.batch || x.student.batch)
        .filter((b) => b && b !== NOT_SET);
    }

    const line = [
      agg.rollNo,
      agg.name,
      agg.email,
      agg.batches.join(", ") || NOT_SET,
      agg.marked > 0 ? `${Math.round((agg.present / agg.marked) * 100)}%` : NOT_SET
    ];
    for (const m of moduleNames) {
      const g = grades[m];
      if (!g) {
        // No session in this module: NP grade, other cells empty (frontend d5c9f4f).
        line.push(NOT_SET, NOT_SET, NOT_SET, NOT_SET, NOT_SET, "NP");
        continue;
      }
      line.push(
        batchesByModule[m]?.length ? batchesByModule[m].join(" → ") : NOT_SET,
        g.physical ? "Present" : "Absent",
        g.digital ? "Present" : "Absent",
        g.quizScore != null ? String(g.quizScore) : NOT_SET,
        g.quizScore != null ? (g.quizPass ? "PP" : "NP") : g.final === "PENDING" ? "Pending" : "NP",
        gradeLabel(g)
      );
    }
    rows.push(line.map((v) => (v == null ? "" : String(v))));
  }

  return { header, rows };
};
