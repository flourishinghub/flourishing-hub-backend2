// Student-wise export of in-built Quiz score, in-built Feedback-form answers,
// and session Rating — filterable by course/topic(module)/instructor/batch.
//
// Deliberately a brand-new, standalone file rather than an addition to
// admin.service.js: it only READS existing data through fresh Prisma
// queries of its own — it does not import, call, or modify any existing
// service function, so nothing already live is touched by adding this.
//
// Known limitation (by existing design, not something this file changes):
// individual quiz answers (which option a student picked per question) are
// never persisted anywhere — only the aggregate score lands in
// ModuleProgress.marksObtained. So "Quiz" here is score/pass-fail only.
// In-built Feedback, by contrast, does store a full per-question answer
// (FeedbackAnswer), so that part of the export is complete detail.
import { prisma } from "../database/prisma.js";
import { createWorkbookBuffer } from "../utils/excel.js";

const QUIZ_PASS_THRESHOLD = 4; // out of 10 — same threshold used by admin analytics' Pass/Fail (filterUtils.ts computeModuleStatus)

const formatFeedbackAnswers = (answers, questionById) => {
  if (!answers?.length) return "";
  return answers
    .map((a) => {
      const q = questionById.get(a.feedbackQuestionId);
      const label = q?.questionText || a.feedbackQuestionId;
      const value = a.answerRating != null ? `${a.answerRating}/5` : (a.answerText ?? "");
      return `${label}: ${value}`;
    })
    .join(" | ");
};

export const getStudentResponseExportRows = async (filters = {}) => {
  const { courseName, topicName, instructorName, batch } = filters;

  const events = await prisma.event.findMany({
    where: {
      OR: [
        { status: "COMPLETED" },
        { status: "PUBLISHED", endAt: { lt: new Date() } },
        { status: "PUBLISHED", endAt: { gte: new Date() } } // also include still-live/upcoming sessions so responses show up as they come in, not only after the session ends
      ],
      ...(courseName ? { course: { name: courseName } } : {}),
      ...(batch ? { batch } : {})
    },
    include: {
      course: { select: { id: true, name: true } },
      courseModule: {
        select: {
          id: true, title: true, quizId: true, feedbackFormId: true,
          feedbackForm: { select: { id: true, title: true, questions: true } }
        }
      },
      assignments: { include: { user: { select: { id: true, name: true } } } },
      registrations: {
        where: { status: { not: "CANCELLED" }, user: { isActive: true } },
        select: {
          userId: true,
          user: {
            select: {
              id: true, name: true, email: true,
              studentProfile: { select: { id: true, rollNumber: true, cohort: true, department: true, programme: true } }
            }
          }
        }
      },
      modules: { select: { id: true, sourceQuizId: true, progressEntries: { select: { studentProfileId: true, marksObtained: true, completedAt: true } } } },
      feedbackEntries: { select: { userId: true, eventRating: true, instructorRating: true, eventComment: true, instructorComment: true } },
      feedbackResponses: { select: { userId: true, submittedAt: true, answers: true } }
    },
    orderBy: { startAt: "desc" }
  });

  const rows = [];

  for (const event of events) {
    const topicTitle = event.courseModule?.title || event.title;
    if (topicName && topicTitle !== topicName) continue;

    const instructorAssignment = event.assignments.find((a) => a.role === "INSTRUCTOR");
    const associateAssignment = event.assignments.find((a) => a.role === "ASSOCIATE_INSTRUCTOR");
    const instructorNameResolved = instructorAssignment?.user?.name || "";
    if (instructorName && instructorNameResolved !== instructorName) continue;

    const quizModule = event.modules.find((m) => m.sourceQuizId != null);
    const quizProgressByProfileId = new Map();
    if (quizModule) {
      for (const p of quizModule.progressEntries) {
        quizProgressByProfileId.set(p.studentProfileId, p);
      }
    }

    const feedbackQuestionById = new Map(
      (event.courseModule?.feedbackForm?.questions || []).map((q) => [q.id, q])
    );
    const feedbackResponseByUserId = new Map(event.feedbackResponses.map((r) => [r.userId, r]));
    const ratingByUserId = new Map(event.feedbackEntries.map((f) => [f.userId, f]));

    for (const reg of event.registrations) {
      const sp = reg.user.studentProfile;
      const quizProgress = sp ? quizProgressByProfileId.get(sp.id) : null;
      const hasQuizScore = quizProgress?.marksObtained != null;

      const fbResponse = feedbackResponseByUserId.get(reg.userId);
      const rating = ratingByUserId.get(reg.userId);

      rows.push({
        "Student Name": reg.user.name || "",
        "Roll No": sp?.rollNumber || "",
        Email: reg.user.email || "",
        Department: sp?.department || "",
        Programme: sp?.programme || "",
        Batch: event.batch || sp?.cohort || "",
        "Course Name": event.course?.name || "",
        "Topic / Module": topicTitle,
        Instructor: instructorNameResolved,
        "Associate Instructor": associateAssignment?.user?.name || "",
        "Quiz Score (/10)": hasQuizScore ? quizProgress.marksObtained : "",
        "Quiz Result": hasQuizScore ? (quizProgress.marksObtained >= QUIZ_PASS_THRESHOLD ? "Pass" : "Fail") : "",
        "Quiz Completed At": quizProgress?.completedAt ? quizProgress.completedAt.toISOString() : "",
        "Feedback Submitted": fbResponse ? "Yes" : "No",
        "Feedback Answers": fbResponse ? formatFeedbackAnswers(fbResponse.answers, feedbackQuestionById) : "",
        "Feedback Submitted At": fbResponse?.submittedAt ? fbResponse.submittedAt.toISOString() : "",
        "Session Rating (1-5)": rating?.eventRating ?? "",
        "Instructor Rating (1-5)": rating?.instructorRating ?? "",
        "Rating Comment": rating?.eventComment || ""
      });
    }
  }

  return rows;
};

export const generateStudentResponseExportBuffer = async (filters = {}) => {
  const rows = await getStudentResponseExportRows(filters);
  return createWorkbookBuffer([{ name: "Student Responses", rows }]);
};
