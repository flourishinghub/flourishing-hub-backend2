import { z } from "zod";

const eventBody = z.object({
  title: z.string().min(3).max(160),
  description: z.string().min(10).max(5000),
  type: z.enum(["OPEN_WORKSHOP", "WELLNESS_COURSE", "PLACEMENT_WORKSHOP", "PHD_WORKSHOP", "OTHER"]),
  status: z.enum(["DRAFT", "PUBLISHED", "COMPLETED", "CANCELLED"]).optional(),
  bannerImageUrl: z.string().url().optional(),
  venue: z.string().max(200).optional(),
  meetLink: z.string().url().optional(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  registrationOpensAt: z.string().datetime().optional(),
  registrationClosesAt: z.string().datetime().optional(),
  capacity: z.coerce.number().int().min(1).max(10000).optional(),
  volunteersNeeded: z.coerce.number().int().min(0).max(500).optional(),
  isCampusWide: z.boolean().optional(),
  allowVolunteerSignup: z.boolean().optional(),
  requiresCheckIn: z.boolean().optional(),
  templateId: z.string().optional(),
  modules: z
    .array(
      z.object({
        title: z.string().min(2).max(160),
        description: z.string().max(2000).optional(),
        venue: z.string().max(200).optional(),
        meetLink: z.string().url().optional(),
        startAt: z.string().datetime(),
        endAt: z.string().datetime(),
        maxMarks: z.coerce.number().int().min(1).max(1000).optional(),
        quizLink: z.string().url().optional(),
        feedbackLink: z.string().url().optional()
      })
    )
    .optional()
});

export const createEventSchema = z.object({
  body: eventBody,
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

export const updateEventSchema = z.object({
  body: eventBody.partial(),
  params: z.object({
    eventId: z.string().min(5)
  }),
  query: z.object({}).optional()
});

export const bulkCreateEventSchema = z.object({
  body: z.object({
    events: z.array(eventBody).min(1).max(500)
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

export const listEventSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({}).optional(),
  query: z.object({
    status: z.enum(["DRAFT", "PUBLISHED", "COMPLETED", "CANCELLED"]).optional(),
    type: z.enum(["OPEN_WORKSHOP", "WELLNESS_COURSE", "PLACEMENT_WORKSHOP", "PHD_WORKSHOP", "OTHER"]).optional(),
    upcomingOnly: z.enum(["true", "false"]).optional(),
    activeOnly: z.enum(["true", "false"]).optional(),
    registeredOnly: z.enum(["true", "false"]).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    page: z.coerce.number().optional(),
    limit: z.coerce.number().optional(),
    batch: z.string().optional()
  })
});



