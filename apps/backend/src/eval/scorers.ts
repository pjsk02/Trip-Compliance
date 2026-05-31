/**
 * Weave scorer functions for the evaluation harness.
 *
 * Each scorer is a pure function (input, output) → { score: 0-1, reason: string }
 * that Weave wraps as a traced op so every score is visible in the W&B UI.
 *
 * Scorers:
 *   1. satisfactionScore    — group mean satisfaction %
 *   2. fairnessScore        — std-dev-penalised fairness
 *   3. budgetCompliance     — hard-zero if over, else 60-100 by utilisation
 *   4. diversityScore       — distinct activity categories
 *   5. constraintSatisfaction — dietary + mobility + must-avoid respected
 */

import type { OrchestratorResult } from '../lib/planning/schemas';
import type { EvalDataset } from './datasets';
import type { FinalItinerary } from '../lib/planning/itinerary';
import type { ConsensusResult } from '../lib/planning/consensus';
import type { ActivityProposal, FoodProposal } from '../lib/planning/schemas';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface EvalInput {
  dataset: EvalDataset;
}

export interface TypedOrchestratorResult extends OrchestratorResult {
  itinerary:  FinalItinerary;
  consensus:  ConsensusResult;
  activity:   ActivityProposal;
  food:       FoodProposal;
}

export interface EvalOutput {
  result: TypedOrchestratorResult;
}

// Weave Evaluation scorer signature: single object arg { datasetRow, modelOutput }
export interface WeaveScoreInput {
  datasetRow:  { dataset: EvalDataset };
  modelOutput: EvalOutput;
}

export interface ScoreResult {
  score:  number;   // 0-1
  reason: string;
}

// ---------------------------------------------------------------------------
// Helper to extract typed result from Weave or direct call
// ---------------------------------------------------------------------------

function getResult(output: EvalOutput | WeaveScoreInput): TypedOrchestratorResult | null {
  if ('modelOutput' in output) return (output as WeaveScoreInput).modelOutput.result;
  return (output as EvalOutput).result;
}
function getDataset(input: EvalInput | WeaveScoreInput): EvalDataset {
  if ('datasetRow' in input) return (input as WeaveScoreInput).datasetRow.dataset;
  return (input as EvalInput).dataset;
}

// ---------------------------------------------------------------------------
// 1. User Satisfaction — group mean of per-member satisfaction %
// ---------------------------------------------------------------------------

export function scoreSatisfaction(input: EvalInput | WeaveScoreInput, output?: EvalOutput): ScoreResult {
  const result = output ? output.result : getResult(input as WeaveScoreInput);
  const scores = result?.itinerary?.satisfactionScores;
  if (!scores) return { score: 0, reason: 'No satisfaction scores in output' };

  const p = scores.groupSatisfactionPct;
  return {
    score:  Math.min(1, p / 100),
    reason: `Group mean satisfaction ${p}% (${scores.perMember.map((m: { memberName: string; satisfactionPct: number }) => `${m.memberName}:${m.satisfactionPct}%`).join(', ')})`,
  };
}

// ---------------------------------------------------------------------------
// 2. Fairness — raw fairness score from the consensus winner
// ---------------------------------------------------------------------------

export function scoreFairness(input: EvalInput | WeaveScoreInput, output?: EvalOutput): ScoreResult {
  const result = output ? output.result : getResult(input as WeaveScoreInput);
  const scores = result?.itinerary?.satisfactionScores;
  if (!scores) return { score: 0, reason: 'No satisfaction scores in output' };

  const raw = scores.fairnessScore;
  return {
    score:  Math.min(1, raw / 100),
    reason: `Fairness score ${raw}/100, floor met: ${scores.fairnessFloorMet}`,
  };
}

// ---------------------------------------------------------------------------
// 3. Budget Compliance — hard-zero if over locked budget
// ---------------------------------------------------------------------------

export function scoreBudgetCompliance(input: EvalInput | WeaveScoreInput, output?: EvalOutput): ScoreResult {
  const result  = output ? output.result : getResult(input as WeaveScoreInput);
  const dataset = getDataset(input);
  const budget  = result?.itinerary?.budgetBreakdown;
  if (!budget) return { score: 0, reason: 'No budget breakdown in output' };

  const lockedPP    = dataset.context.lockedBudget / dataset.context.groupSize;
  const estimatedPP = budget.totalPerPersonUsd;

  if (estimatedPP > lockedPP) {
    const overrunPct = Math.round(((estimatedPP - lockedPP) / lockedPP) * 100);
    return {
      score:  0,
      reason: `OVER BUDGET — $${estimatedPP}/person vs $${Math.round(lockedPP)} locked (+${overrunPct}%)`,
    };
  }

  const utilisation = estimatedPP / lockedPP;
  const score = utilisation >= 0.90 ? 1.0
    : utilisation >= 0.70 ? 0.60 + (utilisation - 0.70) * 2.0
    : utilisation * 0.85;

  return {
    score:  Math.round(score * 100) / 100,
    reason: `$${estimatedPP}/person vs $${Math.round(lockedPP)} locked (${Math.round(utilisation * 100)}% utilisation, surplus $${Math.round(budget.surplus)})`,
  };
}

