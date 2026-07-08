import { z } from "zod";

const passwordRule = z
  .string()
  .min(8)
  .max(64)
  .regex(/[A-Z]/, "Must contain an uppercase letter")
  .regex(/[a-z]/, "Must contain a lowercase letter")
  .regex(/[0-9]/, "Must contain a digit");

export const registerSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(120),
    email: z.string().email(), // Allow all emails - IITB gets OTP, non-IITB gets admin approval
    password: passwordRule,
    role: z.enum(["STUDENT", "INSTRUCTOR", "VOLUNTEER"]).default("STUDENT"),
    employeeId: z.string().min(3).max(40).optional(),
    profileImageUrl: z.string().url().optional(),
    studentProfile: z
      .object({
        rollNumber: z.string().min(3).max(30),
        department: z.string().min(2).max(80),
        yearOfStudy: z.coerce.number().int().min(1).max(10),
        programme: z.enum(["BTECH", "MTECH", "PHD", "MSC", "MA", "DUAL_DEGREE", "OTHER"]),
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
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email(), // Allow all emails for login
    password: z.string().min(8)
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

export const refreshSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(20)
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});



