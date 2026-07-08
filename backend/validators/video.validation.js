import { z } from "zod";

const videoBody = z.object({
  title: z.string().min(2).max(200),
  description: z.string().min(1).max(5000),
  youtubeUrl: z.string().url(),
  thumbnailUrl: z.string().url().optional(),
  duration: z.string().min(1).max(20),
  category: z.enum(["MENTORSHIP", "LEADERSHIP", "WELLNESS"]),
  tags: z.array(z.string()).optional(),
  isActive: z.boolean().optional()
});

export const createVideoSchema = z.object({
  body: videoBody,
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

export const updateVideoSchema = z.object({
  body: videoBody.partial(),
  params: z.object({
    videoId: z.string().min(5)
  }),
  query: z.object({}).optional()
});
