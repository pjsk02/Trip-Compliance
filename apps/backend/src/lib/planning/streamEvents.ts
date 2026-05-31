/**
 * Typed stream events emitted via SSE as the orchestration pipeline runs.
 * Statement generators produce natural-language text; all numbers come from
 * the computed proposal values — never invented.
 */
import type {
  ActivityProposal,
  FoodProposal,
  AccommodationProposal,
  TransportationProposal,
  BudgetProposal,
  PlanningContext,
} from './schemas';
import type { ConsensusResult } from './consensus';

// ---------------------------------------------------------------------------
// Agent names
// ---------------------------------------------------------------------------

export type AgentName =
  | 'activity'
  | 'food'
  | 'accommodation'
  | 'transportation'
  | 'budget'
  | 'orchestrator';

// ---------------------------------------------------------------------------
// Dimension scores (0-100 each)
// ---------------------------------------------------------------------------

export interface DimensionScores {
  satisfaction: number;
  fairness:     number;
  budget:       number;
  feasibility:  number;
  diversity:    number;
}

// ---------------------------------------------------------------------------
// Event union
// ---------------------------------------------------------------------------

export type StreamEvent =
  | { type: 'agent_started';       agent: AgentName }
  | { type: 'agent_proposal';      agent: AgentName; statement: string; keyNumbers: Record<string, number | string> }
  | { type: 'pushback';            fromAgent: AgentName; againstAgent: AgentName; statement: string }
  | { type: 'resolution_proposed'; statement: string }
  | { type: 'round_completed';     roundNumber: number; conflictsResolved: number; remaining: number }
  | { type: 'orchestrator_decision'; statement: string; dimensionScores: DimensionScores; consensusStatus: string }
  | { type: 'done';                itineraryId: string; version: number }
  | { type: 'agent_error';         agent: AgentName; message: string };

export type OnEvent = (event: StreamEvent) => void;

// ---------------------------------------------------------------------------
// Statement generators — all numbers sourced from computed proposal data
// ---------------------------------------------------------------------------

export function activityStatement(
  p: ActivityProposal,
  ctx: PlanningContext,
): { statement: string; keyNumbers: Record<string, number | string> } {
  const top2 = p.candidates.slice(0, 2).map(a => a.name).join(' and ');
  const totalCost = Math.round(p.candidates.reduce((s, a) => s + a.estimatedCostPerPersonUsd, 0));
  const categories = new Set(p.candidates.map(a => a.category)).size;
  const topScore = Math.max(...p.candidates.map(a => a.groupUtilityScore));
  const statement = [
    `I'm proposing ${p.candidates.length} activities across ${categories} categories for ${ctx.tripDuration} nights.`,
    top2 ? `Top picks: ${top2} (highest group utility: ${topScore}/100).` : '',
    `Activity cost: ~$${totalCost}/person.`,
    p.excluded.length > 0 ? `Excluded ${p.excluded.length} due to member constraints.` : '',
    p.nuanceApplied ? `Applied nuance: ${p.nuanceApplied}` : '',
  ].filter(Boolean).join(' ');
  return {
    statement,
    keyNumbers: { candidates: p.candidates.length, categories, estimatedCost: totalCost, excluded: p.excluded.length },
  };
}

export function foodStatement(
  p: FoodProposal,
  ctx: PlanningContext,
): { statement: string; keyNumbers: Record<string, number | string> } {
  const unresolved = p.dietaryFlags.filter(f => !f.respected).length;
  const statement = [
    `Meal plan covers ${p.mealPlan.length} meals over ${ctx.tripDuration} days.`,
    `Food budget: $${Math.round(p.totalFoodCostPerPersonUsd)}/person.`,
    unresolved > 0
      ? `⚠ ${unresolved} dietary restriction(s) not yet resolved — flagging for negotiation.`
      : 'All dietary restrictions respected ✓',
  ].join(' ');
  return {
    statement,
    keyNumbers: {
      meals:             p.mealPlan.length,
      foodCost:          Math.round(p.totalFoodCostPerPersonUsd),
      unresolvedDietary: unresolved,
    },
  };
}

