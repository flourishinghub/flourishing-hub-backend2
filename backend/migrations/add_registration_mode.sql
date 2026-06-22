-- Add RegistrationMode enum and new fields to Event table
-- Run this on Supabase SQL editor

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RegistrationMode') THEN
    CREATE TYPE "RegistrationMode" AS ENUM ('COMPULSORY', 'OPTIONAL_BUNDLE', 'OPEN');
  END IF;
END $$;

ALTER TABLE "Event"
  ADD COLUMN IF NOT EXISTS "registrationMode" "RegistrationMode" NOT NULL DEFAULT 'OPEN',
  ADD COLUMN IF NOT EXISTS "quizLink" TEXT,
  ADD COLUMN IF NOT EXISTS "feedbackLink" TEXT;
