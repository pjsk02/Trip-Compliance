/**
 * Evaluation dataset fixtures — 5 group archetypes for the evaluation harness.
 *
 * Each archetype is a self-contained PlanningContext that exercises a
 * different planning challenge. No database required — pure in-memory fixtures.
 */

import type { PlanningContext, MemberPreferenceSnapshot } from '../lib/planning/schemas';

// ---------------------------------------------------------------------------
// Helper — build a member snapshot from readable parameters
// ---------------------------------------------------------------------------

function member(
  id: string,
  name: string,
  activities: { hiking: number; nightlife: number; museums: number; beaches: number; adventure: number },
  food: { streetFood: number; fineDining: number; localCuisine: number },
  logistics: { pace: number; flightComfort: number; budgetConsciousness: number },
  constraints: {
    dietaryRestrictions?: string[];
    alcoholPreference?: 'yes' | 'no' | 'sometimes';
    hardBudgetCap?: number;
    mobilityLimitations?: string;
    mustAvoidActivities?: string;
  } = {},
): MemberPreferenceSnapshot {
  // Derive priorities from slider scores (same thresholds as derivePriorities)
  const items: Array<{ label: string; score: number }> = [
    { label: 'Hiking / Outdoors',   score: activities.hiking },
    { label: 'Nightlife',           score: activities.nightlife },
    { label: 'Museums / Culture',   score: activities.museums },
    { label: 'Beaches',             score: activities.beaches },
    { label: 'Adventure Sports',    score: activities.adventure },
    { label: 'Street Food',         score: food.streetFood },
    { label: 'Fine Dining',         score: food.fineDining },
    { label: 'Local Cuisine',       score: food.localCuisine },
  ];

  const mustHave:   string[] = [];
  const niceToHave: string[] = [];
  const neutral:    string[] = [];
  const avoid:      string[] = [];

  for (const { label, score } of items) {
    if (score >= 90)      mustHave.push(label);
    else if (score >= 60) niceToHave.push(label);
    else if (score >= 30) neutral.push(label);
    else                  avoid.push(label);
  }

  return {
    memberId: id,
    userId:   id,
    name,
    scores: {
      activities,
      food: {
        ...food,
        dietary: constraints.dietaryRestrictions
          ? Object.fromEntries(constraints.dietaryRestrictions.map(r => [r, 100]))
          : {},
        alcohol: constraints.alcoholPreference === 'no' ? 10
          : constraints.alcoholPreference === 'sometimes' ? 50 : 80,
      },
      logistics: {
        flightComfort:       logistics.flightComfort,
        accommodationType:   {},
        pace:                logistics.pace,
        budgetSplit:         50,
        transport:           {},
        budgetConsciousness: logistics.budgetConsciousness,
      },
      constraints: {
        hardBudgetCap: constraints.hardBudgetCap ? 80 : 20,
        mobility:      constraints.mobilityLimitations ? 60 : 10,
        schedule:      10,
        visa:          10,
      },
    },
    priorities: { mustHave, niceToHave, neutral, avoid },
    constraints: {
      dietaryRestrictions: constraints.dietaryRestrictions ?? [],
      alcoholPreference:   constraints.alcoholPreference ?? 'yes',
      hardBudgetCap:       constraints.hardBudgetCap,
      mobilityLimitations: constraints.mobilityLimitations,
      mustAvoidActivities: constraints.mustAvoidActivities,
    },
  };
}

// ---------------------------------------------------------------------------
// 1. Budget Travelers — tight $800 group budget, cost-conscious, hostel-OK
// ---------------------------------------------------------------------------

export const BUDGET_TRAVELERS: PlanningContext = {
  destination:  'Lisbon, Portugal',
  tripDuration: 3,
  tripDays:     4,
  startDate:    '2025-09-10',
  endDate:      '2025-09-13',
  groupSize:    3,
  lockedBudget: 800,  // $267/person total
  members: [
    member('bt1', 'Alex',
      { hiking: 60, nightlife: 70, museums: 50, beaches: 60, adventure: 40 },
      { streetFood: 90, fineDining: 10, localCuisine: 80 },
      { pace: 60, flightComfort: 40, budgetConsciousness: 90 },
    ),
    member('bt2', 'Sam',
      { hiking: 40, nightlife: 80, museums: 40, beaches: 70, adventure: 30 },
      { streetFood: 85, fineDining: 20, localCuisine: 70 },
      { pace: 50, flightComfort: 50, budgetConsciousness: 85 },
    ),
    member('bt3', 'Jordan',
      { hiking: 55, nightlife: 65, museums: 35, beaches: 65, adventure: 50 },
      { streetFood: 80, fineDining: 15, localCuisine: 75 },
      { pace: 70, flightComfort: 45, budgetConsciousness: 95 },
    ),
  ],
};

