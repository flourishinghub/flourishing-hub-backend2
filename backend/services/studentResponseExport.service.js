// Student-wise export of in-built Quiz answers, in-built Feedback-form
// answers, and session Rating — filterable by course/topic(module)/
// instructor/batch.
//
// Deliberately a brand-new, standalone file rather than an addition to
// admin.service.js: it only READS existing data through fresh Prisma
// queries of its own — it does not import, call, or modify any existing
// service function, so nothing already live is touched by adding this.
//
// Quiz and Feedback questions each get their own column (dynamic — built
// from whichever questions actually appear across the matching rows), so
// the sheet reads like a Google Forms response export instead of one
// concatenated "answers" blob.
//
// Known limitation: QuizAnswer only exists for quizzes submitted after that
// table was added — a submission from before then has no per-question
// answers to show (the questionId->correctOption map moved through memory
// and was discarded, only the aggregate score was ever persisted). Those
// rows show blank quiz-question columns; "Quiz Score" and "Quiz Result"
// still work for every submission since those come from ModuleProgress.
import { prisma } from "../database/prisma.js";
import { createWorkbookBuffer } from "../utils/excel.js";

const QUIZ_PASS_THRESHOLD = 4; // out of 10 — same threshold used by admin analytics' Pass/Fail (filterUtils.ts computeModuleStatus)

const OPTION_FIELD = { A: "optionA", B: "optionB", C: "optionC", D: "optionD" };

const formatMcqAnswer = (question, letter) => {
  if (!letter) return "";
  const optionText = question?.[OPTION_FIELD[letter]];
  return optionText ? `${letter}. ${optionText}` : letter;
};

