import { PrismaClient, GroupStatus, PreferenceStatus, ChatRole } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Idempotent: wipe existing seed group by groupCode so re-runs are safe.
  await prisma.group.deleteMany({ where: { groupCode: 'BEACH42' } });

  const group = await prisma.group.create({
    data: {
      name: 'Summer Beach Trip',
      groupCode: 'BEACH42',
      // bcrypt hash of "password123" — placeholder for dev only
      passwordHash: '$2b$10$K7L1OJ45/4Y2nIvhRVpCe.FSmhDdWoXehVzJptJ/op0lSsqg2kwSe',
      destination: 'Miami, FL',
      status: GroupStatus.COLLECTING,
    },
  });

  // ── Members ────────────────────────────────────────────────────────────────

  const [alex, priya, jordan, sam] = await Promise.all([
    prisma.member.create({
      data: {
        groupId: group.id,
        name: 'Alex',
        isAdmin: true,
        preferenceStatus: PreferenceStatus.COMPLETE,
        privateBudget: 1200,
      },
    }),
    prisma.member.create({
      data: {
        groupId: group.id,
        name: 'Priya',
        isAdmin: false,
        preferenceStatus: PreferenceStatus.IN_PROGRESS,
        privateBudget: 900,
      },
    }),
    prisma.member.create({
      data: {
        groupId: group.id,
        name: 'Jordan',
        isAdmin: false,
        preferenceStatus: PreferenceStatus.COMPLETE,
        privateBudget: 1500,
      },
    }),
    prisma.member.create({
      data: {
        groupId: group.id,
        name: 'Sam',
        isAdmin: false,
        preferenceStatus: PreferenceStatus.PENDING,
        privateBudget: null,
      },
    }),
  ]);

  // Set admin after members exist
  await prisma.group.update({
    where: { id: group.id },
    data: { adminMemberId: alex.id },
  });

  // ── Preference Profiles ────────────────────────────────────────────────────

  await Promise.all([
    prisma.preferenceProfile.create({
      data: {
        memberId: alex.id,
        scores: {
          activities: { beach: 90, hiking: 60, nightlife: 40, sightseeing: 70 },
          food: { seafood: 95, vegetarian: 50, streetFood: 80, fineDining: 55 },
          logistics: { earlyMornings: 30, longWalks: 70, publicTransit: 60 },
          constraints: { budget: 75, accessibility: 20, dietaryRestrictions: 10 },
        },
        priorities: {
          mustHave: ['beach access', 'good seafood'],
          niceToHave: ['rooftop bar', 'snorkeling'],
          neutral: ['museums', 'shopping'],
          avoid: ['crowded tourist traps'],
        },
      },
    }),
    prisma.preferenceProfile.create({
      data: {
        memberId: priya.id,
        scores: {
          activities: { beach: 70, hiking: 85, nightlife: 30, sightseeing: 90 },
          food: { seafood: 40, vegetarian: 95, streetFood: 75, fineDining: 60 },
          logistics: { earlyMornings: 80, longWalks: 90, publicTransit: 70 },
          constraints: { budget: 90, accessibility: 30, dietaryRestrictions: 95 },
        },
        priorities: {
          mustHave: ['vegetarian options', 'cultural sites'],
          niceToHave: ['nature walks', 'local markets'],
          neutral: ['nightlife', 'beach'],
          avoid: ['seafood-only restaurants'],
        },
      },
    }),
    prisma.preferenceProfile.create({
      data: {
        memberId: jordan.id,
        scores: {
          activities: { beach: 85, hiking: 40, nightlife: 95, sightseeing: 50 },
          food: { seafood: 80, vegetarian: 30, streetFood: 90, fineDining: 85 },
          logistics: { earlyMornings: 10, longWalks: 50, publicTransit: 40 },
          constraints: { budget: 40, accessibility: 15, dietaryRestrictions: 5 },
        },
        priorities: {
          mustHave: ['nightlife', 'fine dining at least one night'],
          niceToHave: ['beach club', 'water sports'],
          neutral: ['history', 'hiking'],
          avoid: ['early-morning activities'],
        },
      },
    }),
    // Sam has PENDING status — no profile yet
  ]);

  // ── Chat Messages (Alex's completed preference chat) ───────────────────────

  await prisma.chatMessage.createMany({
    data: [
      {
        memberId: alex.id,
        role: ChatRole.ASSISTANT,
        content: "Hi Alex! I'm here to learn about your travel preferences for the Summer Beach Trip. Let's start simple — what's the main vibe you're hoping for on this trip?",
      },
      {
        memberId: alex.id,
        role: ChatRole.USER,
        content: 'I want good beaches and amazing seafood. Nothing too touristy though.',
      },
      {
        memberId: alex.id,
        role: ChatRole.ASSISTANT,
        content: 'Love it — chill beach energy with great local seafood spots. What about budget? Any hard limit per day you\'re working with?',
      },
      {
        memberId: alex.id,
        role: ChatRole.USER,
        content: "Around $1200 total for the trip including flights. I'm flexible by like $200.",
      },
      {
        memberId: alex.id,
        role: ChatRole.ASSISTANT,
        content: "Got it, ~$1200 with some flex. I've captured your preferences. You're all set!",
      },
    ],
  });

  console.log(`
✓ Seed complete
  Group:   ${group.name} (code: ${group.groupCode})
  Members: Alex (admin), Priya, Jordan, Sam
  Profiles: Alex ✓  Priya ✓  Jordan ✓  Sam — (pending)
  `);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
