/**
 * Negotiation layer — the Orchestrator surfaces conflicts between agent
 * proposals and asks agents (via Claude) to propose resolutions.
 *
 * Conflict types detected:
 *   - BUDGET_OVERRUN:    Budget agent flags overrunFlag; asks BudgetAgent +
 *                        ActivityAgent to negotiate activity swaps.
 *   - DIETARY_VIOLATION: FoodAgent respected:false for a dietary flag.
 *   - ACCESSIBILITY:     Activity is inaccessible given mobility constraints.
 *   - SCHEDULE:          Total activity hours exceed available time.
 *
 * Each round: detect conflicts → ask relevant agents to re-propose →
 * re-score → continue until no conflicts OR maxRounds reached.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { PlanningContext, ActivityProposal, FoodProposal, BudgetProposal } from './schemas';
import type { ActivityCandidate } from './schemas';
import { ActivityProposalSchema, FoodProposalSchema } from './schemas';
import type { OnEvent, AgentName } from './streamEvents';

const anthropic = new Anthropic();

function model(): string {
  return process.env.CLAUDE_MODEL ?? 'claude-haiku-4-5-20251001';
}

function stripFences(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
}

// ---------------------------------------------------------------------------
// Conflict types
// ---------------------------------------------------------------------------

export type ConflictType =
  | 'BUDGET_OVERRUN'
  | 'DIETARY_VIOLATION'
  | 'ACCESSIBILITY'
  | 'SCHEDULE_OVERRUN';

export interface Conflict {
  type:        ConflictType;
  description: string;
  /** Which agents are involved in resolving this conflict. */
  agents:      string[];
}

export interface NegotiationRound {
  roundNum:   number;
  conflicts:  Conflict[];
  resolutions: string[];   // plain-English summary of what each agent changed
}

export interface NegotiationResult {
  activity:   ActivityProposal;
  food:       FoodProposal;
  rounds:     NegotiationRound[];
  converged:  boolean;   // false if maxRounds hit without full resolution
  finalConflicts: Conflict[];
}

// ---------------------------------------------------------------------------
// Conflict detection
// ---------------------------------------------------------------------------

export function detectConflicts(
  ctx: PlanningContext,
  activity: ActivityProposal,
  food: FoodProposal,
  budget: BudgetProposal,
): Conflict[] {
  const conflicts: Conflict[] = [];

  // Budget overrun
  if (budget.overrunFlag) {
    conflicts.push({
      type: 'BUDGET_OVERRUN',
      description: `Estimated total $${budget.totalEstimatedUsd.toFixed(0)} exceeds locked budget $${budget.lockedBudgetUsd.toFixed(0)} by $${Math.abs(budget.surplus).toFixed(0)}.`,
      agents: ['activity', 'budget'],
    });
  }

  // Dietary violations
  for (const flag of food.dietaryFlags) {
    if (!flag.respected) {
      conflicts.push({
        type: 'DIETARY_VIOLATION',
        description: `Dietary restriction "${flag.restriction}" for member(s) ${flag.affectedMembers.join(', ')} is not respected in the meal plan.`,
        agents: ['food'],
      });
    }
  }

  // Accessibility: inaccessible activities when mobility constraints exist
  const hasMobility = ctx.members.some(m => m.constraints.mobilityLimitations);
  if (hasMobility) {
    const inaccessible = activity.candidates.filter(
      a => a.accessibilityNotes && /inaccessible|not accessible|wheelchair not/i.test(a.accessibilityNotes),
    );
    if (inaccessible.length > 0) {
      conflicts.push({
        type: 'ACCESSIBILITY',
        description: `Activities not accessible to all members: ${inaccessible.map(a => a.name).join(', ')}.`,
        agents: ['activity'],
      });
    }
  }

  // Schedule overrun: top-5 activities would exceed available hours
  const top5Hours = activity.candidates
    .slice(0, 5)
    .reduce((s, a) => s + a.durationHours, 0);
  const availableHours = ctx.tripDuration * 8;
  if (top5Hours > availableHours * 1.15) {
    conflicts.push({
      type: 'SCHEDULE_OVERRUN',
      description: `Selected activities total ${top5Hours.toFixed(1)}h but only ${availableHours}h are available (${ctx.tripDuration} days × 8h).`,
      agents: ['activity'],
    });
  }

  return conflicts;
}

// ---------------------------------------------------------------------------
// Resolution prompts — each returns a revised proposal from Claude
// ---------------------------------------------------------------------------

