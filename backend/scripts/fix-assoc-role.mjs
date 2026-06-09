import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: 'associate.instructor@iitb.ac.in' },
    select: { id: true, name: true, email: true, role: true }
  });

  if (!user) {
    console.log('❌ User not found');
    process.exit(1);
  }

  console.log(`Current role: ${user.role} (${user.email})`);

  if (user.role === 'ASSOCIATE_INSTRUCTOR') {
    console.log('✅ Already ASSOCIATE_INSTRUCTOR — no update needed');
    process.exit(0);
  }

  const updated = await prisma.user.update({
    where: { email: 'associate.instructor@iitb.ac.in' },
    data: { role: 'ASSOCIATE_INSTRUCTOR' },
    select: { id: true, email: true, role: true }
  });

  console.log(`✅ Updated: ${updated.email} → ${updated.role}`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