const formatFeedbackAnswer = (question, answer) => {
  if (!answer) return "";
  if (question.type === "RATING") return answer.answerRating != null ? `${answer.answerRating}/5` : "";
  if (question.type === "MCQ") return formatMcqAnswer(question, answer.answerText);
  return answer.answerText ?? "";
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
          id: true, title: true,
          quiz: { select: { id: true, questions: { orderBy: { order: "asc" } } } },
          feedbackForm: { select: { id: true, questions: { orderBy: { order: "asc" } } } }
        }
      },
      quiz: { select: { id: true, questions: { orderBy: { order: "asc" } } } },
      feedbackForm: { select: { id: true, questions: { orderBy: { order: "asc" } } } },
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
      modules: {
        select: {
          id: true, sourceQuizId: true,
          progressEntries: {
            select: {
              studentProfileId: true, marksObtained: true, completedAt: true,
              quizAnswers: { select: { quizQuestionId: true, selectedOption: true } }
            }
          }
        }
      },
      feedbackEntries: { select: { userId: true, eventRating: true, instructorRating: true, eventComment: true, instructorComment: true } },
      feedbackResponses: { select: { userId: true, submittedAt: true, answers: true } }
    },
    orderBy: { startAt: "desc" }
  });

  // Pass 1: build one intermediate record per (event, registration), keeping
  // the raw per-question data alongside the base fields — column sets for
  // quiz/feedback questions aren't known until every matching event has been
  // walked (different topics can use different quizzes/forms).
  const intermediateRows = [];
  const quizQuestionLabels = new Map(); // questionId -> "Quiz Q1: ..." label, insertion order = column order
  const feedbackQuestionLabels = new Map(); // questionId -> "Feedback Q1: ..." label

  for (const event of events) {
    const topicTitle = event.courseModule?.title || event.title;
    if (topicName && topicTitle !== topicName) continue;

    const instructorAssignment = event.assignments.find((a) => a.role === "INSTRUCTOR");
    const associateAssignment = event.assignments.find((a) => a.role === "ASSOCIATE_INSTRUCTOR");
    const instructorNameResolved = instructorAssignment?.user?.name || "";
    if (instructorName && instructorNameResolved !== instructorName) continue;

    // Same inherit-from-module-else-own-field resolution as
    // operation.service.js's resolveEventQuiz / resolveEventFeedbackForm.
    const resolvedQuiz = event.courseModuleId ? event.courseModule?.quiz : event.quiz;
    const resolvedFeedbackForm = event.courseModuleId ? event.courseModule?.feedbackForm : event.feedbackForm;

    const quizQuestionById = new Map((resolvedQuiz?.questions || []).map((q) => [q.id, q]));
    quizQuestionById.forEach((q, id) => {
      if (!quizQuestionLabels.has(id)) {
        quizQuestionLabels.set(id, { base: `Quiz Q${q.order}: ${q.questionText}`, topicTitle });
      }
    });

    const feedbackQuestionById = new Map((resolvedFeedbackForm?.questions || []).map((q) => [q.id, q]));
    feedbackQuestionById.forEach((q, id) => {
      if (!feedbackQuestionLabels.has(id)) {
        feedbackQuestionLabels.set(id, { base: `Feedback Q${q.order}: ${q.questionText}`, topicTitle });
      }
    });

    const quizModule = event.modules.find((m) => m.sourceQuizId != null);
    const quizProgressByProfileId = new Map();
    if (quizModule) {
      for (const p of quizModule.progressEntries) {
        quizProgressByProfileId.set(p.studentProfileId, p);
      }
    }

    const feedbackResponseByUserId = new Map(event.feedbackResponses.map((r) => [r.userId, r]));
    const ratingByUserId = new Map(event.feedbackEntries.map((f) => [f.userId, f]));

    for (const reg of event.registrations) {
      const sp = reg.user.studentProfile;
      const quizProgress = sp ? quizProgressByProfileId.get(sp.id) : null;
      const hasQuizScore = quizProgress?.marksObtained != null;
      const quizAnswerByQuestionId = new Map((quizProgress?.quizAnswers || []).map((a) => [a.quizQuestionId, a.selectedOption]));

      const fbResponse = feedbackResponseByUserId.get(reg.userId);
      const feedbackAnswerByQuestionId = new Map((fbResponse?.answers || []).map((a) => [a.feedbackQuestionId, a]));
      const rating = ratingByUserId.get(reg.userId);

      intermediateRows.push({
        base: {
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
          "Feedback Submitted At": fbResponse?.submittedAt ? fbResponse.submittedAt.toISOString() : "",
          "Session Rating (1-5)": rating?.eventRating ?? "",
          "Instructor Rating (1-5)": rating?.instructorRating ?? "",
          "Rating Comment": rating?.eventComment || ""
        },
        quizQuestionById,
        quizAnswerByQuestionId,
        feedbackQuestionById,
        feedbackAnswerByQuestionId
      });
    }
  }

  // Different modules commonly reuse the exact same question wording (e.g.
  // every module's feedback form asking "Share your feedback about this
  // session") — those are still DIFFERENT questionIds needing separate
  // columns, or one row's answer would silently overwrite another's in the
  // flat object below (two different keys can't collide, but two identical
  // label STRINGS used as keys can). Suffix the topic title onto every label
  // that collides with another; labels with no collision stay exactly as
  // Quiz/Feedback Q<n>: <text>.
  const resolveLabelCollisions = (labelMap) => {
    const countByBase = new Map();
    for (const { base } of labelMap.values()) {
      countByBase.set(base, (countByBase.get(base) || 0) + 1);
    }
    return [...labelMap.entries()].map(([questionId, { base, topicTitle }]) => [
      questionId,
      countByBase.get(base) > 1 ? `${base} (${topicTitle})` : base
    ]);
  };

  // Pass 2: now that every question column is known, flatten each row —
  // blank for a question this row's event didn't actually use.
  const quizColumns = resolveLabelCollisions(quizQuestionLabels);
  const feedbackColumns = resolveLabelCollisions(feedbackQuestionLabels);

  return intermediateRows.map((row) => {
    const flat = { ...row.base };
    for (const [questionId, label] of quizColumns) {
      const question = row.quizQuestionById.get(questionId);
      const selected = row.quizAnswerByQuestionId.get(questionId);
      flat[label] = question && selected ? formatMcqAnswer(question, selected) : "";
    }
    for (const [questionId, label] of feedbackColumns) {
      const question = row.feedbackQuestionById.get(questionId);
      const answer = row.feedbackAnswerByQuestionId.get(questionId);
      flat[label] = question ? formatFeedbackAnswer(question, answer) : "";
    }
    return flat;
  });
};

export const generateStudentResponseExportBuffer = async (filters = {}) => {
  const rows = await getStudentResponseExportRows(filters);
  return createWorkbookBuffer([{ name: "Student Responses", rows }]);
};
