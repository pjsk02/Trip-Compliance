/**
 * Scoring engine — grades any candidate itinerary on 5 PRD dimensions.
 *
 * MVP weights:
 *   User Satisfaction  40%
 *   Fairness           25%
 *   Budget Compliance  20%  (hard zero if over budget)
 *   Feasibility        10%
 *   Diversity           5%
 *
 * User Satisfaction = % of each member's Must Have + Nice to Have preferences
 * fulfilled by the itinerary, averaged across members (keyed to User via memberId).
 * Fairness penalises low-satisfaction outliers (std-dev based penalty).
 */

import type { MemberPreferenceSnapshot } from './schemas';
import type { ActivityCandidate, Meal } from './schemas';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ItineraryCandidate {
  /** Activities selected for this itinerary (subset of ActivityProposal.candidates). */
  activities: ActivityCandidate[];
  /** Meals from the food proposal — used for satisfaction scoring of food preferences. */
  meals?: Meal[];
  totalCostPerPersonUsd: number;
  /** Rough duration accounting — hours of activities scheduled. */
  totalActivityHours: number;
  /** How many distinct activity categories appear. */
  distinctCategories: number;
}

export interface MemberSatisfaction {
  memberId:         string;
  memberName:       string;
  satisfactionPct:  number;   // 0-100, % of Must Have + Nice to Have fulfilled
  mustHaveFulfilled: string[];
  niceToHaveFulfilled: string[];
  unmetMustHave:    string[];
}

export interface ScorecardDimension {
  raw:     number;   // 0-100 before weight
  weight:  number;   // 0-1
  weighted: number;  // raw * weight
}

