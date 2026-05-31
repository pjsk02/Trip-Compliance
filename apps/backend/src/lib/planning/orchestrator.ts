/**
 * Orchestrator — runs agents in three waves, negotiates conflicts, reaches
 * consensus, and assembles the final Itinerary.
 *
 *   Wave 1 (parallel): Activity, Food, Accommodation, Transportation
 *   Wave 2 (sequential): Budget (needs Wave 1 costs), Logistics (stub)
 *   Wave 3: Negotiation → Consensus → Itinerary assembly
 */
import {
  type PlanningContext,
  type OrchestratorResult,
  type LogisticsProposal,
  type ActivityProposal,
  type BudgetProposal,
} from './schemas';
import { ActivityAgent }       from './agents/activityAgent';
import { FoodAgent }           from './agents/foodAgent';
import { AccommodationAgent }  from './agents/accommodationAgent';
import { TransportationAgent } from './agents/transportationAgent';
import { BudgetAgent }         from './agents/budgetAgent';
import { negotiate }           from './negotiation';
import { runConsensus }        from './consensus';
import { assembleItinerary }   from './itinerary';
import type { ItineraryCandidate } from './scoring';

function logisticsStub(): LogisticsProposal {
  return {
    agent:  'logistics',
    status: 'stub',
    note:   'Logistics agent is scheduled for v1.1.',
  };
}

/**
 * Build candidate activity slates by sliding a window over the ranked list.
 * Produces up to 3 candidates for the consensus engine to compare.
 */
function buildCandidates(
  activity: ActivityProposal,
  budget: BudgetProposal,
  ctx: PlanningContext,
): ItineraryCandidate[] {
  const all = activity.candidates;
  const windowSize = Math.min(all.length, ctx.tripDuration * 2);
  const baseCostPerPerson = budget.totalEstimatedUsd / ctx.groupSize;
  const candidates: ItineraryCandidate[] = [];

  const maxStart = Math.min(all.length - windowSize, 2);
  for (let start = 0; start <= maxStart; start++) {
    const slice = all.slice(start, start + windowSize);
    candidates.push({
      activities:            slice,
      totalCostPerPersonUsd: slice.reduce((s, a) => s + a.estimatedCostPerPersonUsd, 0) + baseCostPerPerson,
      totalActivityHours:    slice.reduce((s, a) => s + a.durationHours, 0),
      distinctCategories:    new Set(slice.map(a => a.category)).size,
    });
  }

  if (candidates.length === 0) {
    candidates.push({
      activities:            all,
      totalCostPerPersonUsd: baseCostPerPerson,
      totalActivityHours:    all.reduce((s, a) => s + a.durationHours, 0),
      distinctCategories:    new Set(all.map(a => a.category)).size,
    });
  }

  return candidates;
}

/**
 * MVP assumption: agents use cost ESTIMATES (no live pricing APIs).
 * Apply a 12% planning buffer to the locked budget so agents have headroom
 * for estimate variance — agents see the buffered number; the raw locked
 * budget is used for hard compliance checks in the scoring engine.
 */
const BUDGET_BUFFER_PCT = 0.12;

export async function runOrchestrator(
  ctx: PlanningContext,
  maxNegotiationRounds = 3,
): Promise<OrchestratorResult> {
  const start = Date.now();

  // Apply buffer: agents plan against a slightly reduced budget so the final
  // itinerary stays within the real locked budget even if estimates run high.
  const bufferedBudget = Math.round(ctx.lockedBudget * (1 - BUDGET_BUFFER_PCT));
  const agentCtx: PlanningContext = { ...ctx, lockedBudget: bufferedBudget };

  // ── Wave 1: independent agents (plan against buffered budget) ────────────
  const [activityRaw, foodRaw, accommodation, transportation] = await Promise.all([
    new ActivityAgent().propose(agentCtx),
    new FoodAgent().propose(agentCtx),
    new AccommodationAgent().propose(agentCtx),
    new TransportationAgent().propose(agentCtx),
  ]);

  // ── Wave 2: Budget + Logistics ────────────────────────────────────────────
  const [budgetRaw, logistics] = await Promise.all([
    new BudgetAgent()
      .withInput({ ctx: agentCtx, activity: activityRaw, food: foodRaw, accommodation, transportation })
      .propose(agentCtx),
    Promise.resolve(logisticsStub()),
  ]);

  // ── Wave 3: Negotiate conflicts ───────────────────────────────────────────
  const negotiation = await negotiate(agentCtx, activityRaw, foodRaw, budgetRaw, maxNegotiationRounds);

  const activity = negotiation.activity;
  const food     = negotiation.food;

  // Re-price budget if activity list changed during negotiation
  const activityChanged = negotiation.rounds.some(r =>
    r.resolutions.some(s => s.startsWith('Activity agent')),
  );
  const budget = activityChanged
    ? await new BudgetAgent()
        .withInput({ ctx: agentCtx, activity, food, accommodation, transportation })
        .propose(agentCtx)
    : budgetRaw;

  // ── Consensus — score against the REAL locked budget (not buffered) ───────
  const consensus = runConsensus({
    candidates:      buildCandidates(activity, budget, agentCtx),
    members:         ctx.members,
    lockedBudgetUsd: ctx.lockedBudget,   // real locked budget for hard check
    tripDuration:    ctx.tripDuration,
  });

  // ── Assemble final itinerary ──────────────────────────────────────────────
  const itinerary = await assembleItinerary(
    ctx, activity, food, accommodation, transportation, budget, consensus, negotiation,
  );

  return {
    context: ctx,
    activity,
    food,
    accommodation,
    transportation,
    budget,
    logistics,
    negotiation,
    consensus,
    itinerary,
    durationMs: Date.now() - start,
  };
}

export { type PlanningContext } from './schemas';