async function resolveActivityConflict(
  ctx: PlanningContext,
  current: ActivityProposal,
  conflicts: Conflict[],
  roundNum: number,
): Promise<{ proposal: ActivityProposal; resolution: string }> {
  const budgetConflict = conflicts.find(c => c.type === 'BUDGET_OVERRUN');
  const scheduleConflict = conflicts.find(c => c.type === 'SCHEDULE_OVERRUN');
  const accessConflict = conflicts.find(c => c.type === 'ACCESSIBILITY');

  const conflictDesc = conflicts
    .filter(c => c.agents.includes('activity'))
    .map(c => `• ${c.type}: ${c.description}`)
    .join('\n');

  if (!conflictDesc) {
    return { proposal: current, resolution: 'No activity conflicts to resolve.' };
  }

  const prompt = `You are the TripSync Activity Planner agent in negotiation round ${roundNum}.

The following conflicts were detected in your previous proposal:
${conflictDesc}

Current activity candidates:
${JSON.stringify(current.candidates, null, 2)}

${budgetConflict ? `The Budget agent needs activity costs reduced by approximately $${Math.abs(0)} per person. Drop the most expensive activities or suggest cheaper alternatives.` : ''}
${scheduleConflict ? `The schedule is too packed. Remove or shorten activities so the total stays under ${ctx.tripDuration * 8} hours.` : ''}
${accessConflict ? `Remove or replace activities that are inaccessible to members with mobility limitations.` : ''}

RESPOND with ONLY a revised JSON activity proposal (same schema, no prose):
{
  "agent": "activity",
  "candidates": [...],
  "excluded": [...],
  "nuanceApplied": "brief note"
}`;

  const response = await anthropic.messages.create({
    model: model(),
    max_tokens: 2000,
    system: 'You are a TripSync planning agent. Output ONLY valid JSON matching the requested schema.',
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('');

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    return { proposal: current, resolution: 'Activity re-proposal failed to parse — keeping original.' };
  }

  const result = ActivityProposalSchema.safeParse(parsed);
  if (!result.success) {
    return { proposal: current, resolution: 'Activity re-proposal failed schema validation — keeping original.' };
  }

  const changedCount = result.data.candidates.length !== current.candidates.length
    ? `changed candidate count from ${current.candidates.length} to ${result.data.candidates.length}`
    : 'revised activity list';

  return {
    proposal: result.data,
    resolution: `Activity agent (round ${roundNum}): ${changedCount} to address ${conflicts.filter(c => c.agents.includes('activity')).map(c => c.type).join(', ')}.`,
  };
}

async function resolveFoodConflict(
  ctx: PlanningContext,
  current: FoodProposal,
  conflicts: Conflict[],
  roundNum: number,
): Promise<{ proposal: FoodProposal; resolution: string }> {
  const foodConflicts = conflicts.filter(c => c.agents.includes('food'));
  if (foodConflicts.length === 0) {
    return { proposal: current, resolution: 'No food conflicts to resolve.' };
  }

  const conflictDesc = foodConflicts
    .map(c => `• ${c.type}: ${c.description}`)
    .join('\n');

  const prompt = `You are the TripSync Food Planner agent in negotiation round ${roundNum}.

The following conflicts were detected in your previous meal plan:
${conflictDesc}

Current dietary flags with violations:
${JSON.stringify(current.dietaryFlags.filter(f => !f.respected), null, 2)}

Revise the meal plan to fully respect ALL dietary restrictions.
RESPOND with ONLY a revised JSON food proposal (same schema, no prose).`;

  const response = await anthropic.messages.create({
    model: model(),
    max_tokens: 3000,
    system: 'You are a TripSync planning agent. Output ONLY valid JSON matching the requested schema.',
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('');

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    return { proposal: current, resolution: 'Food re-proposal failed to parse — keeping original.' };
  }

  const result = FoodProposalSchema.safeParse(parsed);
  if (!result.success) {
    return { proposal: current, resolution: 'Food re-proposal failed schema — keeping original.' };
  }

  return {
    proposal: result.data,
    resolution: `Food agent (round ${roundNum}): revised meal plan to address dietary violations.`,
  };
}

// ---------------------------------------------------------------------------
// Main negotiation loop
// ---------------------------------------------------------------------------

const DEFAULT_MAX_ROUNDS = parseInt(process.env.NEGOTIATION_MAX_ROUNDS ?? '3', 10);

export async function negotiate(
  ctx: PlanningContext,
  initialActivity: ActivityProposal,
  initialFood: FoodProposal,
  initialBudget: BudgetProposal,
  maxRounds: number = DEFAULT_MAX_ROUNDS,
): Promise<NegotiationResult> {
  let activity = initialActivity;
  let food     = initialFood;
  const rounds: NegotiationRound[] = [];

  for (let round = 1; round <= maxRounds; round++) {
    const conflicts = detectConflicts(ctx, activity, food, initialBudget);

    if (conflicts.length === 0) {
      return {
        activity,
        food,
        rounds,
        converged: true,
        finalConflicts: [],
      };
    }

    const resolutions: string[] = [];

    // Run relevant agent re-proposals in parallel
    const activityConflicts = conflicts.filter(c => c.agents.includes('activity'));
    const foodConflicts     = conflicts.filter(c => c.agents.includes('food'));

    const [actResult, foodResult] = await Promise.all([
      activityConflicts.length > 0
        ? resolveActivityConflict(ctx, activity, conflicts, round)
        : Promise.resolve({ proposal: activity, resolution: '' }),
      foodConflicts.length > 0
        ? resolveFoodConflict(ctx, food, conflicts, round)
        : Promise.resolve({ proposal: food, resolution: '' }),
    ]);

    activity = actResult.proposal;
    food     = foodResult.proposal;

    if (actResult.resolution) resolutions.push(actResult.resolution);
    if (foodResult.resolution) resolutions.push(foodResult.resolution);

    rounds.push({ roundNum: round, conflicts, resolutions });
  }

  // Max rounds hit — report remaining conflicts
  const finalConflicts = detectConflicts(ctx, activity, food, initialBudget);

  return {
    activity,
    food,
    rounds,
    converged: finalConflicts.length === 0,
    finalConflicts,
  };
}
