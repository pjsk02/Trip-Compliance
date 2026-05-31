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
import { wop, isWeaveEnabled } from '../weave';
import type { AgentTimelineEntry, DecisionAuditEntry } from './itinerary';
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
  const timeline: AgentTimelineEntry[] = [];

  /** Record a completed agent step onto the timeline. */
  function recordStep<T>(
    agent: string,
    wave: 1 | 2 | 3,
    startedAt: number,
    result: T,
    summaryFn: (r: T) => string,
  ): T {
    const completedAt = Date.now();
    timeline.push({
      agent,
      wave,
      startedAt: startedAt - start,
      completedAt: completedAt - start,
      durationMs: completedAt - startedAt,
      status: 'ok',
      outputSummary: summaryFn(result),
    });
    return result;
  }

  // Apply buffer: agents plan against a slightly reduced budget so the final
  // itinerary stays within the real locked budget even if estimates run high.
  const bufferedBudget = Math.round(ctx.lockedBudget * (1 - BUDGET_BUFFER_PCT));
  const agentCtx: PlanningContext = { ...ctx, lockedBudget: bufferedBudget };

  // ── Wave 1: independent agents (plan against buffered budget) ────────────
  (['activity', 'food', 'accommodation', 'transportation'] as const).forEach(a =>
    emit({ type: 'agent_started', agent: a }),
  );

  const w1Start = Date.now();
  const [activityRaw, foodRaw, accommodation, transportation] = await Promise.all([
    (() => { const t = Date.now(); return new ActivityAgent().propose(agentCtx, emit).then(r => {
      emit({ type: 'agent_proposal', agent: 'activity', ...activityStatement(r, ctx) });
      return recordStep('activity', 1, t, r, p => `${p.candidates.length} candidates, top: "${p.candidates[0]?.name ?? 'n/a'}"`);
    }); })(),
    (() => { const t = Date.now(); return new FoodAgent().propose(agentCtx, emit).then(r => {
      emit({ type: 'agent_proposal', agent: 'food', ...foodStatement(r, ctx) });
      return recordStep('food', 1, t, r, p => `${p.mealPlan.length} meals, $${Math.round(p.totalFoodCostPerPersonUsd)}/person`);
    }); })(),
    (() => { const t = Date.now(); return new AccommodationAgent().propose(agentCtx, emit).then(r => {
      emit({ type: 'agent_proposal', agent: 'accommodation', ...accommodationStatement(r) });
      return recordStep('accommodation', 1, t, r, p => `rec: "${p.options[p.recommended]?.name ?? 'n/a'}" $${p.options[p.recommended]?.pricePerNightPerPersonUsd ?? 0}/night/pp`);
    }); })(),
    (() => { const t = Date.now(); return new TransportationAgent().propose(agentCtx, emit).then(r => {
      emit({ type: 'agent_proposal', agent: 'transportation', ...transportationStatement(r) });
      return recordStep('transportation', 1, t, r, p => `${p.legs.length} legs, $${Math.round(p.totalTransportCostPerPersonUsd)}/person`);
    }); })(),
  ]);

  // ── Wave 2: Budget + Logistics ────────────────────────────────────────────
  emit({ type: 'agent_started', agent: 'budget' });
  const budgetStart = Date.now();
  const [budgetRaw, logistics] = await Promise.all([
    new BudgetAgent()
      .withInput({ ctx: agentCtx, activity: activityRaw, food: foodRaw, accommodation, transportation, realLockedBudget: ctx.lockedBudget })
      .propose(agentCtx, emit)
      .then(r => {
        emit({ type: 'agent_proposal', agent: 'budget', ...budgetStatement(r, ctx) });
        return recordStep('budget', 2, budgetStart, r, p => `$${p.totalEstimatedUsd} total, ${p.overrunFlag ? 'OVER budget' : `$${Math.round(p.surplus)} surplus`}`);
      }),
    Promise.resolve(logisticsStub()),
  ]);

  // ── Wave 3: Negotiate conflicts ───────────────────────────────────────────
  const negStart = Date.now();
  const tracedNegotiate = wop('pipeline:negotiate', negotiate);
  const negotiation = await tracedNegotiate(agentCtx, activityRaw, foodRaw, budgetRaw, maxNegotiationRounds, emit);
  timeline.push({
    agent: 'negotiation',
    wave: 3,
    startedAt: negStart - start,
    completedAt: Date.now() - start,
    durationMs: Date.now() - negStart,
    status: 'ok',
    outputSummary: `${negotiation.rounds.length} round(s), ${negotiation.rounds.reduce((s, r) => s + r.resolutions.length, 0)} resolution(s)`,
  });

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
  const consensusStart = Date.now();
  const tracedConsensus = wop('pipeline:consensus', async (input: Parameters<typeof runConsensus>[0]) => runConsensus(input));
  const consensus = await tracedConsensus({
    candidates:      buildCandidates(activity, food, budget, agentCtx),
    members:         ctx.members,
    lockedBudgetUsd: ctx.lockedBudget,
    tripDuration:    ctx.tripDuration,
  });
  timeline.push({
    agent: 'consensus',
    wave: 3,
    startedAt: consensusStart - start,
    completedAt: Date.now() - start,
    durationMs: Date.now() - consensusStart,
    status: 'ok',
    outputSummary: `status=${consensus.status}, winner score=${consensus.winner?.totalScore ?? 'n/a'}`,
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

  // ── Build decision audit trail ────────────────────────────────────────────
  const decisionAudit = buildDecisionAudit(consensus, activityRaw, food, budget, ctx);

  // ── Assemble final itinerary ──────────────────────────────────────────────
  const tracedAssemble = wop('pipeline:assemble', assembleItinerary);
  const itinerary = await tracedAssemble(
    ctx, activity, food, accommodation, transportation, budget, consensus, negotiation,
  );

  // Attach observability metadata
  itinerary.agentTimeline = timeline;
  itinerary.decisionAudit = decisionAudit;
  if (isWeaveEnabled()) {
    const project = process.env.WANDB_PROJECT ?? 'tripsync';
    const entity  = process.env.WANDB_ENTITY ?? '';
    itinerary.weaveTraceUrl = entity
      ? `https://wandb.ai/${entity}/${project}/weave`
      : `https://wandb.ai/${project}/weave`;
  }

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

// ---------------------------------------------------------------------------
// Decision audit builder
// ---------------------------------------------------------------------------

function buildDecisionAudit(
  consensus: ReturnType<typeof runConsensus>,
  activity: ActivityProposal,
  food: ReturnType<typeof logisticsStub> extends never ? never : Parameters<typeof assembleItinerary>[2],
  budget: BudgetProposal,
  ctx: PlanningContext,
): DecisionAuditEntry[] {
  const audit: DecisionAuditEntry[] = [];
  const winner = consensus.winner ?? consensus.bestAvailable;

  // Activity selection audit
  if (winner && activity.candidates.length > 0) {
    const chosen = winner.candidate.activities;
    const rejected = activity.candidates.filter(c => !chosen.includes(c));
    if (rejected.length > 0) {
      audit.push({
        decision: 'Activity selection',
        chosen: chosen.map(a => a.name).join(', '),
        rejected: rejected.map(a => `${a.name} (score ${a.groupUtilityScore})`),
        reason: `Top ${chosen.length} candidates by group utility score selected; lower-scored or over-budget activities excluded.`,
        scores: Object.fromEntries(activity.candidates.map(a => [a.name, a.groupUtilityScore])),
      });
    }
  }

  // Consensus outcome audit
  if (consensus.allScorecards.length > 0) {
    const best = consensus.winner ?? consensus.bestAvailable;
    const others = consensus.allScorecards.filter(s => s !== best);
    audit.push({
      decision: 'Consensus selection',
      chosen: best
        ? `Score ${best.totalScore}/100 (satisfaction ${best.dimensions.userSatisfaction.raw}%, fairness ${best.dimensions.fairness.raw}, budget ${best.dimensions.budgetCompliance.raw})`
        : 'No winner — admin override required',
      rejected: others.map(s => `Candidate score ${s.totalScore}/100`),
      reason: consensus.status === 'OK'
        ? 'Highest-scoring Pareto-optimal candidate that passes the fairness floor and budget gate.'
        : consensus.status === 'ADMIN_OVERRIDE_REQUIRED'
        ? 'No candidate passed all quality gates (fairness floor + budget). Admin review required.'
        : 'Best available candidate selected (fairness floor not met).',
      scores: best ? {
        userSatisfaction:  best.dimensions.userSatisfaction.raw,
        fairness:          best.dimensions.fairness.raw,
        budgetCompliance:  best.dimensions.budgetCompliance.raw,
        feasibility:       best.dimensions.feasibility.raw,
        diversity:         best.dimensions.diversity.raw,
        total:             best.totalScore,
      } : {},
    });
  }

  // Budget audit
  audit.push({
    decision: 'Budget compliance',
    chosen: budget.overrunFlag
      ? `Over budget by $${Math.abs(budget.surplus)} — substitutions recommended`
      : `Within budget — $${budget.surplus} surplus`,
    rejected: budget.substitutions.map(s => `Replace "${s.replace}" with "${s.with}" (saves $${s.savingUsd})`),
    reason: `Total estimated $${budget.totalEstimatedUsd} vs locked $${budget.lockedBudgetUsd} for ${ctx.groupSize} people.`,
  });

  return audit;
}

export { type PlanningContext } from './schemas';
