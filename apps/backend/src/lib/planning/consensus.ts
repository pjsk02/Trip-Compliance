/**
 * Consensus Engine — selects the best itinerary from a set of scored candidates.
 *
 * Steps:
 *  (a) Pareto-filter to drop strictly-dominated options.
 *  (b) Pick the weighted-score maximiser among the Pareto-optimal set.
 *  (c) Enforce the Fairness Floor (min 70% satisfaction per member).
 *  (d) If nothing clears the floor, flag for admin override.
 */

import { paretoFilter, scoreItineraryCandidate, FAIRNESS_FLOOR_PCT } from './scoring';
import type { Scorecard, ItineraryCandidate } from './scoring';
import type { MemberPreferenceSnapshot } from './schemas';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConsensusInput {
  candidates:  ItineraryCandidate[];
  members:     MemberPreferenceSnapshot[];
  lockedBudgetUsd: number;
  tripDuration: number;  // nights
}

export type ConsensusStatus =
  | 'OK'                 // winner selected and passes all floors
  | 'FLOOR_WAIVED'       // winner selected but below fairness floor (best we have)
  | 'ADMIN_OVERRIDE_REQUIRED'; // no candidate passes; admin must decide

export interface ConsensusResult {
  status:           ConsensusStatus;
  winner:           Scorecard | null;
  allScorecards:    Scorecard[];
  paretoFrontier:   Scorecard[];
  adminOverrideFlag: boolean;
  /** Populated when adminOverrideFlag — best candidate even though it fails the floor. */
  bestAvailable:    Scorecard | null;
  summary:          string;
}

// ---------------------------------------------------------------------------
// Main consensus function
// ---------------------------------------------------------------------------

export function runConsensus(input: ConsensusInput): ConsensusResult {
  const { candidates, members, lockedBudgetUsd, tripDuration } = input;

  if (candidates.length === 0) {
    return {
      status: 'ADMIN_OVERRIDE_REQUIRED',
      winner: null,
      allScorecards: [],
      paretoFrontier: [],
      adminOverrideFlag: true,
      bestAvailable: null,
      summary: 'No candidates were generated to evaluate.',
    };
  }

  // Score every candidate
  const allScorecards = candidates.map(c =>
    scoreItineraryCandidate(c, members, lockedBudgetUsd, tripDuration),
  );

  // (a) Pareto filter
  const paretoFrontier = paretoFilter(allScorecards);

  // (b) Pick highest total score among Pareto-optimal candidates
  const ranked = [...paretoFrontier].sort((a, b) => b.totalScore - a.totalScore);
  const topCandidate = ranked[0];

  if (!topCandidate) {
    return {
      status: 'ADMIN_OVERRIDE_REQUIRED',
      winner: null,
      allScorecards,
      paretoFrontier,
      adminOverrideFlag: true,
      bestAvailable: allScorecards.sort((a, b) => b.totalScore - a.totalScore)[0] ?? null,
      summary: 'Pareto filter eliminated all candidates. Admin override required.',
    };
  }

  // (c) Enforce fairness floor AND budget hard constraint.
  // A candidate with budgetHardFail=true must never be returned as winner —
  // the PRD mandates admin override for any over-budget plan.
  if (topCandidate.fairnessFloorMet && !topCandidate.budgetHardFail) {
    return {
      status: 'OK',
      winner: topCandidate,
      allScorecards,
      paretoFrontier,
      adminOverrideFlag: false,
      bestAvailable: null,
      summary: buildSummary(topCandidate, 'OK'),
    };
  }

  // Top Pareto candidate fails the floor or budget — check if any Pareto candidate passes both
  const floorPassing = ranked.filter(sc => sc.fairnessFloorMet && !sc.budgetHardFail);
  if (floorPassing.length > 0) {
    const winner = floorPassing[0]!;
    return {
      status: 'OK',
      winner,
      allScorecards,
      paretoFrontier,
      adminOverrideFlag: false,
      bestAvailable: null,
      summary: buildSummary(winner, 'OK'),
    };
  }

  // (d) No candidate clears the floor — flag for admin override
  // Still return the best-scoring candidate as bestAvailable so the admin
  // can approve it with full information.
  const globalBest = allScorecards.sort((a, b) => b.totalScore - a.totalScore)[0] ?? null;

  return {
    status: 'ADMIN_OVERRIDE_REQUIRED',
    winner: null,
    allScorecards,
    paretoFrontier,
    adminOverrideFlag: true,
    bestAvailable: globalBest,
    summary: buildSummary(globalBest, 'ADMIN_OVERRIDE_REQUIRED'),
  };
}

// ---------------------------------------------------------------------------
// Helper — natural-language summary
// ---------------------------------------------------------------------------

function buildSummary(sc: Scorecard | null, status: ConsensusStatus): string {
  if (!sc) return 'No viable itinerary found. Admin review required.';

  const dim = sc.dimensions;
  const memberLines = sc.memberSatisfaction
    .map(m => `  • ${m.memberName}: ${m.satisfactionPct}% satisfaction (unmet must-haves: ${m.unmetMustHave.join(', ') || 'none'})`)
    .join('\n');

  const header =
    status === 'OK'
      ? `Consensus reached — total score ${sc.totalScore}/100.`
      : status === 'FLOOR_WAIVED'
      ? `Best available itinerary selected (floor waived) — score ${sc.totalScore}/100.`
      : `No itinerary meets the ${FAIRNESS_FLOOR_PCT}% fairness floor. Admin override required. Best available score: ${sc.totalScore}/100.`;

  return [
    header,
    `  User satisfaction: ${dim.userSatisfaction.raw}% (group avg)`,
    `  Fairness score: ${dim.fairness.raw}/100`,
    `  Budget compliance: ${dim.budgetCompliance.raw}/100${sc.budgetHardFail ? ' [OVER BUDGET]' : ''}`,
    `  Feasibility: ${dim.feasibility.raw}/100`,
    `  Diversity: ${dim.diversity.raw}/100`,
    `Per-member satisfaction:`,
    memberLines,
    sc.adminOverrideFlag
      ? `\nLow-satisfaction members: ${sc.memberSatisfaction.filter(m => m.satisfactionPct < FAIRNESS_FLOOR_PCT).map(m => m.memberName).join(', ')}`
      : '',
  ].filter(Boolean).join('\n');
}
