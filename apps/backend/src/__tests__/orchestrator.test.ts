/**
 * Orchestrator integration test — runs all 5 agents against a synthetic seed
 * group context and prints the full proposals.
 *
 * Uses real Claude API calls (requires ANTHROPIC_API_KEY in .env).
 * Run with: npx jest orchestrator --testTimeout=120000
 */
import 'dotenv/config';
import { runOrchestrator } from '../lib/planning/orchestrator';
import type { PlanningContext, MemberPreferenceSnapshot } from '../lib/planning/schemas';

// Long timeout — 5 parallel Claude calls, each up to ~10s
jest.setTimeout(120_000);

// ---------------------------------------------------------------------------
// Synthetic seed context — Paris group, 4 members with varied preferences
// ---------------------------------------------------------------------------

const MEMBERS: MemberPreferenceSnapshot[] = [
  {
    memberId: 'seed-1',
    name: 'Kailash',
    scores: {
      activities: { hiking: 60, nightlife: 50, museums: 50, beaches: 50, adventure: 50 },
      food: {
        streetFood: 50, fineDining: 50, localCuisine: 50,
        dietary: {}, alcohol: 80,
      },
      logistics: {
        flightComfort: 50, accommodationType: {}, pace: 50,
        budgetSplit: 50, transport: {}, budgetConsciousness: 50,
      },
      constraints: { hardBudgetCap: 20, mobility: 10, schedule: 10, visa: 10 },
    },
    priorities: {
      mustHave:   [],
      niceToHave: ['Hiking / Outdoors'],
      neutral:    ['Beaches', 'Museums / Culture', 'Nightlife', 'Street Food', 'Fine Dining', 'Local Cuisine'],
      avoid:      [],
    },
    constraints: {
      dietaryRestrictions: [],
      alcoholPreference:   'yes',
      mobilityLimitations: '',
      scheduleRestrictions: '',
      visaRestrictions:    '',
      mustAvoidActivities: '',
    },
    chatNuance: 'Enjoys balanced trips — mix of culture and relaxation.',
  },
  {
    memberId: 'seed-2',
    name: 'Priya',
    scores: {
      activities: { hiking: 30, nightlife: 20, museums: 90, beaches: 60, adventure: 20 },
      food: {
        streetFood: 70, fineDining: 40, localCuisine: 90,
        dietary: { vegetarian: 100 }, alcohol: 10,
      },
      logistics: {
        flightComfort: 80, accommodationType: {}, pace: 30,
        budgetSplit: 50, transport: {}, budgetConsciousness: 60,
      },
      constraints: { hardBudgetCap: 20, mobility: 10, schedule: 10, visa: 10 },
    },
    priorities: {
      mustHave:   ['Museums / Culture', 'Local Cuisine'],
      niceToHave: ['Beaches', 'Street Food', 'Flight Comfort', 'Budget-Conscious'],
      neutral:    ['Relaxed Pace'],
      avoid:      ['Hiking / Outdoors', 'Nightlife', 'Adventure Sports', 'Fine Dining'],
    },
    constraints: {
      dietaryRestrictions: ['vegetarian'],
      alcoholPreference:   'no',
      mobilityLimitations: '',
      scheduleRestrictions: '',
      visaRestrictions:    '',
      mustAvoidActivities: 'extreme sports',
    },
    chatNuance: 'Strong interest in art museums and local markets. Prefers a relaxed pace with time to wander.',
  },
  {
    memberId: 'seed-3',
    name: 'Jordan',
    scores: {
      activities: { hiking: 80, nightlife: 70, museums: 50, beaches: 40, adventure: 90 },
      food: {
        streetFood: 80, fineDining: 60, localCuisine: 70,
        dietary: {}, alcohol: 70,
      },
      logistics: {
        flightComfort: 40, accommodationType: {}, pace: 80,
        budgetSplit: 50, transport: {}, budgetConsciousness: 30,
      },
      constraints: { hardBudgetCap: 20, mobility: 10, schedule: 10, visa: 10 },
    },
    priorities: {
      mustHave:   ['Adventure Sports', 'Hiking / Outdoors', 'Packed Itinerary'],
      niceToHave: ['Nightlife', 'Street Food', 'Fine Dining', 'Local Cuisine'],
      neutral:    ['Museums / Culture'],
      avoid:      ['Beaches'],
    },
    constraints: {
      dietaryRestrictions: [],
      alcoholPreference:   'yes',
      mobilityLimitations: '',
      scheduleRestrictions: '',
      visaRestrictions:    '',
      mustAvoidActivities: '',
    },
    chatNuance: 'Loves action-packed days. Keen to try local street food and upscale dining on alternating nights.',
  },
  {
    memberId: 'seed-4',
    name: 'Sam',
    scores: {
      activities: { hiking: 40, nightlife: 60, museums: 70, beaches: 80, adventure: 30 },
      food: {
        streetFood: 60, fineDining: 80, localCuisine: 60,
        dietary: { glutenFree: 100 }, alcohol: 50,
      },
      logistics: {
        flightComfort: 70, accommodationType: {}, pace: 50,
        budgetSplit: 50, transport: {}, budgetConsciousness: 40,
      },
      constraints: { hardBudgetCap: 20, mobility: 10, schedule: 10, visa: 10 },
    },
    priorities: {
      mustHave:   ['Beaches'],
      niceToHave: ['Fine Dining', 'Museums / Culture', 'Nightlife', 'Flight Comfort'],
      neutral:    ['Street Food', 'Local Cuisine'],
      avoid:      ['Hiking / Outdoors', 'Adventure Sports'],
    },
    constraints: {
      dietaryRestrictions: ['glutenFree'],
      alcoholPreference:   'sometimes',
      mobilityLimitations: '',
      scheduleRestrictions: '',
      visaRestrictions:    '',
      mustAvoidActivities: '',
    },
    chatNuance: 'Gluten-free is a hard requirement (celiac). Enjoys upscale experiences but comfortable mixing in casual spots.',
  },
];

