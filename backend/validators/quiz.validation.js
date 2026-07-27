import { z } from "zod";

const optionEnum = z.enum(["A", "B", "C", "D"]);

const quizQuestionInput = z.object({
  questionText: z.string().min(1).max(2000),
  optionA: z.string().min(1).max(500),
  optionB: z.string().min(1).max(500),
  optionC: z.string().min(1).max(500),
  optionD: z.string().min(1).max(500),
  correctOption: optionEnum
});

// A module/event now just LINKS to a Quiz-library quiz by id (or clears the
// link with null) — question authoring lives in quizLibrarySchema below.
const linkQuizBody = z.object({
  quizId: z.string().min(5).nullable()
});

export const moduleQuizSchema = z.object({
  body: linkQuizBody,
  params: z.object({
    courseId: z.string().min(5),
    id: z.string().min(5)
  }),
  query: z.object({}).optional()
});

export const eventQuizSchema = z.object({
  body: linkQuizBody,
  params: z.object({
    eventId: z.string().min(5)
  }),
  query: z.object({}).optional()
});

export const createQuizLibrarySchema = z.object({
  body: z.object({
    title: z.string().min(1).max(200),
    questions: z.array(quizQuestionInput).length(10).optional()
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

export const updateQuizLibrarySchema = z.object({
  body: z.object({
    title: z.string().min(1).max(200),
    questions: z.array(quizQuestionInput).length(10)
  }),
  params: z.object({
    id: z.string().min(5)
  }),
  query: z.object({}).optional()
});

export const quizSubmitSchema = z.object({
  body: z.object({
    answers: z
      .array(
        z.object({
          questionId: z.string().min(1),
          selectedOption: optionEnum
        })
      )
      .min(1)
  }),
  params: z.object({
    eventId: z.string().min(5)
  }),
  query: z.object({}).optional()
});
