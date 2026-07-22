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

const questionsBody = z.object({
  questions: z.array(quizQuestionInput).length(10)
});

export const moduleQuizSchema = z.object({
  body: questionsBody,
  params: z.object({
    courseId: z.string().min(5),
    id: z.string().min(5)
  }),
  query: z.object({}).optional()
});

export const eventQuizSchema = z.object({
  body: questionsBody,
  params: z.object({
    eventId: z.string().min(5)
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
