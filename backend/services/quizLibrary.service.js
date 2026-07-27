import { prisma } from "../database/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { StatusCodes } from "http-status-codes";

const QUIZ_QUESTION_COUNT = 10;

export const listQuizzes = async (search) => {
  return prisma.quiz.findMany({
    where: search ? { title: { contains: search, mode: "insensitive" } } : undefined,
    include: { _count: { select: { questions: true, courseModules: true, events: true } } },
    orderBy: { updatedAt: "desc" }
  });
};

export const getQuizById = async (id) => {
  const quiz = await prisma.quiz.findUnique({
    where: { id },
    include: { questions: { orderBy: { order: "asc" } } }
  });
  if (!quiz) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Quiz not found");
  }
  return quiz;
};

export const createQuiz = async (title, questions) => {
  if (questions && (!Array.isArray(questions) || questions.length !== QUIZ_QUESTION_COUNT)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, `Quiz must have exactly ${QUIZ_QUESTION_COUNT} questions`);
  }

  return prisma.quiz.create({
    data: {
      title,
      questions: questions
        ? { createMany: { data: questions.map((q, index) => ({ ...q, order: index })) } }
        : undefined
    },
    include: { questions: { orderBy: { order: "asc" } } }
  });
};

// Full-replace semantics for the question set: simplest correct behavior for
// a fixed-10-slot editor where the admin edits the whole set at once. Title +
// questions update together in one transaction so a mid-replace failure
// can't leave a partial quiz live.
export const updateQuizQuestions = async (id, title, questions) => {
  const existing = await prisma.quiz.findUnique({ where: { id } });
  if (!existing) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Quiz not found");
  }
  if (!Array.isArray(questions) || questions.length !== QUIZ_QUESTION_COUNT) {
    throw new ApiError(StatusCodes.BAD_REQUEST, `Quiz must have exactly ${QUIZ_QUESTION_COUNT} questions`);
  }

  await prisma.$transaction([
    prisma.quiz.update({ where: { id }, data: { title } }),
    prisma.quizQuestion.deleteMany({ where: { quizId: id } }),
    prisma.quizQuestion.createMany({
      data: questions.map((q, index) => ({
        quizId: id,
        order: index,
        questionText: q.questionText,
        optionA: q.optionA,
        optionB: q.optionB,
        optionC: q.optionC,
        optionD: q.optionD,
        correctOption: q.correctOption
      }))
    })
  ]);

  return getQuizById(id);
};

export const getQuizUsage = async (id) => {
  const [courseModules, events] = await Promise.all([
    prisma.courseModule.findMany({
      where: { quizId: id },
      select: { id: true, title: true, course: { select: { name: true } } }
    }),
    prisma.event.findMany({
      where: { quizId: id },
      select: { id: true, title: true, startAt: true, batch: true }
    })
  ]);
  return { courseModules, events, total: courseModules.length + events.length };
};

// Delete is BLOCKED while the quiz is linked anywhere — an admin must unlink
// every module/event first. This is the real safeguard; the FK's
// onDelete: SetNull in schema.prisma is only a DB-level backstop.
export const deleteQuiz = async (id) => {
  const existing = await prisma.quiz.findUnique({ where: { id } });
  if (!existing) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Quiz not found");
  }

  const usage = await getQuizUsage(id);
  if (usage.total > 0) {
    const names = [
      ...usage.courseModules.map((m) => `Module "${m.title}" (${m.course?.name || "—"})`),
      ...usage.events.map((e) => `Event "${e.title}"`)
    ];
    throw new ApiError(
      StatusCodes.CONFLICT,
      `Cannot delete — this quiz is still linked to: ${names.join(", ")}. Unlink it from each first.`
    );
  }

  await prisma.quiz.delete({ where: { id } });
  return { message: "Quiz deleted successfully" };
};
