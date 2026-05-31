/**
 * Unit tests for the scoring engine.
 *
 * Verifies:
 *  1. Fairness score is always in [0, 100]
 *  2. Satisfaction hand-calculation matches scoreMemberSatisfaction output
 *  3. budgetHardFail is true when over budget, and totalScore is forced to 0
 *  4. Consensus never returns an over-budget plan as winner
 */

import {
  scoreMemberSatisfaction,
  scoreItineraryCandidate,
} from '../lib/planning/scoring';
import { runConsensus } from '../lib/planning/consensus';
import type { MemberPreferenceSnapshot } from '../lib/planning/schemas';
import type { ActivityCandidate, Meal } from '../lib/planning/schemas';
import type { ItineraryCandidate } from '../lib/planning/scoring';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMember(
  id: string,
  name: string,
  mustHave: string[],
  niceToHave: string[],
): MemberPreferenceSnapshot {
  return {
    memberId: id,
    name,
    scores: {
      activities: { hiking: 50, nightlife: 50, museums: 50, beaches: 50, adventure: 50 },
      food: { streetFood: 50, fineDining: 50, localCuisine: 50, dietary: {}, alcohol: 50 },
      logistics: {
        flightComfort: 50, accommodationType: {}, pace: 50,
        budgetSplit: 50, transport: {}, budgetConsciousness: 50,
      },
      constraints: { hardBudgetCap: 20, mobility: 10, schedule: 10, visa: 10 },
    },
    priorities: {
      mustHave,
      niceToHave,
      neutral: [],
      avoid: [],
    },
    constraints: {
      dietaryRestrictions: [],
      alcoholPreference: 'yes',
    },
  };
}

function makeActivity(category: ActivityCandidate['category'], costPP = 20): ActivityCandidate {
  return {
    name: `${category} activity`,
    category,
    description: 'desc',
    groupUtilityScore: 70,
    estimatedCostPerPersonUsd: costPP,
    durationHours: 2,
  };
}

function makeCandidate(
  activities: ActivityCandidate[],
  totalCostPerPersonUsd: number,
  meals: Meal[] = [],
): ItineraryCandidate {
  return {
    activities,
    meals,
    totalCostPerPersonUsd,
    totalActivityHours: activities.reduce((s, a) => s + a.durationHours, 0),
    distinctCategories: new Set(activities.map(a => a.category)).size,
  };
}

// ---------------------------------------------------------------------------
// 1. Satisfaction hand-calculation
// ---------------------------------------------------------------------------

describe('scoreMemberSatisfaction', () => {
  it('returns 100 when member has no scoreable prefs', () => {
    const member = makeMember('m1', 'Alice', [], []);
    const result = scoreMemberSatisfaction(member, [], []);
    expect(result.satisfactionPct).toBe(100);
  });

  it('excludes logistics labels (Relaxed Pace, Budget-Conscious, etc.) from denominator', () => {
    // Member has only non-scoreable labels — should be treated as no scoreable prefs → 100%
    const member = makeMember('m1', 'Alice', ['Relaxed Pace', 'Budget-Conscious'], ['Flight Comfort']);
    const result = scoreMemberSatisfaction(member, [], []);
    expect(result.satisfactionPct).toBe(100);
  });

  it('hand-calc: 1 mustHave (Beaches) fulfilled by beaches activity = 100%', () => {
    const member = makeMember('m1', 'Alice', ['Beaches'], []);
    const activities = [makeActivity('beaches')];
    const result = scoreMemberSatisfaction(member, activities);
    // denominator = 1 (Beaches is scoreable), fulfilled = 1 → 100%
    expect(result.satisfactionPct).toBe(100);
    expect(result.mustHaveFulfilled).toContain('Beaches');
    expect(result.unmetMustHave).toHaveLength(0);
  });

  it('hand-calc: 1 mustHave (Beaches) + 1 niceToHave (Museums / Culture), only beaches activity → 50%', () => {
    const member = makeMember('m1', 'Alice', ['Beaches'], ['Museums / Culture']);
    const activities = [makeActivity('beaches')];
    const result = scoreMemberSatisfaction(member, activities);
    // denominator = 2, fulfilled = 1 → 50%
    expect(result.satisfactionPct).toBe(50);
    expect(result.mustHaveFulfilled).toContain('Beaches');
    expect(result.niceToHaveFulfilled).toHaveLength(0);
  });

  it('hand-calc: food preference "Local Cuisine" fulfilled by any meal → included in numerator', () => {
    const member = makeMember('m1', 'Alice', ['Beaches'], ['Local Cuisine']);
    const activities = [makeActivity('beaches')];
    const meal: Meal = {
      day: 1, type: 'dinner', venue: 'Local Trattoria', cuisineType: 'Italian',
      estimatedCostPerPersonUsd: 20,
      dietaryCompatibility: { vegetarian: true, vegan: false, glutenFree: false, halal: false, kosher: false, nutFree: false },
      alcoholServed: true,
    };
    const result = scoreMemberSatisfaction(member, activities, [meal]);
    // denominator = 2, fulfilled = Beaches + Local Cuisine = 2 → 100%
    expect(result.satisfactionPct).toBe(100);
    expect(result.niceToHaveFulfilled).toContain('Local Cuisine');
  });

  it('hand-calc: "Street Food" matched by street food meal venue', () => {
    const member = makeMember('m1', 'Bob', ['Street Food'], []);
    const meal: Meal = {
      day: 1, type: 'lunch', venue: 'Night market street stall', cuisineType: 'Street food',
      estimatedCostPerPersonUsd: 10,
      dietaryCompatibility: { vegetarian: false, vegan: false, glutenFree: false, halal: true, kosher: false, nutFree: false },
      alcoholServed: false,
    };
    const result = scoreMemberSatisfaction(member, [], [meal]);
    expect(result.satisfactionPct).toBe(100);
    expect(result.mustHaveFulfilled).toContain('Street Food');
  });
});

