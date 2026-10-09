import { z } from "zod";

const passwordRule = z
  .string()
  .min(8)
  .max(64)
  .regex(/[A-Z]/, "Must contain an uppercase letter")
  .regex(/[a-z]/, "Must contain a lowercase letter")
  .regex(/[0-9]/, "Must contain a digit");

// A phone number typed into the roll field (seen live: 8905554103) — no IITB
// roll is 10+ digits long (the longest, e.g. 180010051, are 9).
export const looksLikePhoneNumber = (v) => /^\+?\d{10,}$/.test(String(v).trim());

// An IITB address whose local part is itself a roll number (24b0665@iitb.ac.in).
const ROLL_STYLE_LOCAL_PART = /^(\d{2}[a-z]{1,2}\d{3,6}|\d{9})$/i;

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
        // The signup form's roll-number field is free text with no format
        // check — a student who fat-fingers their email address into it
        // (instead of e.g. "25M0199") gets it silently accepted, and every
        // roll-number-keyed lookup elsewhere (batch-upload matching, admin
        // search) then fails to find them since the batch CSV has their real
        // roll number, not their email.
        rollNumber: z.string().min(3).max(30)
          .refine((v) => !v.includes("@"), "Roll number looks like an email address — enter your actual roll number")
          .refine((v) => !looksLikePhoneNumber(v), "Roll number looks like a phone number — enter your actual roll number"),
        department: z.string().min(2).max(80),
        yearOfStudy: z.coerce.number().int().min(1).max(10),
        programme: z.enum(["BTECH", "BDES", "BS", "MTECH", "PHD", "MSC", "MA", "DUAL_DEGREE", "OTHER"]),
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
  }).superRefine((body, ctx) => {
    // When the institute email is itself the roll number, the typed roll must
    // be the same one. A mismatch (23b0412 for 23b0411@, a phone number for
    // 24b0665@) leaves the account unmatched to its batch CSV and sheet rows,
    // and the student then shows up twice in analytics.
    const roll = body.studentProfile?.rollNumber;
    if (!roll) return;
    const [local, domain] = body.email.toLowerCase().split("@");
    if (domain !== "iitb.ac.in" || !ROLL_STYLE_LOCAL_PART.test(local)) return;
    if (roll.replace(/\s+/g, "").toLowerCase() !== local) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["studentProfile", "rollNumber"],
        message: `Roll number must match your institute email (${local.toUpperCase()})`
      });
    }
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