export interface Scorecard {
  candidate:          ItineraryCandidate;
  memberSatisfaction: MemberSatisfaction[];
  groupSatisfactionPct: number;            // mean across members
  dimensions: {
    userSatisfaction:  ScorecardDimension;
    fairness:          ScorecardDimension;
    budgetCompliance:  ScorecardDimension;
    feasibility:       ScorecardDimension;
    diversity:         ScorecardDimension;
  };
  totalScore:         number;   // 0-100 weighted sum
  budgetHardFail:     boolean;  // true → score is 0 regardless
  fairnessFloorMet:   boolean;  // all members ≥ 70%
  adminOverrideFlag?: boolean;
  lowestMemberSatisfaction: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WEIGHTS = {
  userSatisfaction: 0.40,
  fairness:         0.25,
  budgetCompliance: 0.20,
  feasibility:      0.10,
  diversity:        0.05,
};

const FAIRNESS_FLOOR_PCT = 70;   // min satisfaction per member

// ---------------------------------------------------------------------------
// Category → preference label mapping
// Activities carry a `category` field that maps to preference labels used
// in derivePriorities().
// ---------------------------------------------------------------------------

const CATEGORY_TO_LABELS: Record<string, string[]> = {
  hiking:    ['Hiking / Outdoors'],
  nightlife: ['Nightlife'],
  museums:   ['Museums / Culture'],
  beaches:   ['Beaches'],
  adventure: ['Adventure Sports'],
  mixed:     ['Hiking / Outdoors', 'Museums / Culture'],  // conservative: credit both
};

// Labels that derivePriorities() can produce but are NOT scoreable from
// itinerary content (they describe planning style, not item categories).
// Exclude them from the denominator so they don't inflate it.
const NON_SCOREABLE_LABELS = new Set([
  'Relaxed Pace', 'Packed Itinerary', 'Flight Comfort', 'Budget-Conscious',
]);

/** Return all preference labels that a given activity category satisfies. */
function labelsForCategory(category: string): string[] {
  return CATEGORY_TO_LABELS[category] ?? [];
}

/** Return all preference labels that a meal satisfies. */
function labelsForMeal(meal: Meal): string[] {
  const labels: string[] = [];
  const cuisine = meal.cuisineType.toLowerCase();
  const venue   = meal.venue.toLowerCase();
  if (cuisine.includes('street') || venue.includes('street')) labels.push('Street Food');
  if (venue.includes('fine') || cuisine.includes('fine'))     labels.push('Fine Dining');
  // Local cuisine is satisfied by any restaurant that is not a chain/tourist spot
  labels.push('Local Cuisine');
  return labels;
}

// ---------------------------------------------------------------------------
// Per-member satisfaction scoring
// ---------------------------------------------------------------------------

export function scoreMemberSatisfaction(
  member: MemberPreferenceSnapshot,
  activities: ActivityCandidate[],
  meals: Meal[] = [],
): MemberSatisfaction {
  const { mustHave, niceToHave } = member.priorities;

  // Only score labels that can actually be evaluated from the itinerary content.
  const scoreableMustHave   = mustHave.filter(p => !NON_SCOREABLE_LABELS.has(p));
  const scoreableNiceToHave = niceToHave.filter(p => !NON_SCOREABLE_LABELS.has(p));
  const total = scoreableMustHave.length + scoreableNiceToHave.length;

  if (total === 0) {
    // No scoreable Must Have / Nice to Have preferences — trivially satisfied
    return {
      memberId:  member.memberId,
      memberName: member.name,
      satisfactionPct: 100,
      mustHaveFulfilled: [],
      niceToHaveFulfilled: [],
      unmetMustHave: [],
    };
  }

  // Collect all preference labels that the selected activities and meals cover
  const fulfilledLabels = new Set<string>();
  for (const act of activities) {
    for (const label of labelsForCategory(act.category)) {
      fulfilledLabels.add(label);
    }
  }
  for (const meal of meals) {
    for (const label of labelsForMeal(meal)) {
      fulfilledLabels.add(label);
    }
  }

  const mustHaveFulfilled   = scoreableMustHave.filter(p => fulfilledLabels.has(p));
  const niceToHaveFulfilled = scoreableNiceToHave.filter(p => fulfilledLabels.has(p));
  const unmetMustHave       = scoreableMustHave.filter(p => !fulfilledLabels.has(p));

  const fulfilled = mustHaveFulfilled.length + niceToHaveFulfilled.length;
  const satisfactionPct = Math.round((fulfilled / total) * 100);

  return {
    memberId:  member.memberId,
    memberName: member.name,
    satisfactionPct,
    mustHaveFulfilled,
    niceToHaveFulfilled,
    unmetMustHave,
  };
}

// ---------------------------------------------------------------------------
// Dimension scorers
// ---------------------------------------------------------------------------

function scoreUserSatisfaction(memberScores: MemberSatisfaction[]): number {
  if (memberScores.length === 0) return 50;
  const mean = memberScores.reduce((s, m) => s + m.satisfactionPct, 0) / memberScores.length;
  return Math.round(mean);
}

/** Fairness: 100 minus a penalty proportional to the standard deviation of
 *  member satisfaction scores (high spread = unfair). Also applies an
 *  extra penalty when any member is below the fairness floor. */
function scoreFairness(memberScores: MemberSatisfaction[]): number {
  if (memberScores.length <= 1) return 100;

  const pcts = memberScores.map(m => m.satisfactionPct);
  const mean = pcts.reduce((s, v) => s + v, 0) / pcts.length;
  const variance = pcts.reduce((s, v) => s + (v - mean) ** 2, 0) / pcts.length;
  const stdDev = Math.sqrt(variance);

  // Each point of stdDev reduces fairness by 1.5 points (capped at 60 penalty)
  let penalty = Math.min(stdDev * 1.5, 60);

  // Extra 15-point penalty if any member is below the floor
  const belowFloor = pcts.filter(p => p < FAIRNESS_FLOOR_PCT);
  if (belowFloor.length > 0) {
    penalty += 15 * (belowFloor.length / pcts.length);
  }

  return Math.max(0, Math.round(100 - penalty));
}

/** Budget compliance: hard zero if over; 100 if within; grades remaining buffer. */
function scoreBudgetCompliance(
  totalCostPerPersonUsd: number,
  lockedBudgetPerPersonUsd: number,
): { score: number; hardFail: boolean } {
  if (totalCostPerPersonUsd > lockedBudgetPerPersonUsd) {
    return { score: 0, hardFail: true };
  }
  // Score 60-100 based on how well we use the budget (neither over nor wasteful)
  const utilisation = totalCostPerPersonUsd / lockedBudgetPerPersonUsd;
  // Peak score at 90-95% utilisation
  const score = utilisation >= 0.90
    ? 100
    : utilisation >= 0.70
    ? Math.round(60 + (utilisation - 0.70) * 200)   // 60→100 over 70-90%
    : Math.round(utilisation * 85);                  // proportional below 70%
  return { score, hardFail: false };
}

/** Feasibility: based on whether the total activity hours fit comfortably
 *  within the trip duration (rough guide: 8 active hours/day). */
function scoreFeasibility(totalActivityHours: number, tripDuration: number): number {
  const availableHours = tripDuration * 8;
  if (totalActivityHours <= availableHours * 0.80) return 100;
  if (totalActivityHours <= availableHours)         return 80;
  if (totalActivityHours <= availableHours * 1.15)  return 50;
  return 20;  // severely overpacked
}

/** Diversity: 0-5 distinct activity categories → score 0-100. */
function scoreDiversity(distinctCategories: number): number {
  return Math.min(100, Math.round((distinctCategories / 5) * 100));
}

// ---------------------------------------------------------------------------
// Main scorer
// ---------------------------------------------------------------------------

export function scoreItineraryCandidate(
  candidate: ItineraryCandidate,
  members: MemberPreferenceSnapshot[],
  lockedBudgetUsd: number,
  tripDuration: number,
): Scorecard {
  const groupSize = members.length || 1;
  const lockedPerPerson = lockedBudgetUsd / groupSize;

  const memberSatisfaction = members.map(m =>
    scoreMemberSatisfaction(m, candidate.activities),
  );

  const groupSatisfactionPct = scoreUserSatisfaction(memberSatisfaction);
  const fairnessScore        = scoreFairness(memberSatisfaction);
  const { score: budgetScore, hardFail } = scoreBudgetCompliance(
    candidate.totalCostPerPersonUsd,
    lockedPerPerson,
  );
  const feasibilityScore = scoreFeasibility(candidate.totalActivityHours, tripDuration);
  const diversityScore   = scoreDiversity(candidate.distinctCategories);

  const dims = {
    userSatisfaction: {
      raw: groupSatisfactionPct,
      weight: WEIGHTS.userSatisfaction,
      weighted: Math.round(groupSatisfactionPct * WEIGHTS.userSatisfaction),
    },
    fairness: {
      raw: fairnessScore,
      weight: WEIGHTS.fairness,
      weighted: Math.round(fairnessScore * WEIGHTS.fairness),
    },
    budgetCompliance: {
      raw: budgetScore,
      weight: WEIGHTS.budgetCompliance,
      weighted: Math.round(budgetScore * WEIGHTS.budgetCompliance),
    },
    feasibility: {
      raw: feasibilityScore,
      weight: WEIGHTS.feasibility,
      weighted: Math.round(feasibilityScore * WEIGHTS.feasibility),
    },
    diversity: {
      raw: diversityScore,
      weight: WEIGHTS.diversity,
      weighted: Math.round(diversityScore * WEIGHTS.diversity),
    },
  };

  const totalScore = hardFail
    ? 0
    : Object.values(dims).reduce((s, d) => s + d.weighted, 0);

  const lowestMemberSatisfaction = memberSatisfaction.length > 0
    ? Math.min(...memberSatisfaction.map(m => m.satisfactionPct))
    : 100;

  const fairnessFloorMet = lowestMemberSatisfaction >= FAIRNESS_FLOOR_PCT;

  return {
    candidate,
    memberSatisfaction,
    groupSatisfactionPct,
    dimensions: dims,
    totalScore,
    budgetHardFail: hardFail,
    fairnessFloorMet,
    lowestMemberSatisfaction,
  };
}

// ---------------------------------------------------------------------------
// Pareto filter — remove candidates strictly dominated by another
// ---------------------------------------------------------------------------

/** A dominates B if A is ≥ B on every dimension AND strictly > on at least one. */
function dominates(a: Scorecard, b: Scorecard): boolean {
  const dims: Array<keyof Scorecard['dimensions']> = [
    'userSatisfaction', 'fairness', 'budgetCompliance', 'feasibility', 'diversity',
  ];
  let strictlyBetter = false;
  for (const dim of dims) {
    const aRaw = a.dimensions[dim].raw;
    const bRaw = b.dimensions[dim].raw;
    if (aRaw < bRaw) return false;
    if (aRaw > bRaw) strictlyBetter = true;
  }
  return strictlyBetter;
}

export function paretoFilter(scorecards: Scorecard[]): Scorecard[] {
  return scorecards.filter(sc =>
    !scorecards.some(other => other !== sc && dominates(other, sc)),
  );
}

export { FAIRNESS_FLOOR_PCT };