// ---------------------------------------------------------------------------
// 2. Luxury Travelers — generous $12,000 group budget, comfort-first
// ---------------------------------------------------------------------------

export const LUXURY_TRAVELERS: PlanningContext = {
  destination:  'Amalfi Coast, Italy',
  tripDuration: 5,
  tripDays:     6,
  startDate:    '2025-09-15',
  endDate:      '2025-09-20',
  groupSize:    2,
  lockedBudget: 12000, // $6,000/person
  members: [
    member('lt1', 'Victoria',
      { hiking: 30, nightlife: 60, museums: 80, beaches: 90, adventure: 20 },
      { streetFood: 20, fineDining: 95, localCuisine: 70 },
      { pace: 20, flightComfort: 95, budgetConsciousness: 10 },
    ),
    member('lt2', 'Marcus',
      { hiking: 40, nightlife: 70, museums: 65, beaches: 85, adventure: 30 },
      { streetFood: 30, fineDining: 90, localCuisine: 60 },
      { pace: 30, flightComfort: 90, budgetConsciousness: 15 },
    ),
  ],
};

// ---------------------------------------------------------------------------
// 3. Food-Focused Travelers — dietary diversity, cuisine-first priorities
// ---------------------------------------------------------------------------

export const FOOD_FOCUSED: PlanningContext = {
  destination:  'Tokyo, Japan',
  tripDuration: 4,
  tripDays:     5,
  startDate:    '2025-10-01',
  endDate:      '2025-10-05',
  groupSize:    4,
  lockedBudget: 6000, // $1,500/person
  members: [
    member('ff1', 'Priya',
      { hiking: 30, nightlife: 40, museums: 60, beaches: 20, adventure: 25 },
      { streetFood: 90, fineDining: 50, localCuisine: 95 },
      { pace: 50, flightComfort: 60, budgetConsciousness: 60 },
      { dietaryRestrictions: ['Vegetarian'], alcoholPreference: 'no' },
    ),
    member('ff2', 'Chen',
      { hiking: 40, nightlife: 50, museums: 70, beaches: 30, adventure: 35 },
      { streetFood: 80, fineDining: 85, localCuisine: 90 },
      { pace: 40, flightComfort: 70, budgetConsciousness: 50 },
    ),
    member('ff3', 'Fatima',
      { hiking: 35, nightlife: 30, museums: 55, beaches: 40, adventure: 20 },
      { streetFood: 75, fineDining: 60, localCuisine: 85 },
      { pace: 45, flightComfort: 65, budgetConsciousness: 55 },
      { dietaryRestrictions: ['Halal'], alcoholPreference: 'no' },
    ),
    member('ff4', 'David',
      { hiking: 50, nightlife: 60, museums: 50, beaches: 35, adventure: 45 },
      { streetFood: 85, fineDining: 70, localCuisine: 80 },
      { pace: 55, flightComfort: 55, budgetConsciousness: 65 },
    ),
  ],
};

// ---------------------------------------------------------------------------
// 4. Adventure Travelers — outdoor / active, moderate budget
// ---------------------------------------------------------------------------

export const ADVENTURE_TRAVELERS: PlanningContext = {
  destination:  'Queenstown, New Zealand',
  tripDuration: 4,
  tripDays:     5,
  startDate:    '2025-11-05',
  endDate:      '2025-11-09',
  groupSize:    4,
  lockedBudget: 8000, // $2,000/person
  members: [
    member('at1', 'Maya',
      { hiking: 95, nightlife: 20, museums: 30, beaches: 50, adventure: 95 },
      { streetFood: 70, fineDining: 25, localCuisine: 65 },
      { pace: 90, flightComfort: 70, budgetConsciousness: 60 },
    ),
    member('at2', 'Liam',
      { hiking: 90, nightlife: 40, museums: 20, beaches: 60, adventure: 90 },
      { streetFood: 75, fineDining: 20, localCuisine: 60 },
      { pace: 85, flightComfort: 65, budgetConsciousness: 65 },
    ),
    member('at3', 'Zoe',
      { hiking: 85, nightlife: 30, museums: 25, beaches: 55, adventure: 85 },
      { streetFood: 80, fineDining: 30, localCuisine: 70 },
      { pace: 80, flightComfort: 60, budgetConsciousness: 70 },
    ),
    member('at4', 'Kai',
      { hiking: 80, nightlife: 50, museums: 35, beaches: 65, adventure: 80 },
      { streetFood: 65, fineDining: 40, localCuisine: 60 },
      { pace: 75, flightComfort: 70, budgetConsciousness: 55 },
    ),
  ],
};