// ---------------------------------------------------------------------------
// 4. Diversity — distinct activity categories in the winning itinerary
// ---------------------------------------------------------------------------

export function scoreDiversity(input: EvalInput | WeaveScoreInput, output?: EvalOutput): ScoreResult {
  const result    = output ? output.result : getResult(input as WeaveScoreInput);
  const consensus = result?.consensus;
  const winner    = consensus?.winner ?? consensus?.bestAvailable;

  if (!winner) return { score: 0, reason: 'No consensus winner' };

  const cats  = winner.candidate.distinctCategories;
  const score = Math.min(1, cats / 5);

  return {
    score,
    reason: `${cats} distinct activity categories (${winner.candidate.activities.map((a: { category: string }) => a.category).join(', ')})`,
  };
}

// ---------------------------------------------------------------------------
// 5. Constraint Satisfaction — dietary, mobility, must-avoid hard constraints
// ---------------------------------------------------------------------------

export function scoreConstraintSatisfaction(input: EvalInput | WeaveScoreInput, output?: EvalOutput): ScoreResult {
  const result   = output ? output.result : getResult(input as WeaveScoreInput);
  const dataset  = getDataset(input);
  const members  = dataset.context.members;
  const foodPlan = result?.food?.mealPlan ?? [];
  const activities = result?.activity?.candidates ?? [];

  let totalConstraints = 0;
  let met = 0;
  const violations: string[] = [];

  for (const member of members) {
    const c = member.constraints;

    for (const restriction of c.dietaryRestrictions) {
      totalConstraints++;
      const keyMap: Record<string, string> = {
        'vegetarian': 'vegetarian', 'vegan': 'vegan',
        'gluten-free': 'glutenFree', 'halal': 'halal',
        'kosher': 'kosher', 'nut-free': 'nutFree',
      };
      const compatKey = keyMap[restriction.toLowerCase()] ?? restriction.toLowerCase();
      const allCompatible = foodPlan.every((meal: { dietaryCompatibility: Record<string, boolean> }) =>
        meal.dietaryCompatibility[compatKey] !== false,
      );
      if (allCompatible) { met++; }
      else { violations.push(`${member.name}: ${restriction} not respected by some meals`); }
    }

    if (c.mustAvoidActivities) {
      totalConstraints++;
      const avoidTerms = c.mustAvoidActivities.toLowerCase().split(/[,;]+/).map((s: string) => s.trim());
      const anyViolation = activities.some((act: { name: string; category: string }) =>
        avoidTerms.some((term: string) => act.name.toLowerCase().includes(term) || act.category.toLowerCase().includes(term)),
      );
      if (!anyViolation) { met++; }
      else { violations.push(`${member.name}: must-avoid constraint violated`); }
    }

    if (c.alcoholPreference === 'no') {
      totalConstraints++;
      const alcoholFreeAvail = foodPlan.some((m: { alcoholServed: boolean }) => !m.alcoholServed);
      if (alcoholFreeAvail) { met++; }
      else { violations.push(`${member.name}: no alcohol-free meal options`); }
    }
  }

  if (totalConstraints === 0) return { score: 1, reason: 'No hard constraints to evaluate' };

  const score = met / totalConstraints;
  return {
    score:  Math.round(score * 100) / 100,
    reason: violations.length === 0
      ? `All ${totalConstraints} constraints satisfied`
      : `${met}/${totalConstraints} constraints met. Violations: ${violations.join('; ')}`,
  };
}

// ---------------------------------------------------------------------------
// Aggregated eval result (stored for leaderboard)
// ---------------------------------------------------------------------------

export interface EvalRunResult {
  runId:           string;
  datasetId:       string;
  datasetName:     string;
  timestamp:       string;
  promptHash:      string;   // SHA of agent system prompts — used for regression detection
  durationMs:      number;
  scores: {
    satisfaction:         number;
    fairness:             number;
    budgetCompliance:     number;
    diversity:            number;
    constraintSatisfaction: number;
    overall:              number;   // weighted composite
  };
  reasons: {
    satisfaction:         string;
    fairness:             string;
    budgetCompliance:     string;
    diversity:            string;
    constraintSatisfaction: string;
  };
  consensusStatus: string;
  adminOverride:   boolean;
  totalCostPerPersonUsd: number;
  negotiationRounds: number;
}

// Weights for overall score (mirrors PRD weights)
export const SCORE_WEIGHTS = {
  satisfaction:           0.40,
  fairness:               0.25,
  budgetCompliance:       0.20,
  diversity:              0.05,
  constraintSatisfaction: 0.10,
};

export function computeOverall(scores: Omit<EvalRunResult['scores'], 'overall'>): number {
  return Math.round((
    scores.satisfaction          * SCORE_WEIGHTS.satisfaction +
    scores.fairness              * SCORE_WEIGHTS.fairness +
    scores.budgetCompliance      * SCORE_WEIGHTS.budgetCompliance +
    scores.diversity             * SCORE_WEIGHTS.diversity +
    scores.constraintSatisfaction * SCORE_WEIGHTS.constraintSatisfaction
  ) * 100) / 100;
}
