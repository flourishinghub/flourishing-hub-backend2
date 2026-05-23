-- Add isVerified column to User table
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isVerified" BOOLEAN NOT NULL DEFAULT false;

-- Create EmailVerification table
CREATE TABLE IF NOT EXISTS "EmailVerification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "otp" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "isUsed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerification_pkey" PRIMARY KEY ("id")
);

-- Create indexes
CREATE INDEX IF NOT EXISTS "EmailVerification_userId_expiresAt_idx" ON "EmailVerification"("userId", "expiresAt");
CREATE INDEX IF NOT EXISTS "EmailVerification_otp_isUsed_idx" ON "EmailVerification"("otp", "isUsed");

-- Add foreign key constraint
ALTER TABLE "EmailVerification" ADD CONSTRAINT "EmailVerification_userId_fkey" 
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Set existing users as verified
UPDATE "User" SET "isVerified" = true WHERE "isVerified" = false;
