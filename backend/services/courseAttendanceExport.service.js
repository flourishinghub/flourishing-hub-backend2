import { getWorkshopAnalyticsTable } from "./admin.service.js";

// Builds, for one sheet-final course (MTC and the sheet-only courses), the same
// table as the admin Student view CSV export with Course = that course and every
// other filter "All": one line per student, one Final per module. This is a port
// of the frontend logic in app/admin/_components/tabs/analytics/filterUtils.ts
// (aggregateStudents, pickModuleSession, computeMtcFinal) and the MTC branch of
// StudentFilterView.tsx exportCSV. Keep them in sync: a change there must be
// repeated here, or the Google Sheet and the downloaded CSV will disagree.

const NOT_SET = "—";
const MTC_COURSE_PREFIX = "Mentor Training Course";
const MTC_SHEET_ONLY_FROM = new Date("2026-10-03T00:00:00+05:30").getTime();
// Same list as filterUtils.ts SHEET_ONLY_COURSES: Final = physical sheet only, every session.
const SHEET_ONLY_COURSES = [
  "Psychological First Aid", "Stress Management",
  "Emotional Fitness", "Confident Communication for Researchers", "Confident Communication Course",
  "Interview Psychology", "Crack that Interview", "Career Readiness Courses"
];
const FINAL_RANK = { PRESENT: 3, PENDING: 2, ABSENT: 1 };
const FINAL_LABEL = { PRESENT: "Present", ABSENT: "Absent", PENDING: "Pending" };
const CHECK_IN_LABEL = {
  NOT_CHECKED_IN: "Not Checked-in",
  CHECKED_IN_PENDING: "Checked-in (Pending)",
  CHECKED_IN_VERIFIED: "Checked-in (Verified)",
  CHECKED_IN_REJECTED: "Checked-in (Rejected)"
};

const isSheetOnly = (courseName) => SHEET_ONLY_COURSES.includes(courseName);
export const isSheetFinalCourse = (courseName) =>
  Boolean(courseName?.startsWith(MTC_COURSE_PREFIX)) || isSheetOnly(courseName);

const sessionOver = (row) => !row.endAt || new Date(row.endAt).getTime() <= Date.now();

// filterUtils.ts computeMtcFinal
const computeFinal = (student, row) => {
  if (isSheetOnly(row.courseName) || new Date(row.date).getTime() >= MTC_SHEET_ONLY_FROM) {
    if (student.physicalSheetStatus === "PRESENT") return "PRESENT";
    return sessionOver(row) ? "ABSENT" : "PENDING";
  }
  const digital = student.checkInStatus === "CHECKED_IN_PENDING" || student.checkInStatus === "CHECKED_IN_VERIFIED";
  if (student.attendanceStatus === "PRESENT" || student.physicalSheetStatus === "PRESENT" || digital) return "PRESENT";
  return sessionOver(row) ? "ABSENT" : "PENDING";
};

// Best session of a module: result, then has a score, then evidence, then latest.
const sessionRank = ({ student, row }) => [
  FINAL_RANK[computeFinal(student, row)],
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

const digitalLabel = (c) => (!c ? NOT_SET : c === "CHECKED_IN_PENDING" || c === "CHECKED_IN_VERIFIED" ? "Present" : "Absent");

/**
 * @param {string} courseName exact course name, must be a sheet-final course
 * @param {{ excludeRolls?: string[], workshops?: object[] }} options
 *   excludeRolls: rolls (any case) left out, e.g. test accounts;
 *   workshops: the analytics table, passed in to build several courses from one fetch
 * @returns {Promise<{ header: string[], rows: string[][] }>}
 */
export const buildCourseAttendanceTable = async (courseName, { excludeRolls = [], workshops } = {}) => {
  if (!isSheetFinalCourse(courseName)) throw new Error(`Not a sheet-final course: ${courseName}`);
  const excluded = new Set(excludeRolls.map((r) => r.trim().toUpperCase()).filter(Boolean));
  const all = workshops ?? (await getWorkshopAnalyticsTable());
  const courseRows = all.filter((r) => r.courseName === courseName);
  const moduleNames = [...new Set(courseRows.map((r) => r.moduleName).filter((m) => m && m !== NOT_SET))].sort();

  const students = new Map();
  for (const row of courseRows) {
    for (const student of row.students) {
      const roll = student.rollNo && student.rollNo !== NOT_SET ? student.rollNo.toUpperCase() : "";
      const key = student.userId || (roll ? `pending:${roll}` : `pending:${student.email}`);
      if (!students.has(key)) {
        students.set(key, {
          name: student.name,
          email: student.email,
          rollNo: student.rollNo,
          department: student.department || NOT_SET,
          programme: student.programme || NOT_SET,
          batches: [],
          events: 0,
          present: 0,
          marked: 0,
          sessionsByModule: new Map()
        });
      }
      const agg = students.get(key);
      agg.events++;
      if (student.batch && student.batch !== NOT_SET && !agg.batches.includes(student.batch)) {
        agg.batches.push(student.batch);
      }
      const moduleKey = row.moduleName && row.moduleName !== NOT_SET ? row.moduleName : `event:${row.id}`;
      if (!agg.sessionsByModule.has(moduleKey)) agg.sessionsByModule.set(moduleKey, []);
      agg.sessionsByModule.get(moduleKey).push({ student, row });
    }
  }

  const header = ["Name", "Email", "Roll No", "Department", "Programme", "Batch", "Events", "Attendance % (module-wise)"];
  for (const m of moduleNames) {
    for (const col of ["Batch", "Digital Attendance", "Check-in", "Physical Attendance", "Final Attendance"]) {
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
    const perModule = {};
    for (const [moduleKey, sessions] of agg.sessionsByModule) {
      const chosen = pickModuleSession(sessions);
      const final = computeFinal(chosen.student, chosen.row);
      if (final === "PRESENT") agg.present++;
      if (moduleKey.startsWith("event:")) {
        agg.marked++;
        continue;
      }
      perModule[moduleKey] = {
        final,
        checkIn: chosen.student.checkInStatus,
        sheet: chosen.student.physicalSheetStatus,
        batches: [...sessions]
          .sort((a, b) => new Date(a.row.date) - new Date(b.row.date))
          .map((x) => x.row.batch || x.student.batch)
          .filter((b) => b && b !== NOT_SET)
      };
    }

    const line = [
      agg.name,
      agg.email,
      agg.rollNo,
      agg.department,
      agg.programme,
      agg.batches.join(", ") || NOT_SET,
      agg.events,
      agg.marked > 0 ? `${Math.round((agg.present / agg.marked) * 100)}%` : NOT_SET
    ];
    for (const m of moduleNames) {
      const p = perModule[m];
      if (!p) {
        line.push(NOT_SET, NOT_SET, NOT_SET, NOT_SET, NOT_SET);
        continue;
      }
      line.push(
        p.batches.length ? p.batches.join(" → ") : NOT_SET,
        digitalLabel(p.checkIn),
        p.checkIn ? CHECK_IN_LABEL[p.checkIn] : NOT_SET,
        p.sheet === "PRESENT" ? "Present" : "Absent",
        FINAL_LABEL[p.final]
      );
    }
    rows.push(line.map((v) => (v == null ? "" : String(v))));
  }

  return { header, rows };
};