// ---------------------------------------------------------------------------
// 5. Mixed-Conflict Group — divergent preferences, tests fairness & negotiation
// ---------------------------------------------------------------------------

export const MIXED_CONFLICT: PlanningContext = {
  destination:  'Barcelona, Spain',
  tripDuration: 3,
  tripDays:     4,
  startDate:    '2025-10-20',
  endDate:      '2025-10-23',
  groupSize:    5,
  lockedBudget: 5000, // $1,000/person
  members: [
    member('mc1', 'Elena',   // museum-lover, no nightlife
      { hiking: 40, nightlife: 10, museums: 95, beaches: 50, adventure: 20 },
      { streetFood: 60, fineDining: 70, localCuisine: 80 },
      { pace: 30, flightComfort: 80, budgetConsciousness: 50 },
      { alcoholPreference: 'no' },
    ),
    member('mc2', 'Rico',    // nightlife-focused, hates museums
      { hiking: 30, nightlife: 95, museums: 10, beaches: 70, adventure: 50 },
      { streetFood: 85, fineDining: 40, localCuisine: 75 },
      { pace: 80, flightComfort: 50, budgetConsciousness: 70 },
      { mustAvoidActivities: 'museums, galleries, historical tours' },
    ),
    member('mc3', 'Aisha',   // beach + food, halal dietary
      { hiking: 35, nightlife: 40, museums: 45, beaches: 90, adventure: 30 },
      { streetFood: 70, fineDining: 50, localCuisine: 85 },
      { pace: 45, flightComfort: 60, budgetConsciousness: 65 },
      { dietaryRestrictions: ['Halal'], alcoholPreference: 'no' },
    ),
    member('mc4', 'Thor',    // adventure-first, very tight budget cap
      { hiking: 85, nightlife: 60, museums: 25, beaches: 55, adventure: 90 },
      { streetFood: 80, fineDining: 15, localCuisine: 65 },
      { pace: 90, flightComfort: 45, budgetConsciousness: 95 },
      { hardBudgetCap: 900 },
    ),
    member('mc5', 'Sophie',  // balanced, mobility limitation
      { hiking: 20, nightlife: 50, museums: 70, beaches: 75, adventure: 15 },
      { streetFood: 55, fineDining: 75, localCuisine: 70 },
      { pace: 25, flightComfort: 75, budgetConsciousness: 45 },
      { mobilityLimitations: 'uses a cane — avoid steep stairs and rough terrain' },
    ),
  ],
};

// ---------------------------------------------------------------------------
// All datasets as a flat list for the evaluation harness
// ---------------------------------------------------------------------------

export interface EvalDataset {
  id:          string;
  name:        string;
  description: string;
  context:     PlanningContext;
}

export const EVAL_DATASETS: EvalDataset[] = [
  {
    id:          'budget-travelers',
    name:        'Budget Travelers',
    description: 'Tight $800 budget, cost-conscious hostel-friendly group in Lisbon',
    context:     BUDGET_TRAVELERS,
  },
  {
    id:          'luxury-travelers',
    name:        'Luxury Travelers',
    description: 'High-budget comfort-first couple on the Amalfi Coast',
    context:     LUXURY_TRAVELERS,
  },
  {
    id:          'food-focused',
    name:        'Food-Focused Travelers',
    description: 'Diverse dietary requirements, cuisine-first group in Tokyo',
    context:     FOOD_FOCUSED,
  },
  {
    id:          'adventure-travelers',
    name:        'Adventure Travelers',
    description: 'High-intensity outdoor group in Queenstown',
    context:     ADVENTURE_TRAVELERS,
  },
  {
    id:          'mixed-conflict',
    name:        'Mixed-Conflict Group',
    description: 'Divergent preferences testing fairness & negotiation in Barcelona',
    context:     MIXED_CONFLICT,
  },
];
