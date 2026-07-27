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

// In-built quiz — now a reusable Quiz-library entity (see quizLibrary.service.js
// for create/edit/delete of the quiz itself). A CourseModule just holds a
// reference (quizId) to one; every per-batch Event instantiated from this
// module (bulk import creates one Event PER BATCH sharing this
// courseModuleId) resolves to the same questions via that shared reference.
export const getModuleQuiz = async (moduleId) => {
  const module = await prisma.courseModule.findUnique({
    where: { id: moduleId },
    include: { quiz: { include: { questions: { orderBy: { order: "asc" } } } } }
  });
  if (!module) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Module not found");
  }

  return module.quiz || { quizId: null, questions: [] };
};

// Links (or unlinks, when quizId is null) this module to a quiz from the
// Forms library. No question editing happens here anymore — that's
// quizLibrary.service.js's job, and edits there apply everywhere the quiz is
// linked.
export const linkModuleQuiz = async (moduleId, quizId) => {
  const module = await prisma.courseModule.findUnique({ where: { id: moduleId } });
  if (!module) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Module not found");
  }
  if (quizId) {
    const quiz = await prisma.quiz.findUnique({ where: { id: quizId } });
    if (!quiz) {
      throw new ApiError(StatusCodes.NOT_FOUND, "Quiz not found");
    }
  }

  await prisma.courseModule.update({ where: { id: moduleId }, data: { quizId: quizId || null } });
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
