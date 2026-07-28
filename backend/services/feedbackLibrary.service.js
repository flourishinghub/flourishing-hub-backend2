import { prisma } from "../database/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { StatusCodes } from "http-status-codes";

const validateQuestions = (questions) => {
  if (!Array.isArray(questions) || questions.length < 1) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Feedback form must have at least 1 question");
  }
  const invalidMcq = questions.find(
    (q) => q.type === "MCQ" && !(q.optionA && q.optionB && q.optionC && q.optionD)
  );
  if (invalidMcq) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Every MCQ question must have all 4 options filled");
  }
};

export const listForms = async (search) => {
  return prisma.feedbackForm.findMany({
    where: search ? { title: { contains: search, mode: "insensitive" } } : undefined,
    include: { _count: { select: { questions: true, courseModules: true, events: true } } },
    orderBy: { updatedAt: "desc" }
  });
};

export const getFormById = async (id) => {
  const form = await prisma.feedbackForm.findUnique({
    where: { id },
    include: { questions: { orderBy: { order: "asc" } } }
  });
  if (!form) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Feedback form not found");
  }
  return form;
};

export const createForm = async (title, questions) => {
  if (questions) {
    validateQuestions(questions);
  }

  return prisma.feedbackForm.create({
    data: {
      title,
      questions: questions
        ? { createMany: { data: questions.map((q, index) => ({ ...q, order: index })) } }
        : undefined
    },
    include: { questions: { orderBy: { order: "asc" } } }
  });
};

// Full-replace semantics for the question set, same as Quiz's
// updateQuizQuestions — title + questions update together in one transaction
// so a mid-replace failure can't leave a partial form live.
export const updateFormQuestions = async (id, title, questions) => {
  const existing = await prisma.feedbackForm.findUnique({ where: { id } });
  if (!existing) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Feedback form not found");
  }
  validateQuestions(questions);

  await prisma.$transaction([
    prisma.feedbackForm.update({ where: { id }, data: { title } }),
    prisma.feedbackQuestion.deleteMany({ where: { feedbackFormId: id } }),
    prisma.feedbackQuestion.createMany({
      data: questions.map((q, index) => ({
        feedbackFormId: id,
        order: index,
        questionText: q.questionText,
        type: q.type,
        optionA: q.type === "MCQ" ? q.optionA : null,
        optionB: q.type === "MCQ" ? q.optionB : null,
        optionC: q.type === "MCQ" ? q.optionC : null,
        optionD: q.type === "MCQ" ? q.optionD : null
      }))
    })
  ]);

  return getFormById(id);
};

export const getFormUsage = async (id) => {
  const [courseModules, events] = await Promise.all([
    prisma.courseModule.findMany({
      where: { feedbackFormId: id },
      select: { id: true, title: true, course: { select: { name: true } } }
    }),
    prisma.event.findMany({
      where: { feedbackFormId: id },
      select: { id: true, title: true, startAt: true, batch: true }
    })
  ]);
  return { courseModules, events, total: courseModules.length + events.length };
};

// Delete is BLOCKED while the form is linked anywhere — an admin must unlink
// every module/event first. This is the real safeguard; the FK's
// onDelete: SetNull in schema.prisma is only a DB-level backstop.
export const deleteForm = async (id) => {
  const existing = await prisma.feedbackForm.findUnique({ where: { id } });
  if (!existing) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Feedback form not found");
  }

  const usage = await getFormUsage(id);
  if (usage.total > 0) {
    const names = [
      ...usage.courseModules.map((m) => `Module "${m.title}" (${m.course?.name || "—"})`),
      ...usage.events.map((e) => `Event "${e.title}"`)
    ];
    throw new ApiError(
      StatusCodes.CONFLICT,
      `Cannot delete — this feedback form is still linked to: ${names.join(", ")}. Unlink it from each first.`
    );
  }

  await prisma.feedbackForm.delete({ where: { id } });
  return { message: "Feedback form deleted successfully" };
};