// ---------------------------------------------------------------------------
// 2. Fairness score always in [0, 100]
// ---------------------------------------------------------------------------

describe('scoreFairness via scoreItineraryCandidate', () => {
  const candidates_5050 = makeCandidate([makeActivity('beaches'), makeActivity('museums')], 200);

  it('is 0-100 for a single member (trivially fair)', () => {
    const members = [makeMember('m1', 'Alice', ['Beaches'], [])];
    const sc = scoreItineraryCandidate(candidates_5050, members, 1000, 3);
    expect(sc.dimensions.fairness.raw).toBeGreaterThanOrEqual(0);
    expect(sc.dimensions.fairness.raw).toBeLessThanOrEqual(100);
  });

  it('is 0-100 for two members with wildly different satisfaction', () => {
    const members = [
      makeMember('m1', 'Alice', ['Beaches', 'Nightlife', 'Adventure Sports'], []),
      makeMember('m2', 'Bob',   ['Museums / Culture'], []),
    ];
    // Only museums activity — Alice gets 0%, Bob gets 100%
    const candidate = makeCandidate([makeActivity('museums')], 100);
    const sc = scoreItineraryCandidate(candidate, members, 1000, 3);
    expect(sc.dimensions.fairness.raw).toBeGreaterThanOrEqual(0);
    expect(sc.dimensions.fairness.raw).toBeLessThanOrEqual(100);
  });

  it('is 0-100 across many random-ish member combinations', () => {
    const allLabels = ['Beaches', 'Nightlife', 'Museums / Culture', 'Hiking / Outdoors', 'Adventure Sports'];
    for (let i = 0; i < 20; i++) {
      const members = Array.from({ length: 3 + (i % 4) }, (_, j) => {
        const mh = allLabels.slice(j % 3, j % 3 + 1);
        const nth = allLabels.slice((j + 2) % 5, (j + 2) % 5 + 1);
        return makeMember(`m${j}`, `Member${j}`, mh, nth);
      });
      const activities = [makeActivity('beaches'), makeActivity('museums'), makeActivity('hiking')];
      const candidate = makeCandidate(activities, 300);
      const sc = scoreItineraryCandidate(candidate, members, 2000, 3);
      expect(sc.dimensions.fairness.raw).toBeGreaterThanOrEqual(0);
      expect(sc.dimensions.fairness.raw).toBeLessThanOrEqual(100);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Budget hard fail
// ---------------------------------------------------------------------------

describe('scoreItineraryCandidate budget enforcement', () => {
  const members = [makeMember('m1', 'Alice', ['Beaches'], [])];
  const activities = [makeActivity('beaches', 10)];

  it('budgetHardFail=false and totalScore>0 when within budget', () => {
    const candidate = makeCandidate(activities, 80);   // $80/person, budget $100/person total
    const sc = scoreItineraryCandidate(candidate, members, 100 /* total group, 1 member */, 3);
    expect(sc.budgetHardFail).toBe(false);
    expect(sc.totalScore).toBeGreaterThan(0);
  });

  it('budgetHardFail=true and totalScore=0 when over budget', () => {
    const candidate = makeCandidate(activities, 200);  // $200/person, budget $100/person total
    const sc = scoreItineraryCandidate(candidate, members, 100, 3);
    expect(sc.budgetHardFail).toBe(true);
    expect(sc.totalScore).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Consensus never returns an over-budget plan as winner
// ---------------------------------------------------------------------------

describe('runConsensus budget gate', () => {
  const members = [makeMember('m1', 'Alice', ['Beaches'], [])];
  const activities = [makeActivity('beaches', 10)];

  it('returns winner=null (ADMIN_OVERRIDE_REQUIRED) when ALL candidates are over budget', () => {
    const overBudgetCandidate = makeCandidate(activities, 500); // way over $100 budget
    const result = runConsensus({
      candidates: [overBudgetCandidate],
      members,
      lockedBudgetUsd: 100, // $100 total for 1 person = $100/person
      tripDuration: 3,
    });
    expect(result.winner).toBeNull();
    expect(result.adminOverrideFlag).toBe(true);
    expect(result.bestAvailable).not.toBeNull(); // best candidate still surfaced for admin
  });

  it('picks the within-budget candidate over the over-budget one', () => {
    const withinBudget = makeCandidate(activities, 80);
    const overBudget   = makeCandidate(activities, 500);
    const result = runConsensus({
      candidates: [withinBudget, overBudget],
      members,
      lockedBudgetUsd: 100,
      tripDuration: 3,
    });
    expect(result.winner).not.toBeNull();
    expect(result.winner!.budgetHardFail).toBe(false);
    expect(result.winner!.candidate.totalCostPerPersonUsd).toBe(80);
  });
});
