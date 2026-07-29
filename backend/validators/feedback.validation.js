import { z } from "zod";

const feedbackQuestionTypeEnum = z.enum(["TEXT", "RATING", "MCQ"]);

// Options are only required for MCQ — TEXT/RATING questions don't carry
// them, but the frontend still sends them as empty strings (not omitted), so
// these can't use `.min(1)` — that would reject a defined-but-empty string,
// which is exactly what a non-MCQ question sends. The superRefine below is
// what actually enforces "must be non-empty" for MCQ specifically.
// Unlike Quiz, there is no correctOption: feedback isn't graded.
const feedbackQuestionInput = z
  .object({
    questionText: z.string().min(1).max(2000),
    type: feedbackQuestionTypeEnum,
    optionA: z.string().max(500).optional(),
    optionB: z.string().max(500).optional(),
    optionC: z.string().max(500).optional(),
    optionD: z.string().max(500).optional()
  })
  .superRefine((data, ctx) => {
    if (data.type === "MCQ" && !(data.optionA?.trim() && data.optionB?.trim() && data.optionC?.trim() && data.optionD?.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "MCQ questions require all 4 options",
        path: ["optionA"]
      });
    }
  });

// A module/event just LINKS to a Feedback-library form by id (or clears the
// link with null) — question authoring lives in the schemas below.
const linkFeedbackFormBody = z.object({
  feedbackFormId: z.string().min(5).nullable()
});

export const moduleFeedbackFormSchema = z.object({
  body: linkFeedbackFormBody,
  params: z.object({
    courseId: z.string().min(5),
    id: z.string().min(5)
  }),
  query: z.object({}).optional()
});

export const eventFeedbackFormSchema = z.object({
  body: linkFeedbackFormBody,
  params: z.object({
    eventId: z.string().min(5)
  }),
  query: z.object({}).optional()
});

export const createFeedbackFormSchema = z.object({
  body: z.object({
    title: z.string().min(1).max(200),
    questions: z.array(feedbackQuestionInput).min(1).optional()
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

export const updateFeedbackFormSchema = z.object({
  body: z.object({
    title: z.string().min(1).max(200),
    questions: z.array(feedbackQuestionInput).min(1)
  }),
  params: z.object({
    id: z.string().min(5)
  }),
  query: z.object({}).optional()
});

export const feedbackFormSubmitSchema = z.object({
  body: z.object({
    answers: z
      .array(
        z.object({
          questionId: z.string().min(1),
          answerText: z.string().max(5000).optional(),
          answerRating: z.number().int().min(1).max(5).optional()
        })
      )
      .min(1)
  }),
  params: z.object({
    eventId: z.string().min(5)
  }),
  query: z.object({}).optional()
});
