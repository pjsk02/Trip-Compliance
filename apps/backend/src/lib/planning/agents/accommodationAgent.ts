import { z } from 'zod';
import { BaseAgent, contextSummary } from '../agent';
import {
  AccommodationProposalSchema,
  type AccommodationProposal,
  type PlanningContext,
  groupMean,
} from '../schemas';

export class AccommodationAgent extends BaseAgent<AccommodationProposal> {
  readonly name = 'accommodation';

  protected schema(): z.ZodType<AccommodationProposal> {
    return AccommodationProposalSchema;
  }

  protected systemPrompt(): string {
    return `You are the TripSync Accommodation Planner agent. You propose exactly 3 accommodation options with a recommended pick.

RANKING RULES:
1. Use flightComfort as a proxy for "comfort tolerance" — high score (≥70) → lean towards hotels/resorts; low (≤40) → hostels/budget OK.
2. Use budgetConsciousness to calibrate price point — high (≥70) → find budget options; low (≤30) → comfort spend is fine.
3. Group size matters: >6 people benefit from Airbnb/villa options; ≤4 can use standard hotel rooms.
4. If any member has mobility limitations → flag accessibilityFriendly: false for options without lifts/accessibility features.
5. Compute groupFitScore (0-100) as a weighted combination of: comfort match (40%), budget fit (40%), group-size fit (20%).
6. Propose one budget, one mid-range, and one premium option. The recommended index is the best overall fit.
7. totalCostUsd = pricePerNightPerPersonUsd × groupSize × tripDuration.

OUTPUT: Return ONLY valid JSON. No prose, no markdown fences:
{
  "agent": "accommodation",
  "options": [
    {
      "name": "string",
      "type": "hotel|hostel|airbnb|resort|guesthouse|boutique",
      "pricePerNightPerPersonUsd": number,
      "totalCostUsd": number,
      "pros": ["string"],
      "cons": ["string"],
      "accessibilityFriendly": true|false,
      "groupFitScore": 0-100
    }
  ],
  "recommended": 0|1|2,
  "rationale": "2-3 sentence explanation of the recommended pick"
}`;
  }

  protected buildUserPrompt(ctx: PlanningContext): string {
    const comfortScore  = groupMean(ctx.members.map(m => m.scores.logistics.flightComfort));
    const budgetScore   = groupMean(ctx.members.map(m => m.scores.logistics.budgetConsciousness));
    const perPersonBudget = ctx.lockedBudget / ctx.groupSize;

    const mobilityMembers = ctx.members
      .filter(m => m.constraints.mobilityLimitations)
      .map(m => m.name);

    const hardCaps = ctx.members
      .filter(m => m.constraints.hardBudgetCap)
      .map(m => `${m.name}: $${m.constraints.hardBudgetCap}`);

    return [
      contextSummary(ctx),
      '',
      'ACCOMMODATION SIGNALS:',
      `  Group comfort preference (flightComfort proxy): ${comfortScore}/100`,
      `  Group budget-consciousness: ${budgetScore}/100`,
      `  Total budget per person: $${Math.round(perPersonBudget)}`,
      `  Trip duration: ${ctx.tripDuration} nights`,
      mobilityMembers.length
        ? `  Accessibility required for: ${mobilityMembers.join(', ')}`
        : '  No mobility constraints.',
      hardCaps.length
        ? `  Hard budget caps: ${hardCaps.join(', ')}`
        : '',
      '',
      'Propose exactly 3 options (budget / mid-range / premium) and pick the best fit.',
    ].filter(Boolean).join('\n');
  }
}
