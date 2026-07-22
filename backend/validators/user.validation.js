import { z } from "zod";

export const listUsersSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({}).optional(),
  query: z.object({
    role: z.enum(["STUDENT", "INSTRUCTOR", "ADMIN", "VOLUNTEER", "ASSOCIATE_INSTRUCTOR"]).optional(),
    search: z.string().optional(),
    department: z.string().optional(),
    programme: z.enum(["BTECH", "MTECH", "PHD", "MSC", "MA", "OTHER"]).optional(),
    yearOfStudy: z.coerce.number().optional(),
    cohort: z.string().optional(),
    page: z.coerce.number().optional(),
    limit: z.coerce.number().optional()
  })
});

export const updateUserRoleSchema = z.object({
  body: z.object({
    role: z.enum(["STUDENT", "INSTRUCTOR", "ADMIN", "VOLUNTEER", "ASSOCIATE_INSTRUCTOR"])
  }),
  params: z.object({
    userId: z.string().min(5)
  }),
  query: z.object({}).optional()
});

export const userIdSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({
    userId: z.string().min(5)
  }),
  query: z.object({}).optional()
});

export const updateUserProfileSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(120).optional(),
    email: z.string().email().endsWith("@iitb.ac.in").optional(),
    profileImageUrl: z.string().url().optional(),
    employeeId: z.string().min(3).max(40).optional(),
    studentProfile: z
      .object({
        // Same email-instead-of-roll-number guard as the signup schema — see
        // auth.validation.js for why this matters.
        rollNumber: z.string().min(3).max(30).optional().refine((v) => v === undefined || !v.includes("@"), "Roll number looks like an email address — enter your actual roll number"),
        department: z.string().min(2).max(80).optional(),
        yearOfStudy: z.coerce.number().int().min(1).max(10).optional(),
        programme: z.enum(["BTECH", "MTECH", "PHD", "MSC", "MA", "OTHER"]).optional(),
        section: z.string().max(40).optional(),
        cohort: z.string().max(40).optional()
      })
      .optional(),
    instructorProfile: z
      .object({
        designation: z.string().max(120).optional(),
        department: z.string().max(120).optional()
      })
      .optional()
  }),
  params: z.object({
    userId: z.string().min(5)
  }),
  query: z.object({}).optional()
});



