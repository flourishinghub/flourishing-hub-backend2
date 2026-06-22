const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Running migration: add_registration_mode...');
  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RegistrationMode') THEN
        CREATE TYPE "RegistrationMode" AS ENUM ('COMPULSORY', 'OPTIONAL_BUNDLE', 'OPEN');
      END IF;
    END $$
  `);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "registrationMode" TEXT NOT NULL DEFAULT 'OPEN'`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "quizLink" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "feedbackLink" TEXT`);
  console.log('✅ Migration applied successfully');
}

main()
  .catch(e => { console.error('❌ Migration failed:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
