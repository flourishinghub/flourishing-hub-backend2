import { prisma } from "../database/prisma.js";
import { isPhysicalSheetSource, pickSession, wellnessFinal } from "./admin.service.js";
import { SCORE_MODULE_TITLE } from "./quizScoreImport.service.js";

// The logged-in student's own Wellness result, module by module: the same
// grade as the admin Student view, the live grades sheet and the NP emails
// (getWorkshopAnalyticsTable + buildStudentModuleSummary), computed from this
// student's rows only so the dashboard doesn't rebuild the whole table.
//   PP      = sheet signature + app check-in + quiz >= 4 in one session
//   NP      = attended a session but one of the three is missing
//   PENDING = attended (sheet + check-in), this session's quiz scores not uploaded yet
//   NOT_ATTENDED = no session of the module with a signature or a check-in
// Keep in sync with getWorkshopAnalyticsTable's per-student fields.

const WELLNESS_COURSE = "Wellness Workshop";
const PASS_SCORE = 4;

const isPastForAnalytics = (e, now) => e.status === "COMPLETED" || (e.status === "PUBLISHED" && e.endAt < now);
const EVENT_SELECT = {
  id: true, title: true, startAt: true, endAt: true, batch: true, status: true, venue: true,
  courseModule: { select: { title: true } },
  modules: { select: { id: true, title: true, sourceQuizId: true } },
};

