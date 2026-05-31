import { z } from 'zod';
import { BaseAgent, contextSummary } from '../agent';
import {
  BudgetProposalSchema,
  type BudgetProposal,
  type PlanningContext,
  type ActivityProposal,
  type FoodProposal,
  type AccommodationProposal,
  type TransportationProposal,
  groupMean,
} from '../schemas';

export interface BudgetAgentInput {
  ctx:           PlanningContext;
  activity:      ActivityProposal;
  food:          FoodProposal;
  accommodation: AccommodationProposal;
  transportation: TransportationProposal;
}

/** Budget Agent receives the other agents' cost estimates and reconciles them. */
export class BudgetAgent extends BaseAgent<BudgetProposal> {
  readonly name = 'budget';

  private input!: BudgetAgentInput;

  withInput(input: BudgetAgentInput): this {
    this.input = input;
    return this;
  }

  protected schema(): z.ZodType<BudgetProposal> {
    return BudgetProposalSchema;
  }

  protected systemPrompt(): string {
    return `You are the TripSync Budget Reconciliation agent. You receive cost estimates from the Activity, Food, Accommodation, and Transportation agents and produce a unified budget summary.

RULES:
1. Sum up all cost lines and compare to the lockedBudgetUsd.
2. surplus = lockedBudgetUsd - totalEstimatedUsd (negative if over budget).
3. Set overrunFlag: true if surplus < 0.
4. If over budget: propose concrete substitutions — which activity/meal/accommodation to swap to save money. Be specific (e.g. "Replace mid-range hotel with budget guesthouse, saving ~$X per person").
5. If under budget: note the buffer — do NOT fabricate extra spending.
6. Budget-consciousness score: if high (≥70) → be conservative in estimates; if low (≤30) → premium options are acceptable.
7. Lines: one per category (accommodation, food, activities, transport, miscellaneous). estimatedCostPerPersonUsd × groupSize = totalUsd.

OUTPUT: Return ONLY valid JSON. No prose, no markdown fences:
{
  "agent": "budget",
  "lines": [
    {
      "category": "string",
      "estimatedCostPerPersonUsd": number,
      "totalUsd": number
    }
  ],
  "totalEstimatedUsd": number,
  "lockedBudgetUsd": number,
  "surplus": number,
  "overrunFlag": true|false,
  "substitutions": [
    { "replace": "string", "with": "string", "savingUsd": number }
  ]
}`;
  }

  protected buildUserPrompt(ctx: PlanningContext): string {
    const { activity, food, accommodation, transportation } = this.input;
    const perPersonBudget = ctx.lockedBudget / ctx.groupSize;
    const budgetScore = groupMean(ctx.members.map(m => m.scores.logistics.budgetConsciousness));
    const rec = accommodation.options[accommodation.recommended];

    // Summarise costs from sibling agents
    const topActivitiesCost = activity.candidates
      .slice(0, 4)
      .reduce((sum, a) => sum + a.estimatedCostPerPersonUsd, 0);

    const miscPerPerson = Math.round(perPersonBudget * 0.05); // 5% buffer estimate

    return [
      contextSummary(ctx),
      '',
      'COST ESTIMATES FROM SIBLING AGENTS:',
      `  Accommodation (recommended: ${rec.name}):`,
      `    $${rec.pricePerNightPerPersonUsd}/night × ${ctx.tripDuration} nights = $${Math.round(rec.pricePerNightPerPersonUsd * ctx.tripDuration)}/person`,
      `    Total accommodation: $${rec.totalCostUsd}`,
      `  Food:`,
      `    $${food.totalFoodCostPerPersonUsd}/person total`,
      `    Food total: $${Math.round(food.totalFoodCostPerPersonUsd * ctx.groupSize)}`,
      `  Top 4 activities (combined per-person estimate): $${topActivitiesCost}`,
      `    Activities total: $${Math.round(topActivitiesCost * ctx.groupSize)}`,
      `  Transport: $${transportation.totalTransportCostPerPersonUsd}/person`,
      `    Transport total: $${Math.round(transportation.totalTransportCostPerPersonUsd * ctx.groupSize)}`,
      `  Misc (estimated): $${miscPerPerson}/person`,
      '',
      `GROUP BUDGET SIGNAL:`,
      `  Locked budget: $${ctx.lockedBudget} total ($${Math.round(perPersonBudget)}/person)`,
      `  Budget-consciousness score: ${budgetScore}/100`,
      '',
      'Produce the full budget reconciliation. If over budget, propose specific substitutions.',
    ].join('\n');
  }
}