const CONTEXT: PlanningContext = {
  destination:  'Paris, France',
  tripDuration: 6,
  tripDays:     7,
  startDate:    '2025-09-01',
  endDate:      '2025-09-07',
  groupSize:    4,
  lockedBudget: 8000,   // $2000/person total
  members:      MEMBERS,
};

// ---------------------------------------------------------------------------
// Helper — pretty print a section
// ---------------------------------------------------------------------------

function section(title: string, data: unknown): void {
  console.log('\n' + '═'.repeat(60));
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
  console.log(JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe('Orchestrator — Paris seed group', () => {
  let result: Awaited<ReturnType<typeof runOrchestrator>>;

  beforeAll(async () => {
    result = await runOrchestrator(CONTEXT);
  });

  it('completes within 90 seconds', () => {
    expect(result.durationMs).toBeLessThan(90_000);
    console.log(`\nTotal orchestrator time: ${result.durationMs}ms`);
  });

  it('activity agent returns ranked candidates', () => {
    section('ACTIVITY PROPOSAL', result.activity);
    expect(result.activity.agent).toBe('activity');
    expect(result.activity.candidates.length).toBeGreaterThanOrEqual(3);
    // All candidates must have a valid utility score
    for (const c of result.activity.candidates) {
      expect(c.groupUtilityScore).toBeGreaterThanOrEqual(0);
      expect(c.groupUtilityScore).toBeLessThanOrEqual(100);
      expect(c.estimatedCostPerPersonUsd).toBeGreaterThanOrEqual(0);
      expect(c.durationHours).toBeGreaterThan(0);
    }
    // First candidate should have a high relative score (not the worst)
    const scores = result.activity.candidates.map(c => c.groupUtilityScore);
    const maxScore = Math.max(...scores);
    expect(scores[0]).toBeGreaterThanOrEqual(maxScore * 0.7); // top candidate within 30% of best
  });

  it('food agent respects all dietary constraints', () => {
    section('FOOD PROPOSAL', result.food);
    expect(result.food.agent).toBe('food');
    // All dietaryFlags must be respected
    const unrespected = result.food.dietaryFlags.filter(f => !f.respected);
    expect(unrespected).toHaveLength(0);
    // Must have meals for the full trip
    expect(result.food.mealPlan.length).toBeGreaterThanOrEqual(ctx().tripDuration * 2);
  });

  it('accommodation agent returns exactly 3 options', () => {
    section('ACCOMMODATION PROPOSAL', result.accommodation);
    expect(result.accommodation.agent).toBe('accommodation');
    expect(result.accommodation.options).toHaveLength(3);
    expect(result.accommodation.recommended).toBeGreaterThanOrEqual(0);
    expect(result.accommodation.recommended).toBeLessThanOrEqual(2);
  });

  it('transportation agent returns legs and a local summary', () => {
    section('TRANSPORTATION PROPOSAL', result.transportation);
    expect(result.transportation.agent).toBe('transportation');
    expect(result.transportation.legs.length).toBeGreaterThanOrEqual(2);
    expect(result.transportation.localTransportSummary.length).toBeGreaterThan(0);
  });

  it('budget agent reconciles costs against locked budget', () => {
    section('BUDGET PROPOSAL', result.budget);
    expect(result.budget.agent).toBe('budget');
    expect(result.budget.lockedBudgetUsd).toBe(CONTEXT.lockedBudget);
    expect(typeof result.budget.surplus).toBe('number');
    expect(typeof result.budget.overrunFlag).toBe('boolean');
    if (result.budget.overrunFlag) {
      expect(result.budget.substitutions.length).toBeGreaterThan(0);
      console.log('\n⚠ Budget overrun — substitutions:', result.budget.substitutions);
    } else {
      console.log(`\n✓ Within budget. Surplus: $${result.budget.surplus}`);
    }
  });

  it('logistics stub is present', () => {
    section('LOGISTICS (stub)', result.logistics);
    expect(result.logistics.agent).toBe('logistics');
    expect(result.logistics.status).toBe('stub');
  });
});

function ctx(): PlanningContext { return CONTEXT; }
