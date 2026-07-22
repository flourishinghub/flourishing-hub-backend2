import { prisma } from "../database/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { StatusCodes } from "http-status-codes";

export const createModule = async (courseId, data) => {
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Course not found");
  }

  return prisma.courseModule.create({
    data: {
      courseId,
      title: data.title,
      description: data.description,
      posterUrl: data.posterUrl,
      quizLink: data.quizLink,
      feedbackLink: data.feedbackLink,
      duration: data.duration,
      order: data.order ?? 0,
      isActive: data.isActive ?? true,
    },
  });
};

export const getModulesByCourse = async (courseId) => {
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Course not found");
  }

  return prisma.courseModule.findMany({
    where: { courseId },
    include: {
      _count: { select: { events: true } },
    },
    orderBy: { order: "asc" },
  });
};

export const getModuleById = async (id) => {
  const module = await prisma.courseModule.findUnique({
    where: { id },
    include: {
      course: { select: { id: true, name: true } },
      _count: { select: { events: true } },
    },
  });
  if (!module) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Module not found");
  }
  return module;
};

export const updateModule = async (id, data) => {
  const existing = await prisma.courseModule.findUnique({ where: { id } });
  if (!existing) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Module not found");
  }

  const updateData = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.posterUrl !== undefined) updateData.posterUrl = data.posterUrl;
  if (data.quizLink !== undefined) updateData.quizLink = data.quizLink;
  if (data.feedbackLink !== undefined) updateData.feedbackLink = data.feedbackLink;
  if (data.duration !== undefined) updateData.duration = data.duration;
  if (data.order !== undefined) updateData.order = data.order;
  if (data.isActive !== undefined) updateData.isActive = data.isActive;

  return prisma.courseModule.update({ where: { id }, data: updateData });
};

export const deleteModule = async (id) => {
  const existing = await prisma.courseModule.findUnique({ where: { id } });
  if (!existing) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Module not found");
  }
  await prisma.$transaction([
    prisma.event.deleteMany({ where: { courseModuleId: id } }),
    prisma.courseModule.delete({ where: { id } }),
  ]);
  return { message: "Module deleted successfully" };
};

const QUIZ_QUESTION_COUNT = 10;

// Fixed-10-question in-built quiz, authored once on the CourseModule so
// every per-batch Event instantiated from it (bulk import creates one Event
// PER BATCH sharing this courseModuleId) resolves to the same questions
// instead of the admin re-entering them per event.
export const getModuleQuiz = async (moduleId) => {
  const module = await prisma.courseModule.findUnique({ where: { id: moduleId } });
  if (!module) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Module not found");
  }

  const quiz = await prisma.quiz.findUnique({
    where: { courseModuleId: moduleId },
    include: { questions: { orderBy: { order: "asc" } } }
  });

  return quiz || { courseModuleId: moduleId, questions: [] };
};

export const upsertModuleQuiz = async (moduleId, questions) => {
  const module = await prisma.courseModule.findUnique({ where: { id: moduleId } });
  if (!module) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Module not found");
  }
  if (!Array.isArray(questions) || questions.length !== QUIZ_QUESTION_COUNT) {
    throw new ApiError(StatusCodes.BAD_REQUEST, `Quiz must have exactly ${QUIZ_QUESTION_COUNT} questions`);
  }

  const quiz = await prisma.quiz.upsert({
    where: { courseModuleId: moduleId },
    update: {},
    create: { courseModuleId: moduleId }
  });

  // Full-replace semantics: simplest correct behavior for a fixed-10-slot
  // editor where the admin edits the whole set at once. Wrapped in a
  // transaction so a mid-replace failure can't leave a partial quiz live.
  await prisma.$transaction([
    prisma.quizQuestion.deleteMany({ where: { quizId: quiz.id } }),
    prisma.quizQuestion.createMany({
      data: questions.map((q, index) => ({
        quizId: quiz.id,
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

  return getModuleQuiz(moduleId);
};

export const getModuleUsageStats = async (id) => {
  const module = await prisma.courseModule.findUnique({
    where: { id },
    include: {
      _count: { select: { events: true } },
      events: {
        select: {
          id: true,
          title: true,
          startAt: true,
          status: true,
          batch: true,
          _count: { select: { registrations: true } },
        },
        orderBy: { startAt: "desc" },
      },
    },
  });
  if (!module) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Module not found");
  }
  return {
    module: {
      id: module.id,
      title: module.title,
      courseId: module.courseId,
    },
    usageCount: module._count.events,
    workshops: module.events,
  };
};