export function accommodationStatement(
  p: AccommodationProposal,
): { statement: string; keyNumbers: Record<string, number | string> } {
  const rec = p.options[p.recommended];
  const prices = p.options.map(o => o.pricePerNightPerPersonUsd);
  const minPrice = Math.round(Math.min(...prices));
  const maxPrice = Math.round(Math.max(...prices));
  const statement = [
    `${p.options.length} accommodation options, $${minPrice}–$${maxPrice}/person/night.`,
    rec ? `Recommending: ${rec.name} (group fit: ${rec.groupFitScore}/100).` : '',
    p.rationale,
  ].filter(Boolean).join(' ');
  return {
    statement,
    keyNumbers: {
      options:              p.options.length,
      recommendedFitScore:  rec?.groupFitScore ?? 0,
      priceMin:             minPrice,
      priceMax:             maxPrice,
    },
  };
}

export function transportationStatement(
  p: TransportationProposal,
): { statement: string; keyNumbers: Record<string, number | string> } {
  const mainLeg = p.legs[0];
  const statement = [
    `${p.legs.length} leg(s) planned.`,
    mainLeg
      ? `Primary: ${mainLeg.from} → ${mainLeg.to} by ${mainLeg.mode} (~$${Math.round(mainLeg.estimatedCostPerPersonUsd)}/person).`
      : '',
    `Total transport: $${Math.round(p.totalTransportCostPerPersonUsd)}/person.`,
    p.localTransportSummary ? p.localTransportSummary.split('.')[0] + '.' : '',
  ].filter(Boolean).join(' ');
  return {
    statement,
    keyNumbers: {
      legs:               p.legs.length,
      totalTransportCost: Math.round(p.totalTransportCostPerPersonUsd),
    },
  };
}

export function budgetStatement(
  p: BudgetProposal,
  ctx: PlanningContext,
): { statement: string; keyNumbers: Record<string, number | string> } {
  const perPerson     = Math.round(p.totalEstimatedUsd / Math.max(ctx.groupSize, 1));
  const lockedPP      = Math.round(p.lockedBudgetUsd   / Math.max(ctx.groupSize, 1));
  const surplusPP     = Math.round(p.surplus            / Math.max(ctx.groupSize, 1));

  if (p.overrunFlag) {
    const overrunPP = Math.round(Math.abs(p.surplus) / Math.max(ctx.groupSize, 1));
    const swapNote  = p.substitutions.length > 0
      ? `Proposing ${p.substitutions.length} swap(s) to recover ~$${Math.round(p.substitutions.reduce((s, x) => s + x.savingUsd, 0) / Math.max(ctx.groupSize, 1))}/person.`
      : 'Activity and/or food costs need to come down.';
    return {
      statement: `⚠ Total $${perPerson}/person against the $${lockedPP}/person envelope — $${overrunPP}/person over budget. ${swapNote}`,
      keyNumbers: { totalPerPerson: perPerson, lockedPerPerson: lockedPP, overrunPerPerson: overrunPP, surplus: Math.round(p.surplus) },
    };
  }

  return {
    statement: `Budget check: $${perPerson}/person — within the $${lockedPP}/person envelope with $${Math.abs(surplusPP)}/person to spare ✓`,
    keyNumbers: { totalPerPerson: perPerson, lockedPerPerson: lockedPP, bufferPerPerson: Math.abs(surplusPP) },
  };
}

export function orchestratorDecisionStatement(
  consensus: ConsensusResult,
  ctx: PlanningContext,
): string {
  const winner = consensus.winner ?? consensus.bestAvailable;

  if (consensus.status === 'OK' && winner) {
    const lowest = Math.min(...winner.memberSatisfaction.map(m => m.satisfactionPct));
    return (
      `Consensus reached for ${ctx.destination} — total score ${winner.totalScore}/100. ` +
      `Group satisfaction ${winner.groupSatisfactionPct}%. ` +
      `All members clear the 70% fairness floor (lowest: ${lowest}%). The plan is locked.`
    );
  }

  if (winner) {
    const below = winner.memberSatisfaction.filter(m => m.satisfactionPct < 70);
    return (
      `No plan cleared the fairness floor after ${ctx.tripDuration} nights of planning. ` +
      `Best score: ${winner.totalScore}/100. ` +
      `${below.length} member(s) below 70%: ${below.map(m => m.memberName).join(', ')}. ` +
      `Admin decision needed — organiser can approve or request changes.`
    );
  }

  return `Planning complete for ${ctx.destination}. Review the generated plan.`;
}
