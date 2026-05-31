/**
 * Backfill script: creates a placeholder User row for every Member that has no userId.
 * Safe to run multiple times (idempotent). Does NOT overwrite real Google users.
 *
 * Run with:  npx ts-node scripts/backfill-users.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const unlinked = await prisma.member.findMany({
    where: { userId: null },
    select: { id: true, name: true },
  });

  console.log(`Found ${unlinked.length} member(s) without a linked user.`);

  for (const member of unlinked) {
    const placeholder = await prisma.user.create({
      data: {
        googleId: `placeholder_${member.id}`,
        email:    `placeholder_${member.id}@tripsync.local`,
        name:     member.name,
      },
    });
    await prisma.member.update({
      where: { id: member.id },
      data:  { userId: placeholder.id },
    });
    console.log(`  Linked member ${member.id} (${member.name}) → user ${placeholder.id}`);
  }

  console.log('Done.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