export const getStudentWellnessResult = async (userId) => {
  // Every round trip to the pooled DB costs ~2 s, so independent reads go in parallel.
  const [course, user] = await Promise.all([
    prisma.course.findFirst({ where: { name: WELLNESS_COURSE }, select: { id: true } }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, studentProfile: { select: { id: true, rollNumber: true } } },
    }),
  ]);
  if (!course || !user) return null;
  const roll = user.studentProfile?.rollNumber || null;
  const eventWhere = { courseId: course.id, status: { in: ["PUBLISHED", "COMPLETED"] } };

  const [courseModules, regs, pendingRows] = await Promise.all([
    prisma.courseModule.findMany({ where: { courseId: course.id }, select: { title: true } }),
    prisma.eventRegistration.findMany({
      where: { userId, status: { not: "CANCELLED" }, event: eventWhere },
      select: { event: { select: EVENT_SELECT } },
    }),
    // Sheet signatures recorded before this account was matched (no-account rows).
    prisma.pendingAttendance.findMany({
      where: {
        isMatched: false, status: "PRESENT", event: eventWhere,
        OR: [
          { email: { equals: user.email, mode: "insensitive" } },
          ...(roll ? [{ rollNumber: { equals: roll, mode: "insensitive" } }] : []),
        ],
      },
      select: { email: true, rollNumber: true, quizScore: true, event: { select: EVENT_SELECT } },
    }),
  ]);

  // A roll match whose row carries another active account's email belongs to
  // that account (getWorkshopAnalyticsTable's accountFor looks up email first).
  const otherEmails = [...new Set(pendingRows
    .map((p) => p.email?.toLowerCase())
    .filter((e) => e && e !== user.email.toLowerCase()))];
  const otherAccounts = otherEmails.length
    ? new Set((await prisma.user.findMany({
        where: { isActive: true, email: { in: otherEmails, mode: "insensitive" } },
        select: { email: true },
      })).map((u) => u.email.toLowerCase()))
    : new Set();
  const myPending = pendingRows.filter((p) => !p.email || !otherAccounts.has(p.email.toLowerCase()));

  const events = new Map();
  for (const r of regs) events.set(r.event.id, { event: r.event, registered: true, pending: null });
  for (const p of myPending) {
    const e = events.get(p.event.id) || { event: p.event, registered: false, pending: null };
    e.pending = p;
    events.set(p.event.id, e);
  }
  if (events.size === 0) return null;

  const eventIds = [...events.keys()];
  const [attendances, checkIns, progress] = await Promise.all([
    prisma.attendanceRecord.findMany({ where: { userId, eventId: { in: eventIds } }, select: { eventId: true, status: true, source: true } }),
    prisma.eventCheckIn.findMany({ where: { userId, eventId: { in: eventIds } }, select: { eventId: true, status: true }, orderBy: { checkedInAt: "desc" } }),
    user.studentProfile
      ? prisma.moduleProgress.findMany({
          where: { studentProfileId: user.studentProfile.id, marksObtained: { not: null }, module: { eventId: { in: eventIds } } },
          select: { marksObtained: true, module: { select: { eventId: true, title: true, sourceQuizId: true } } },
        })
      : [],
  ]);

  const now = new Date();
  const sessionsByModule = new Map();
  const upcomingByModule = new Map();
  for (const { event, registered, pending } of events.values()) {
    const moduleName = event.courseModule?.title;
    if (!moduleName) continue;
    if (!isPastForAnalytics(event, now)) {
      if (registered) {
        if (!upcomingByModule.has(moduleName)) upcomingByModule.set(moduleName, []);
        upcomingByModule.get(moduleName).push({ eventId: event.id, batch: event.batch, startAt: event.startAt, venue: event.venue });
      }
      continue;
    }
    const row = {
      id: event.id,
      courseName: WELLNESS_COURSE,
      moduleName,
      date: event.startAt,
      endAt: event.endAt,
      batch: event.batch || "—",
      courseHasQuiz: true,
      quizScoresAvailable: event.modules.some((m) => m.sourceQuizId != null || m.title === SCORE_MODULE_TITLE),
    };
    let s;
    if (registered) {
      let attendanceStatus = "NOT_MARKED";
      let physicalSheetStatus = null;
      for (const a of attendances.filter((x) => x.eventId === event.id)) {
        attendanceStatus = a.status;
        if (isPhysicalSheetSource(a.source)) physicalSheetStatus = a.status;
      }
      const ci = checkIns.find((c) => c.eventId === event.id)?.status;
      // Uploaded topic score, then the in-built quiz (wins when both exist).
      let quizScore = null;
      const scores = progress.filter((p) => p.module.eventId === event.id);
      const uploaded = scores.find((p) => p.module.title === SCORE_MODULE_TITLE && p.module.sourceQuizId == null);
      const builtIn = scores.find((p) => p.module.sourceQuizId != null);
      if (uploaded) quizScore = uploaded.marksObtained;
      if (builtIn) quizScore = builtIn.marksObtained;
      if (pending) {
        attendanceStatus = "PRESENT";
        physicalSheetStatus = "PRESENT";
      }
      s = {
        attendanceStatus,
        physicalSheetStatus,
        hasCheckedIn: ci === "PENDING" || ci === "VERIFIED",
        checkInStatus: ci === "PENDING" ? "CHECKED_IN_PENDING" : ci === "VERIFIED" ? "CHECKED_IN_VERIFIED" : ci === "REJECTED" ? "CHECKED_IN_REJECTED" : "NOT_CHECKED_IN",
        quizScore,
        score: quizScore,
      };
    } else {
      // Signed the sheet without an account registration for this session.
      s = {
        attendanceStatus: "PRESENT",
        physicalSheetStatus: "PRESENT",
        hasCheckedIn: true,
        checkInStatus: "NOT_CHECKED_IN",
        quizScore: pending.quizScore ?? null,
        score: pending.quizScore ?? null,
      };
    }
    if (!sessionsByModule.has(moduleName)) sessionsByModule.set(moduleName, []);
    sessionsByModule.get(moduleName).push({ s, row });
  }

  const modules = courseModules.map((m) => m.title).sort().map((title) => {
    const sessions = sessionsByModule.get(title) || [];
    const upcoming = (upcomingByModule.get(title) || []).sort((a, b) => a.startAt - b.startAt);
    const base = { title, upcoming, sessions: sessions.length };
    if (!sessions.length) return { ...base, result: "NOT_ATTENDED", reasons: [] };
    const { s, row } = pickSession(sessions);
    const physical = s.physicalSheetStatus === "PRESENT";
    const digital = s.checkInStatus === "CHECKED_IN_PENDING" || s.checkInStatus === "CHECKED_IN_VERIFIED";
    const final = wellnessFinal(s, row);
    const result = final === "PRESENT" ? "PP" : final === "PENDING" ? "PENDING" : !physical && !digital ? "NOT_ATTENDED" : "NP";
    const reasons = [];
    if (result === "NP") {
      if (!physical) reasons.push("NO_SHEET_SIGN");
      if (!digital) reasons.push("NO_CHECK_IN");
      if (s.quizScore == null) reasons.push("NO_QUIZ");
      else if (s.quizScore < PASS_SCORE) reasons.push("QUIZ_LOW");
    }
    return {
      ...base,
      result,
      reasons,
      physical,
      digital,
      quizScore: s.quizScore ?? null,
      session: { batch: row.batch, date: row.date },
    };
  });

  const passed = modules.filter((m) => m.result === "PP").length;
  return {
    courseName: WELLNESS_COURSE,
    passScore: PASS_SCORE,
    totalModules: modules.length,
    passedModules: passed,
    courseResult: passed === modules.length ? "PP" : modules.some((m) => m.result === "PENDING") ? "PENDING" : "NP",
    modules,
  };
};
