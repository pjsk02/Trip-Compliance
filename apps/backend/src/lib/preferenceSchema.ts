import { z } from 'zod';

// Scores are 0-100 integers expressing how much the member wants a given dimension.
// 0 = hard avoid, 50 = neutral, 100 = must-have.
const ScoreMap = z.record(z.string(), z.number().int().min(0).max(100));

export const PreferenceScoresSchema = z.object({
  activities: z.object({
    hiking:      z.number().int().min(0).max(100),
    nightlife:   z.number().int().min(0).max(100),
    museums:     z.number().int().min(0).max(100),
    beaches:     z.number().int().min(0).max(100),
    adventure:   z.number().int().min(0).max(100),
  }),
  food: z.object({
    streetFood:  z.number().int().min(0).max(100),
    fineDining:  z.number().int().min(0).max(100),
    localCuisine:z.number().int().min(0).max(100),
    dietary:     ScoreMap,   // e.g. { vegetarian: 80, glutenFree: 0 }
    alcohol:     z.number().int().min(0).max(100),
  }),
  logistics: z.object({
    flightComfort:      z.number().int().min(0).max(100),
    accommodationType:  ScoreMap,  // { hotel: 80, hostel: 20, airbnb: 60 }
    pace:               z.number().int().min(0).max(100), // 0=relaxed, 100=packed
    budgetSplit:        z.number().int().min(0).max(100), // 0=split evenly, 100=pay own
    transport:          ScoreMap,  // { publicTransit: 60, taxi: 40, rental: 20 }
  }),
  constraints: z.object({
    hardBudgetCap: z.number().int().min(0).max(100), // 0=very flexible, 100=strict cap
    mobility:      z.number().int().min(0).max(100), // 0=no restrictions, 100=significant
    schedule:      z.number().int().min(0).max(100), // 0=fully flexible, 100=rigid
    visa:          z.number().int().min(0).max(100), // 0=no issues, 100=significant constraints
  }),
});

export const PreferencePrioritiesSchema = z.object({
  mustHave:   z.array(z.string()),
  niceToHave: z.array(z.string()),
  neutral:    z.array(z.string()),
  avoid:      z.array(z.string()),
});

export const PreferenceProfileSchema = z.object({
  scores:     PreferenceScoresSchema,
  priorities: PreferencePrioritiesSchema,
  // Budget captured privately during chat; stored on Member, not exposed in profile
  estimatedBudget: z.number().positive().optional(),
});

export type PreferenceScores     = z.infer<typeof PreferenceScoresSchema>;
export type PreferencePriorities = z.infer<typeof PreferencePrioritiesSchema>;
export type PreferenceProfile    = z.infer<typeof PreferenceProfileSchema>;

// Coverage tracks which categories the agent has gathered enough signal on.
export interface CategoryCoverage {
  activities:  boolean;
  food:        boolean;
  logistics:   boolean;
  constraints: boolean;
}
