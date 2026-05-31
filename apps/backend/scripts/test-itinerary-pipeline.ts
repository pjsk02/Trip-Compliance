/**
 * End-to-end test of the negotiation + consensus + itinerary pipeline.
 * Runs against the seed group (or any group with complete preference profiles).
 *
 * Usage:
 *   npx tsx apps/backend/scripts/test-itinerary-pipeline.ts [groupCode]
 *
 * If no groupCode is given, uses the first PLANNING/BUDGET_NEGOTIATION group found.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { runOrchestrator } from '../src/lib/planning/orchestrator';
import type { MemberPreferenceSnapshot } from '../src/lib/planning/schemas';
import type { PreferenceScores, PreferencePriorities, ConstraintFields } from '../src/lib/preferenceSchema';

const prisma = new PrismaClient();

async function main() {
  const targetCode = process.argv[2]?.toUpperCase();

  // Find group
  const group = await prisma.group.findFirst({
    where: targetCode
      ? { groupCode: targetCode }
      : { status: { in: ['PLANNING', 'BUDGET_NEGOTIATION', 'COLLECTING'] } },
    include: {
      members: {
        include: {
          user:              true,
          preferenceProfile: true,
        },
      },
      budgetRounds: {
        orderBy: { roundNum: 'desc' },
        take: 1,
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!group) {
    console.error('No eligible group found. Create a group and submit preferences first.');
    process.exit(1);
  }

  console.log(`\nGroup: "${group.name}" (${group.groupCode})`);
  console.log(`Destination: ${group.destination ?? 'NOT SET'}`);
  console.log(`Status: ${group.status}`);
  console.log(`Members: ${group.members.length}`);

  const destination = group.destination ?? 'Barcelona, Spain';

  const lockedBudget = group.lockedBudget
    ? parseFloat(group.lockedBudget.toString())
    : group.budgetRounds[0]?.proposed
    ? parseFloat(group.budgetRounds[0].proposed.toString())
    : 5000;

  console.log(`Budget: $${lockedBudget}`);

  // Build member snapshots — synthesise test data for members without profiles
  const members: MemberPreferenceSnapshot[] = group.members.map((m, i) => {
    const profile = m.preferenceProfile as {
      scores?: PreferenceScores;
      priorities?: PreferencePriorities;
      constraintFields?: ConstraintFields;
      chatNuance?: string;
    } | null;

    if (profile?.scores && profile?.priorities) {
      return {
        memberId:    m.id,
        userId:      m.userId ?? m.id,
        name:        m.name,
        scores:      profile.scores,
        priorities:  profile.priorities,
        constraints: profile.constraintFields ?? { dietaryRestrictions: [], alcoholPreference: 'sometimes' as const },
        chatNuance:  profile.chatNuance ?? null,
      };
    }

    // Synthesise test preferences for members without profiles
    const seedScores: PreferenceScores[] = [
      {
        activities:  { hiking: 80, nightlife: 30, museums: 70, beaches: 60, adventure: 50 },
        food:        { streetFood: 70, fineDining: 40, localCuisine: 90, dietary: {}, alcohol: 60 },
        logistics:   { flightComfort: 60, accommodationType: {}, pace: 50, budgetSplit: 50, transport: {}, budgetConsciousness: 60 },
        constraints: { hardBudgetCap: 30, mobility: 10, schedule: 10, visa: 10 },
      },
      {
        activities:  { hiking: 20, nightlife: 80, museums: 40, beaches: 70, adventure: 30 },
        food:        { streetFood: 50, fineDining: 80, localCuisine: 60, dietary: { vegetarian: 100 }, alcohol: 40 },
        logistics:   { flightComfort: 80, accommodationType: {}, pace: 70, budgetSplit: 50, transport: {}, budgetConsciousness: 40 },
        constraints: { hardBudgetCap: 20, mobility: 10, schedule: 10, visa: 10 },
      },
      {
        activities:  { hiking: 90, nightlife: 20, museums: 60, beaches: 50, adventure: 80 },
        food:        { streetFood: 90, fineDining: 30, localCuisine: 80, dietary: {}, alcohol: 50 },
        logistics:   { flightComfort: 40, accommodationType: {}, pace: 60, budgetSplit: 50, transport: {}, budgetConsciousness: 80 },
        constraints: { hardBudgetCap: 50, mobility: 10, schedule: 10, visa: 10 },
      },
    ];

    const seedPriorities: PreferencePriorities[] = [
      { mustHave: ['Hiking / Outdoors', 'Local Cuisine'], niceToHave: ['Museums / Culture', 'Beaches'], neutral: ['Nightlife'], avoid: [] },
      { mustHave: ['Nightlife', 'Beaches'], niceToHave: ['Fine Dining'], neutral: ['Museums / Culture'], avoid: ['Hiking / Outdoors'] },
      { mustHave: ['Hiking / Outdoors', 'Adventure Sports'], niceToHave: ['Street Food', 'Local Cuisine'], neutral: ['Beaches'], avoid: ['Nightlife'] },
    ];

    const idx = i % seedScores.length;
    console.log(`  ⚠ ${m.name}: no profile — using seed data ${idx + 1}`);

    return {
      memberId:    m.id,
      userId:      m.userId ?? m.id,
      name:        m.name,
      scores:      seedScores[idx]!,
      priorities:  seedPriorities[idx]!,
      constraints: { dietaryRestrictions: idx === 1 ? ['vegetarian'] : [], alcoholPreference: 'sometimes' as const },
      chatNuance:  null,
    };
  });

  if (members.length === 0) {
    console.error('No members in group.');
    process.exit(1);
  }

  const tripDuration = 4;  // nights
  const ctx = { destination, tripDuration, groupSize: members.length, lockedBudget, members };

  console.log(`\nRunning orchestrator (${members.length} members, ${tripDuration} nights, $${lockedBudget} budget)...`);
  const t0 = Date.now();

  const result = await runOrchestrator(ctx, 2);

  const itinerary = result.itinerary as {
    dayPlans: Array<{ day: number; theme: string; dayTotalCostPerPersonUsd: number; blocks: unknown[] }>;
    budgetBreakdown: { totalPerPersonUsd: number; surplus: number; notes: string; lines: Array<{ category: string; estimatedCostPerPersonUsd: number }> };
    satisfactionScores: { groupSatisfactionPct: number; fairnessScore: number; fairnessFloorMet: boolean; perMember: Array<{ memberName: string; satisfactionPct: number; unmetMustHave: string[] }> };
    tradeoffReport: string;
    adminOverrideFlag: boolean;
    negotiationRounds: number;
  };

  const negotiation = result.negotiation as { rounds: unknown[]; converged: boolean; finalConflicts: unknown[] };
  const consensus   = result.consensus   as { status: string };

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`PIPELINE COMPLETE in ${result.durationMs}ms`);
  console.log(`─`.repeat(60));

  console.log(`\nNEGOTIATION`);
  console.log(`  Rounds run:    ${negotiation.rounds.length}`);
  console.log(`  Converged:     ${negotiation.converged}`);
  console.log(`  Final conflicts: ${negotiation.finalConflicts.length}`);

  console.log(`\nCONSENSUS`);
  console.log(`  Status:        ${consensus.status}`);
  console.log(`  Admin override: ${itinerary.adminOverrideFlag}`);

  console.log(`\nSATISFACTION`);
  console.log(`  Group avg:     ${itinerary.satisfactionScores.groupSatisfactionPct}%`);
  console.log(`  Fairness:      ${itinerary.satisfactionScores.fairnessScore}/100`);
  console.log(`  Floor met:     ${itinerary.satisfactionScores.fairnessFloorMet}`);
  for (const ms of itinerary.satisfactionScores.perMember) {
    const flag = ms.satisfactionPct < 70 ? ' ⚠' : '';
    console.log(`  ${ms.memberName}: ${ms.satisfactionPct}%${flag} (unmet must-haves: ${ms.unmetMustHave.join(', ') || 'none'})`);
  }

  console.log(`\nBUDGET`);
  console.log(`  Per person:    $${itinerary.budgetBreakdown.totalPerPersonUsd}`);
  console.log(`  Surplus:       $${itinerary.budgetBreakdown.surplus.toFixed(0)}`);
  for (const line of itinerary.budgetBreakdown.lines) {
    console.log(`    ${line.category}: $${line.estimatedCostPerPersonUsd}/person`);
  }
  console.log(`  ${itinerary.budgetBreakdown.notes}`);

  console.log(`\nITINERARY (${itinerary.dayPlans.length} days)`);
  for (const day of itinerary.dayPlans) {
    console.log(`  Day ${day.day}: ${day.theme} — $${day.dayTotalCostPerPersonUsd.toFixed(0)}/person`);
    const blocks = day.blocks as Array<{ timeBlock: string; title: string; estimatedCostPerPersonUsd: number }>;
    for (const block of blocks) {
      console.log(`    [${block.timeBlock}] ${block.title} ($${block.estimatedCostPerPersonUsd})`);
    }
  }

  console.log(`\nTRADEOFF REPORT`);
  console.log(itinerary.tradeoffReport);

  // Save to DB
  console.log(`\nSaving Itinerary v1 to database...`);
  const existing = await prisma.itinerary.findFirst({
    where: { groupId: group.id },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const version = (existing?.version ?? 0) + 1;

  const saved = await prisma.itinerary.create({
    data: {
      groupId:           group.id,
      version,
      dayPlans:          itinerary.dayPlans as object,
      budgetBreakdown:   itinerary.budgetBreakdown as object,
      satisfactionScores: itinerary.satisfactionScores as object,
      tradeoffReport:    itinerary.tradeoffReport,
    },
  });

  console.log(`\n✓ Saved as Itinerary v${saved.version} (id: ${saved.id})`);
  console.log(`  Total wall time: ${Date.now() - t0}ms`);
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
