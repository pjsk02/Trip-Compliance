/**
 * Shared Zod schemas and TypeScript types for all planning agent proposals.
 * Each agent returns a strongly-typed JSON proposal that the Orchestrator
 * assembles into the final Itinerary.
 */
import { z } from 'zod';
import type {
  PreferenceScores,
  PreferencePriorities,
  ConstraintFields,
} from '../preferenceSchema';

// ---------------------------------------------------------------------------
// Orchestrator input context
// ---------------------------------------------------------------------------

export interface MemberPreferenceSnapshot {
  memberId:  string;
  userId?:   string;   // User.id — optional, not used by agents
  name:      string;
  scores:    PreferenceScores;
  priorities: PreferencePriorities;
  constraints: ConstraintFields;
  chatNuance?: string | null;
}

export interface PlanningContext {
  destination:  string;
  tripDuration: number;        // nights
  groupSize:    number;
  lockedBudget: number;        // USD total for the group
  members:      MemberPreferenceSnapshot[];
}

// ---------------------------------------------------------------------------
// Utility: group-utility score (simple mean of a numeric array)
// ---------------------------------------------------------------------------

export function groupMean(values: number[]): number {
  if (values.length === 0) return 50;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/** Collect scores for a given activity key across all members. */
export function activityScores(
  members: MemberPreferenceSnapshot[],
  key: keyof PreferenceScores['activities'],
): number[] {
  return members.map(m => m.scores.activities[key]);
}

// ---------------------------------------------------------------------------
// Activity Agent schema
// ---------------------------------------------------------------------------

export const ActivityCandidateSchema = z.object({
  name:            z.string(),
  category:        z.enum(['hiking', 'nightlife', 'museums', 'beaches', 'adventure', 'mixed']),
  description:     z.string(),
  groupUtilityScore: z.number().int().min(0).max(100),
  estimatedCostPerPersonUsd: z.number().nonnegative(),
  durationHours:   z.number().positive(),
  accessibilityNotes: z.string().optional(),
});

export const ActivityProposalSchema = z.object({
  agent:      z.literal('activity'),
  candidates: z.array(ActivityCandidateSchema).min(3).max(10),
  /** Activities vetoed due to must-avoid constraints — for transparency. */
  excluded:   z.array(z.object({ name: z.string(), reason: z.string() })),
  nuanceApplied: z.string().optional(),
});

export type ActivityCandidate = z.infer<typeof ActivityCandidateSchema>;
export type ActivityProposal  = z.infer<typeof ActivityProposalSchema>;

// ---------------------------------------------------------------------------
// Food Agent schema
// ---------------------------------------------------------------------------

export const MealSchema = z.object({
  day:              z.number().int().positive(),
  type:             z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
  venue:            z.string(),
  cuisineType:      z.string(),
  estimatedCostPerPersonUsd: z.number().nonnegative(),
  dietaryCompatibility: z.object({
    vegetarian:  z.boolean(),
    vegan:       z.boolean(),
    glutenFree:  z.boolean(),
    halal:       z.boolean(),
    kosher:      z.boolean(),
    nutFree:     z.boolean(),
  }),
  alcoholServed:    z.boolean(),
  notes:            z.string().optional(),
});

export const FoodProposalSchema = z.object({
  agent:       z.literal('food'),
  mealPlan:    z.array(MealSchema),
  /** Hard dietary constraints from member profiles. */
  dietaryFlags: z.array(z.object({
    restriction: z.string(),
    affectedMembers: z.array(z.string()),
    respected: z.boolean(),
  })),
  totalFoodCostPerPersonUsd: z.number().nonnegative(),
  nuanceApplied: z.string().optional(),
});

export type Meal         = z.infer<typeof MealSchema>;
export type FoodProposal = z.infer<typeof FoodProposalSchema>;

// ---------------------------------------------------------------------------
// Accommodation Agent schema
// ---------------------------------------------------------------------------

export const AccommodationOptionSchema = z.object({
  name:         z.string(),
  type:         z.enum(['hotel', 'hostel', 'airbnb', 'resort', 'guesthouse', 'boutique']),
  pricePerNightPerPersonUsd: z.number().nonnegative(),
  totalCostUsd: z.number().nonnegative(),
  pros:         z.array(z.string()),
  cons:         z.array(z.string()),
  accessibilityFriendly: z.boolean(),
  groupFitScore: z.number().int().min(0).max(100),
});

export const AccommodationProposalSchema = z.object({
  agent:      z.literal('accommodation'),
  options:    z.array(AccommodationOptionSchema).length(3),
  recommended: z.number().int().min(0).max(2),   // index into options
  rationale:  z.string(),
});

export type AccommodationOption   = z.infer<typeof AccommodationOptionSchema>;
export type AccommodationProposal = z.infer<typeof AccommodationProposalSchema>;

// ---------------------------------------------------------------------------
// Transportation Agent schema
// ---------------------------------------------------------------------------

export const TransportLegSchema = z.object({
  from:        z.string(),
  to:          z.string(),
  mode:        z.enum(['flight', 'train', 'bus', 'ferry', 'taxi', 'rental_car', 'metro', 'walk']),
  estimatedCostPerPersonUsd: z.number().nonnegative(),
  estimatedDurationHours:    z.number().nonnegative(),
  notes:       z.string().optional(),
});

export const TransportationProposalSchema = z.object({
  agent:        z.literal('transportation'),
  legs:         z.array(TransportLegSchema),
  localTransportSummary: z.string(),
  totalTransportCostPerPersonUsd: z.number().nonnegative(),
});

export type TransportLeg           = z.infer<typeof TransportLegSchema>;
export type TransportationProposal = z.infer<typeof TransportationProposalSchema>;

// ---------------------------------------------------------------------------
// Budget Agent schema
// ---------------------------------------------------------------------------

export const BudgetLineSchema = z.object({
  category:         z.string(),
  estimatedCostPerPersonUsd: z.number().nonnegative(),
  totalUsd:         z.number().nonnegative(),
});

export const BudgetProposalSchema = z.object({
  agent:           z.literal('budget'),
  lines:           z.array(BudgetLineSchema),
  totalEstimatedUsd: z.number().nonnegative(),
  lockedBudgetUsd: z.number().nonnegative(),
  surplus:         z.number(),               // negative = overrun
  overrunFlag:     z.boolean(),
  /** Substitutions recommended if over budget. */
  substitutions:   z.array(z.object({
    replace:     z.string(),
    with:        z.string(),
    savingUsd:   z.number().nonnegative(),
  })),
});

export type BudgetLine     = z.infer<typeof BudgetLineSchema>;
export type BudgetProposal = z.infer<typeof BudgetProposalSchema>;

// ---------------------------------------------------------------------------
// Logistics Agent (v1.1 stub)
// ---------------------------------------------------------------------------

export const LogisticsProposalSchema = z.object({
  agent:  z.literal('logistics'),
  status: z.literal('stub'),
  note:   z.string(),
});

export type LogisticsProposal = z.infer<typeof LogisticsProposalSchema>;

// ---------------------------------------------------------------------------
// Feedback adjustment overlays — passed to runOrchestratorWithFeedback
// ---------------------------------------------------------------------------

export const FeedbackTypeEnum = z.enum([
  'ACTIVITY_REWEIGHT',
  'BUDGET_CUT',
  'TRANSPORT_VETO',
  'PREFERENCE_CHANGE',
]);
export type FeedbackType = z.infer<typeof FeedbackTypeEnum>;

/** Parsed structure produced by the feedback classifier for each type. */
export const ActivityReweightAdjustmentSchema = z.object({
  type: z.literal('ACTIVITY_REWEIGHT'),
  boost:  z.array(z.enum(['hiking', 'nightlife', 'museums', 'beaches', 'adventure'])),
  reduce: z.array(z.enum(['hiking', 'nightlife', 'museums', 'beaches', 'adventure'])),
  instruction: z.string(),
});

export const BudgetCutAdjustmentSchema = z.object({
  type: z.literal('BUDGET_CUT'),
  cutPerPersonUsd: z.number().positive(),
  instruction: z.string(),
});

export const TransportVetoAdjustmentSchema = z.object({
  type: z.literal('TRANSPORT_VETO'),
  vetoDescription: z.string(),
  instruction: z.string(),
});

export const PreferenceChangeAdjustmentSchema = z.object({
  type: z.literal('PREFERENCE_CHANGE'),
  memberId: z.string(),
  memberName: z.string(),
  changes: z.record(z.string(), z.unknown()),
  instruction: z.string(),
});

export const FeedbackAdjustmentSchema = z.discriminatedUnion('type', [
  ActivityReweightAdjustmentSchema,
  BudgetCutAdjustmentSchema,
  TransportVetoAdjustmentSchema,
  PreferenceChangeAdjustmentSchema,
]);
export type FeedbackAdjustment = z.infer<typeof FeedbackAdjustmentSchema>;

export const ClassifiedFeedbackSchema = z.object({
  type:        FeedbackTypeEnum,
  targetAgent: z.enum(['activity', 'budget', 'transportation', 'food']),
  adjustment:  FeedbackAdjustmentSchema,
  summary:     z.string(),
});
export type ClassifiedFeedback = z.infer<typeof ClassifiedFeedbackSchema>;

// ---------------------------------------------------------------------------
// Orchestrator output
// ---------------------------------------------------------------------------

export interface OrchestratorResult {
  context:        PlanningContext;
  activity:       ActivityProposal;
  food:           FoodProposal;
  accommodation:  AccommodationProposal;
  transportation: TransportationProposal;
  budget:         BudgetProposal;
  logistics:      LogisticsProposal;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  negotiation?:   unknown;
  consensus?:     unknown;
  itinerary?:     unknown;
  /** Wall-clock ms from orchestrator start to finish. */
  durationMs:     number;
}
