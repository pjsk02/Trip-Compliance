import { z } from 'zod';

// ---------------------------------------------------------------------------
// Slider-based scores (1-10 from UI, stored as 0-100 after *10 scaling)
// ---------------------------------------------------------------------------

export const SliderValuesSchema = z.object({
  activities: z.object({
    hiking:    z.number().int().min(0).max(100),
    nightlife: z.number().int().min(0).max(100),
    museums:   z.number().int().min(0).max(100),
    beaches:   z.number().int().min(0).max(100),
    adventure: z.number().int().min(0).max(100),
  }),
  food: z.object({
    streetFood:   z.number().int().min(0).max(100),
    fineDining:   z.number().int().min(0).max(100),
    localCuisine: z.number().int().min(0).max(100),
  }),
  logistics: z.object({
    pace:             z.number().int().min(0).max(100), // 0=relaxed, 100=packed
    flightComfort:    z.number().int().min(0).max(100),
    budgetConsciousness: z.number().int().min(0).max(100), // 0=spend freely, 100=budget-focused
  }),
});

// ---------------------------------------------------------------------------
// Categorical / free-text fields collected via form controls (not sliders)
// ---------------------------------------------------------------------------

export const ConstraintFieldsSchema = z.object({
  dietaryRestrictions: z.array(z.string()),            // multi-select + free text
  dietaryOther: z.string().optional(),                 // free-text addition
  alcoholPreference: z.enum(['yes', 'no', 'sometimes']),
  hardBudgetCap: z.number().positive().optional(),     // USD
  totalBudget: z.number().positive().optional(),       // private, USD
  mobilityLimitations: z.string().optional(),
  scheduleRestrictions: z.string().optional(),
  visaRestrictions: z.string().optional(),
  mustAvoidActivities: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Scores — 0-100 integers for the full preference profile
// ---------------------------------------------------------------------------

const ScoreMap = z.record(z.string(), z.number().int().min(0).max(100));

export const PreferenceScoresSchema = z.object({
  activities: z.object({
    hiking:    z.number().int().min(0).max(100),
    nightlife: z.number().int().min(0).max(100),
    museums:   z.number().int().min(0).max(100),
    beaches:   z.number().int().min(0).max(100),
    adventure: z.number().int().min(0).max(100),
  }),
  food: z.object({
    streetFood:   z.number().int().min(0).max(100),
    fineDining:   z.number().int().min(0).max(100),
    localCuisine: z.number().int().min(0).max(100),
    dietary:      ScoreMap,   // { vegetarian: 80, glutenFree: 0 }
    alcohol:      z.number().int().min(0).max(100),
  }),
  logistics: z.object({
    flightComfort:       z.number().int().min(0).max(100),
    accommodationType:   ScoreMap,
    pace:                z.number().int().min(0).max(100),
    budgetSplit:         z.number().int().min(0).max(100),
    transport:           ScoreMap,
    budgetConsciousness: z.number().int().min(0).max(100),
  }),
  constraints: z.object({
    hardBudgetCap: z.number().int().min(0).max(100),
    mobility:      z.number().int().min(0).max(100),
    schedule:      z.number().int().min(0).max(100),
    visa:          z.number().int().min(0).max(100),
  }),
});

export const PreferencePrioritiesSchema = z.object({
  mustHave:   z.array(z.string()),
  niceToHave: z.array(z.string()),
  neutral:    z.array(z.string()),
  avoid:      z.array(z.string()),
});

export const PreferenceProfileSchema = z.object({
  scores:          PreferenceScoresSchema,
  priorities:      PreferencePrioritiesSchema,
  // Raw inputs preserved so the review screen can show them
  sliderValues:    SliderValuesSchema.optional(),
  constraintFields: ConstraintFieldsSchema.optional(),
  // Chat-extracted nuance appended by the AI clarification chat
  chatNuance:      z.string().optional(),
  estimatedBudget: z.number().positive().optional(),
});

export type SliderValues      = z.infer<typeof SliderValuesSchema>;
export type ConstraintFields  = z.infer<typeof ConstraintFieldsSchema>;
export type PreferenceScores  = z.infer<typeof PreferenceScoresSchema>;
export type PreferencePriorities = z.infer<typeof PreferencePrioritiesSchema>;
export type PreferenceProfile = z.infer<typeof PreferenceProfileSchema>;

// ---------------------------------------------------------------------------
// Priority derivation from slider values (9-10→Must Have, 6-8→Nice to Have,
// 3-5→Neutral, 1-2→Avoid). Score is 0-100 so thresholds scale accordingly.
// ---------------------------------------------------------------------------

export function derivePriorities(sliders: SliderValues): PreferencePriorities {
  const items: Array<{ label: string; score: number }> = [
    { label: 'Hiking / Outdoors',   score: sliders.activities.hiking },
    { label: 'Nightlife',           score: sliders.activities.nightlife },
    { label: 'Museums / Culture',   score: sliders.activities.museums },
    { label: 'Beaches',             score: sliders.activities.beaches },
    { label: 'Adventure Sports',    score: sliders.activities.adventure },
    { label: 'Street Food',         score: sliders.food.streetFood },
    { label: 'Fine Dining',         score: sliders.food.fineDining },
    { label: 'Local Cuisine',       score: sliders.food.localCuisine },
    { label: 'Relaxed Pace',        score: 100 - sliders.logistics.pace },
    { label: 'Packed Itinerary',    score: sliders.logistics.pace },
    { label: 'Flight Comfort',      score: sliders.logistics.flightComfort },
    { label: 'Budget-Conscious',    score: sliders.logistics.budgetConsciousness },
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

  return { mustHave, niceToHave, neutral, avoid };
}

// ---------------------------------------------------------------------------
// Build a full PreferenceScores from slider values + constraint fields,
// filling in neutral (50) for any dimension not covered by sliders.
// ---------------------------------------------------------------------------

export function scoresFromSliders(
  sliders: SliderValues,
  constraints: ConstraintFields,
): PreferenceScores {
  const dietary: Record<string, number> = {};
  for (const d of constraints.dietaryRestrictions) {
    dietary[d] = 100; // marked as a restriction → full weight
  }

  return {
    activities: { ...sliders.activities },
    food: {
      streetFood:   sliders.food.streetFood,
      fineDining:   sliders.food.fineDining,
      localCuisine: sliders.food.localCuisine,
      dietary,
      alcohol:
        constraints.alcoholPreference === 'yes'       ? 80 :
        constraints.alcoholPreference === 'sometimes' ? 50 : 10,
    },
    logistics: {
      flightComfort:       sliders.logistics.flightComfort,
      accommodationType:   {},
      pace:                sliders.logistics.pace,
      budgetSplit:         50,
      transport:           {},
      budgetConsciousness: sliders.logistics.budgetConsciousness,
    },
    constraints: {
      hardBudgetCap: constraints.hardBudgetCap ? 80 : 20,
      mobility:      constraints.mobilityLimitations ? 60 : 10,
      schedule:      constraints.scheduleRestrictions ? 60 : 10,
      visa:          constraints.visaRestrictions ? 60 : 10,
    },
  };
}

// Coverage tracks which steps the member has completed.
export interface StepCoverage {
  slidersSet:        boolean;
  constraintsFilled: boolean;
  chatDone:          boolean;
}

// Legacy CategoryCoverage kept for backward compat with chat detection
export interface CategoryCoverage {
  activities:  boolean;
  food:        boolean;
  logistics:   boolean;
  constraints: boolean;
}
