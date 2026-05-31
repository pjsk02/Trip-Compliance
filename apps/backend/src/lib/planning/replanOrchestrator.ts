/**
 * Replanning Orchestrator
 *
 * Accepts the original PlanningContext plus a FeedbackAdjustment, applies
 * the adjustment to the context (or agent system prompts), then re-runs the
 * relevant agents and assembles a new Itinerary version.
 *
 * Routing per feedback type:
 *   ACTIVITY_REWEIGHT  → mutate activity scores in context → re-run all waves
 *   BUDGET_CUT         → reduce lockedBudget → re-run BudgetAgent + consensus
 *   TRANSPORT_VETO     → inject veto note into TransportationAgent prompt → re-run from Wave 1
 *   PREFERENCE_CHANGE  → update the member's constraint profile → re-run all waves
 */
import {
  type PlanningContext,
  type OrchestratorResult,
  type LogisticsProposal,
  type ActivityProposal,
  type BudgetProposal,
  type FeedbackAdjustment,
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
  return { agent: 'logistics', status: 'stub', note: 'Logistics agent is scheduled for v1.1.' };
}

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
 * Apply the feedback adjustment to produce a mutated PlanningContext
 * and an optional extra instruction string for specific agents.
 */
function applyAdjustment(
  ctx: PlanningContext,
  adjustment: FeedbackAdjustment,
): { ctx: PlanningContext; agentOverrideInstruction?: string } {
  switch (adjustment.type) {
    case 'ACTIVITY_REWEIGHT': {
      // Shift activity scores for all members in the requested directions.
      const BOOST_DELTA  = 25;
      const REDUCE_DELTA = 25;
      const mutatedMembers = ctx.members.map(m => ({
        ...m,
        scores: {
          ...m.scores,
          activities: {
            ...m.scores.activities,
            ...Object.fromEntries(
              adjustment.boost.map(k => [
                k,
                Math.min(100, (m.scores.activities[k as keyof typeof m.scores.activities] ?? 50) + BOOST_DELTA),
              ]),
            ),
            ...Object.fromEntries(
              adjustment.reduce.map(k => [
                k,
                Math.max(0, (m.scores.activities[k as keyof typeof m.scores.activities] ?? 50) - REDUCE_DELTA),
              ]),
            ),
          },
        },
      }));
      return {
        ctx: { ...ctx, members: mutatedMembers },
        agentOverrideInstruction: adjustment.instruction,
      };
    }

    case 'BUDGET_CUT': {
      const newBudget = Math.max(
        0,
        ctx.lockedBudget - adjustment.cutPerPersonUsd * ctx.groupSize,
      );
      return {
        ctx: { ...ctx, lockedBudget: newBudget },
        agentOverrideInstruction: adjustment.instruction,
      };
    }

    case 'TRANSPORT_VETO': {
      // Inject the veto as a schedule restriction on the submitting member.
      // The TransportationAgent reads scheduleRestrictions from constraints.
      const mutatedMembers = ctx.members.map(m => {
        if (m.memberId !== adjustment.memberId) return m;
        return {
          ...m,
          constraints: {
            ...m.constraints,
            scheduleRestrictions: [
              m.constraints.scheduleRestrictions,
              `VETO: ${adjustment.vetoDescription}`,
            ].filter(Boolean).join('; '),
          },
        };
      });
      return {
        ctx: { ...ctx, members: mutatedMembers },
        agentOverrideInstruction: adjustment.instruction,
      };
    }

    case 'PREFERENCE_CHANGE': {
      const mutatedMembers = ctx.members.map(m => {
        if (m.memberId !== adjustment.memberId) return m;
        const changes = adjustment.changes as Record<string, unknown>;
        return {
          ...m,
          constraints: {
            ...m.constraints,
            ...(changes.dietaryRestrictions !== undefined && {
              dietaryRestrictions: changes.dietaryRestrictions as string[],
            }),
            ...(changes.alcoholPreference !== undefined && {
              alcoholPreference: changes.alcoholPreference as 'yes' | 'no' | 'sometimes',
            }),
          },
        };
      });
      return {
        ctx: { ...ctx, members: mutatedMembers },
        agentOverrideInstruction: adjustment.instruction,
      };
    }
  }
}

export async function runOrchestratorWithFeedback(
  originalCtx: PlanningContext,
  adjustment: FeedbackAdjustment,
  maxNegotiationRounds = 3,
): Promise<OrchestratorResult> {
  const start = Date.now();

  const { ctx } = applyAdjustment(originalCtx, adjustment);

  // All four feedback types require a full re-plan because inter-agent
  // dependencies mean a partial re-run would produce inconsistent proposals.
  const [activityRaw, foodRaw, accommodation, transportation] = await Promise.all([
    new ActivityAgent().propose(ctx),
    new FoodAgent().propose(ctx),
    new AccommodationAgent().propose(ctx),
    new TransportationAgent().propose(ctx),
  ]);

  const [budgetRaw, logistics] = await Promise.all([
    new BudgetAgent()
      .withInput({ ctx, activity: activityRaw, food: foodRaw, accommodation, transportation })
      .propose(ctx),
    Promise.resolve(logisticsStub()),
  ]);

  const negotiation = await negotiate(ctx, activityRaw, foodRaw, budgetRaw, maxNegotiationRounds);
  const activity    = negotiation.activity;
  const food        = negotiation.food;

  const activityChanged = negotiation.rounds.some(r =>
    r.resolutions.some((s: string) => s.startsWith('Activity agent')),
  );
  const budget = activityChanged
    ? await new BudgetAgent()
        .withInput({ ctx, activity, food, accommodation, transportation })
        .propose(ctx)
    : budgetRaw;

  const consensus = runConsensus({
    candidates:      buildCandidates(activity, budget, ctx),
    members:         ctx.members,
    lockedBudgetUsd: ctx.lockedBudget,
    tripDuration:    ctx.tripDuration,
  });

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
