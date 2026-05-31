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
  type FoodProposal,
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
import type { OnEvent } from './streamEvents';
import { wop } from '../weave';
import {
  activityStatement,
  foodStatement,
  accommodationStatement,
  transportationStatement,
  budgetStatement,
  orchestratorDecisionStatement,
} from './streamEvents';

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
 *
 * totalCostPerPersonUsd = non-activity costs per person (accommodation + food +
 * transport + misc, from the budget proposal) PLUS the activity costs for this
 * specific window slice. Activity costs are NOT part of baseCostPerPerson to
 * avoid double-counting.
 */
function buildCandidates(
  activity: ActivityProposal,
  food: FoodProposal,
  budget: BudgetProposal,
  ctx: PlanningContext,
): ItineraryCandidate[] {
  const all = activity.candidates;
  const windowSize = Math.min(all.length, ctx.tripDuration * 2);

  // Non-activity cost per person (accommodation + food + transport + misc).
  // Subtract activity costs from the budget total to avoid double-counting.
  const activityWindowSize = Math.min(all.length, Math.max(4, ctx.tripDuration * 2));
  const budgetActivityCostPP = Math.round(
    all.slice(0, activityWindowSize).reduce((s, a) => s + a.estimatedCostPerPersonUsd, 0),
  );
  const nonActivityCostPP = Math.max(
    0,
    Math.round(budget.totalEstimatedUsd / ctx.groupSize) - budgetActivityCostPP,
  );

  const candidates: ItineraryCandidate[] = [];

  const maxStart = Math.min(all.length - windowSize, 2);
  for (let start = 0; start <= maxStart; start++) {
    const slice = all.slice(start, start + windowSize);
    const sliceActivityCostPP = slice.reduce((s, a) => s + a.estimatedCostPerPersonUsd, 0);
    candidates.push({
      activities:            slice,
      meals:                 food.mealPlan,
      totalCostPerPersonUsd: Math.round(sliceActivityCostPP + nonActivityCostPP),
      totalActivityHours:    slice.reduce((s, a) => s + a.durationHours, 0),
      distinctCategories:    new Set(slice.map(a => a.category)).size,
    });
  }

  if (candidates.length === 0) {
    const allActivityCostPP = all.reduce((s, a) => s + a.estimatedCostPerPersonUsd, 0);
    candidates.push({
      activities:            all,
      meals:                 food.mealPlan,
      totalCostPerPersonUsd: Math.round(allActivityCostPP + nonActivityCostPP),
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

export const runOrchestrator = wop(
  'orchestrator:run',
  _runOrchestratorImpl,
);

async function _runOrchestratorImpl(
  ctx: PlanningContext,
  maxNegotiationRounds = 3,
  onEvent?: OnEvent,
): Promise<OrchestratorResult> {
  const start = Date.now();
  const emit  = onEvent ?? (() => {});

  // Apply buffer: agents plan against a slightly reduced budget so the final
  // itinerary stays within the real locked budget even if estimates run high.
  const bufferedBudget = Math.round(ctx.lockedBudget * (1 - BUDGET_BUFFER_PCT));
  const agentCtx: PlanningContext = { ...ctx, lockedBudget: bufferedBudget };

  // ── Wave 1: independent agents (plan against buffered budget) ────────────
  // Emit agent_started for all four before launching them in parallel so the
  // UI shows all agents thinking at once; each emits agent_proposal as it lands.
  (['activity', 'food', 'accommodation', 'transportation'] as const).forEach(a =>
    emit({ type: 'agent_started', agent: a }),
  );

  const [activityRaw, foodRaw, accommodation, transportation] = await Promise.all([
    new ActivityAgent().propose(agentCtx, emit).then(r => {
      emit({ type: 'agent_proposal', agent: 'activity', ...activityStatement(r, ctx) });
      return r;
    }),
    new FoodAgent().propose(agentCtx, emit).then(r => {
      emit({ type: 'agent_proposal', agent: 'food', ...foodStatement(r, ctx) });
      return r;
    }),
    new AccommodationAgent().propose(agentCtx, emit).then(r => {
      emit({ type: 'agent_proposal', agent: 'accommodation', ...accommodationStatement(r) });
      return r;
    }),
    new TransportationAgent().propose(agentCtx, emit).then(r => {
      emit({ type: 'agent_proposal', agent: 'transportation', ...transportationStatement(r) });
      return r;
    }),
  ]);

  // ── Wave 2: Budget + Logistics ────────────────────────────────────────────
  emit({ type: 'agent_started', agent: 'budget' });
  const [budgetRaw, logistics] = await Promise.all([
    new BudgetAgent()
      .withInput({ ctx: agentCtx, activity: activityRaw, food: foodRaw, accommodation, transportation, realLockedBudget: ctx.lockedBudget })
      .propose(agentCtx, emit)
      .then(r => {
        emit({ type: 'agent_proposal', agent: 'budget', ...budgetStatement(r, ctx) });
        return r;
      }),
    Promise.resolve(logisticsStub()),
  ]);

  // ── Wave 3: Negotiate conflicts ───────────────────────────────────────────
  const negotiation = await negotiate(agentCtx, activityRaw, foodRaw, budgetRaw, maxNegotiationRounds, emit);

  const activity = negotiation.activity;
  const food     = negotiation.food;

  // Re-price budget if activity list changed during negotiation
  const activityChanged = negotiation.rounds.some(r =>
    r.resolutions.some(s => s.startsWith('Activity agent')),
  );
  const budget = activityChanged
    ? await new BudgetAgent()
        .withInput({ ctx: agentCtx, activity, food, accommodation, transportation, realLockedBudget: ctx.lockedBudget })
        .propose(agentCtx, emit)
    : budgetRaw;

  // ── Consensus — score against the REAL locked budget (not buffered) ───────
  const consensus = runConsensus({
    candidates:      buildCandidates(activity, food, budget, agentCtx),
    members:         ctx.members,
    lockedBudgetUsd: ctx.lockedBudget,
    tripDuration:    ctx.tripDuration,
  });

  // Emit orchestrator decision with dimension scores from the winning scorecard
  const winner = consensus.winner ?? consensus.bestAvailable;
  emit({
    type: 'orchestrator_decision',
    statement: orchestratorDecisionStatement(consensus, ctx),
    consensusStatus: consensus.status,
    dimensionScores: winner ? {
      satisfaction: winner.dimensions.userSatisfaction.raw,
      fairness:     winner.dimensions.fairness.raw,
      budget:       winner.dimensions.budgetCompliance.raw,
      feasibility:  winner.dimensions.feasibility.raw,
      diversity:    winner.dimensions.diversity.raw,
    } : { satisfaction: 0, fairness: 0, budget: 0, feasibility: 0, diversity: 0 },
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
