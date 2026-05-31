import { z } from 'zod';
import { BaseAgent, contextSummary } from '../agent';
import {
  FoodProposalSchema,
  type FoodProposal,
  type PlanningContext,
  groupMean,
} from '../schemas';

export class FoodAgent extends BaseAgent<FoodProposal> {
  readonly name = 'food';

  protected schema(): z.ZodType<FoodProposal> {
    return FoodProposalSchema;
  }

  protected safeDefault(ctx: PlanningContext): FoodProposal {
    const mealPlan: FoodProposal['mealPlan'] = [];
    const safe = { vegetarian: true, vegan: false, glutenFree: false, halal: false, kosher: false, nutFree: false };
    for (let day = 1; day <= ctx.tripDuration; day++) {
      mealPlan.push(
        { day, type: 'breakfast', venue: 'Hotel / hostel breakfast', cuisineType: 'Continental', estimatedCostPerPersonUsd: 8, dietaryCompatibility: safe, alcoholServed: false },
        { day, type: 'lunch', venue: 'Local café', cuisineType: 'Local', estimatedCostPerPersonUsd: 14, dietaryCompatibility: safe, alcoholServed: false },
        { day, type: 'dinner', venue: 'Local restaurant', cuisineType: 'Local', estimatedCostPerPersonUsd: 20, dietaryCompatibility: safe, alcoholServed: true },
      );
    }
    return {
      agent: 'food',
      mealPlan,
      dietaryFlags: [],
      totalFoodCostPerPersonUsd: 42 * ctx.tripDuration,
    };
  }

  protected systemPrompt(): string {
    return `You are the TripSync Food Planner agent. You design a meal plan for the trip.

STRICT RULES:
1. Dietary constraints are HARD requirements — they cannot be overridden by slider preferences.
   Any member's dietary restriction must be respected by every meal they attend.
2. After satisfying dietary constraints, rank meal venues by food slider scores:
   - streetFood score → weight towards street food / hawker / casual
   - fineDining score → weight towards upscale restaurants
   - localCuisine score → prefer authentic local over international chains
3. Alcohol: if ANY member has alcoholPreference "no", ensure at least 50% of dinner venues have good non-alcoholic options. "Sometimes" members are fine with alcohol-serving venues.
4. Generate 2-3 meals per day (breakfast, lunch, dinner). You may omit breakfast if the accommodation provides it — note this.
5. Include real-sounding venue types (generic descriptions fine — "bistro", "night market" etc). Keep venue names SHORT (≤6 words).
6. Be concise: use short cuisineType values (e.g. "French bistro", "street food"). No notes unless critical.
7. Compute totalFoodCostPerPersonUsd as the sum of all meal costs across all days.
8. dietaryFlags: list EVERY dietary restriction, affected members, and respected: true/false.

OUTPUT: Return ONLY a valid JSON object matching this schema. No prose, no markdown fences:
{
  "agent": "food",
  "mealPlan": [
    {
      "day": 1,
      "type": "breakfast|lunch|dinner|snack",
      "venue": "string",
      "cuisineType": "string",
      "estimatedCostPerPersonUsd": number,
      "dietaryCompatibility": {
        "vegetarian": true|false,
        "vegan": true|false,
        "glutenFree": true|false,
        "halal": true|false,
        "kosher": true|false,
        "nutFree": true|false
      },
      "alcoholServed": true|false,
      "notes": "string or omit"
    }
  ],
  "dietaryFlags": [
    { "restriction": "string", "affectedMembers": ["name"], "respected": true|false }
  ],
  "totalFoodCostPerPersonUsd": number,
  "nuanceApplied": "string or omit"
}`;
  }

  protected buildUserPrompt(ctx: PlanningContext): string {
    // Aggregate all dietary restrictions across members
    const dietaryByMember = ctx.members.map(m => ({
      name:         m.name,
      restrictions: m.constraints.dietaryRestrictions,
      other:        m.constraints.dietaryOther,
      alcohol:      m.constraints.alcoholPreference,
    }));

    const allRestrictions = Array.from(
      new Set(ctx.members.flatMap(m => m.constraints.dietaryRestrictions)),
    );

    const alcoholNoCount = ctx.members.filter(m => m.constraints.alcoholPreference === 'no').length;

    const foodScores = {
      streetFood:   groupMean(ctx.members.map(m => m.scores.food.streetFood)),
      fineDining:   groupMean(ctx.members.map(m => m.scores.food.fineDining)),
      localCuisine: groupMean(ctx.members.map(m => m.scores.food.localCuisine)),
    };

    return [
      contextSummary(ctx),
      '',
      'FOOD PREFERENCE SCORES (group means, 0-100):',
      `  Street food: ${foodScores.streetFood}`,
      `  Fine dining: ${foodScores.fineDining}`,
      `  Local cuisine: ${foodScores.localCuisine}`,
      '',
      'DIETARY CONSTRAINTS (HARD — must be respected):',
      ...dietaryByMember.map(d => {
        const parts = d.restrictions.length ? d.restrictions.join(', ') : 'none';
        const other = d.other ? ` + ${d.other}` : '';
        return `  ${d.name}: ${parts}${other}  |  alcohol: ${d.alcohol}`;
      }),
      allRestrictions.length
        ? `All restrictions to accommodate: ${allRestrictions.join(', ')}`
        : 'No dietary restrictions across the group.',
      alcoholNoCount > 0
        ? `${alcoholNoCount} member(s) do not drink — ensure alcohol-free options at every venue.`
        : '',
      '',
      `Plan ${ctx.tripDuration} days of meals for ${ctx.groupSize} people.`,
    ].filter(Boolean).join('\n');
  }
}
