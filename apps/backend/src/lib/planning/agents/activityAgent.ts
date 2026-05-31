import { z } from 'zod';
import { BaseAgent, contextSummary } from '../agent';
import {
  ActivityProposalSchema,
  type ActivityProposal,
  type PlanningContext,
  groupMean,
  activityScores,
} from '../schemas';

export class ActivityAgent extends BaseAgent<ActivityProposal> {
  readonly name = 'activity';

  protected schema(): z.ZodType<ActivityProposal> {
    return ActivityProposalSchema;
  }

  protected safeDefault(ctx: PlanningContext): ActivityProposal {
    return {
      agent: 'activity',
      candidates: [
        {
          name: 'City exploration',
          category: 'mixed',
          description: `Self-guided walking tour of ${ctx.destination}. Explore local neighbourhoods, markets, and landmarks at your own pace.`,
          groupUtilityScore: 50,
          estimatedCostPerPersonUsd: 0,
          durationHours: 4,
        },
        {
          name: 'Local food market visit',
          category: 'mixed',
          description: `Visit a local market in ${ctx.destination} to sample street food and browse local goods.`,
          groupUtilityScore: 50,
          estimatedCostPerPersonUsd: 15,
          durationHours: 2,
        },
        {
          name: 'Cultural landmark tour',
          category: 'museums',
          description: `Visit the main cultural landmark or museum in ${ctx.destination}.`,
          groupUtilityScore: 45,
          estimatedCostPerPersonUsd: 20,
          durationHours: 3,
        },
      ],
      excluded: [],
    };
  }

  protected systemPrompt(): string {
    return `You are the TripSync Activity Planner agent. Your job is to propose a ranked list of activity candidates for a group trip.

RANKING RULES (strictly enforced):
1. Compute a group utility score for each activity: the mean of each member's relevant slider score (0-100).
   - Hiking/outdoors activities → mean of members' hiking scores
   - Nightlife → mean of nightlife scores
   - Museums/culture → mean of museums scores
   - Beaches/water → mean of beaches scores
   - Adventure sports → mean of adventure scores
   - Mixed/city activities → mean of the most relevant 2-3 slider scores
2. Sort candidates by groupUtilityScore descending.
3. HARD BLOCK: if any member has listed an activity in mustAvoidActivities, exclude it and list it in the "excluded" array with the reason.
4. Account for mobility limitations — flag activities as inaccessible if any member has mobility constraints that would prevent participation.
5. Apply chat nuance ONLY to break ties or add specificity; it cannot override a slider score.
6. Propose 5-8 candidates covering different categories. Include at least one lower-cost option.

COST GUIDANCE: use realistic estimates for the destination. Flag if actual pricing may vary.

OUTPUT: Return ONLY a valid JSON object matching this exact schema. No prose, no markdown fences:
{
  "agent": "activity",
  "candidates": [
    {
      "name": "string",
      "category": "hiking|nightlife|museums|beaches|adventure|mixed",
      "description": "2-3 sentence description",
      "groupUtilityScore": 0-100,
      "estimatedCostPerPersonUsd": number,
      "durationHours": number,
      "accessibilityNotes": "string or omit"
    }
  ],
  "excluded": [{ "name": "string", "reason": "string" }],
  "nuanceApplied": "brief note on how chat nuance influenced choices, or omit"
}`;
  }

  protected buildUserPrompt(ctx: PlanningContext): string {
    const groupScores = {
      hiking:    groupMean(activityScores(ctx.members, 'hiking')),
      nightlife: groupMean(activityScores(ctx.members, 'nightlife')),
      museums:   groupMean(activityScores(ctx.members, 'museums')),
      beaches:   groupMean(activityScores(ctx.members, 'beaches')),
      adventure: groupMean(activityScores(ctx.members, 'adventure')),
    };

    const mustAvoid = ctx.members
      .filter(m => m.constraints.mustAvoidActivities)
      .map(m => `${m.name}: ${m.constraints.mustAvoidActivities}`)
      .join('; ');

    const mobilityNotes = ctx.members
      .filter(m => m.constraints.mobilityLimitations)
      .map(m => `${m.name}: ${m.constraints.mobilityLimitations}`)
      .join('; ');

    return [
      contextSummary(ctx),
      '',
      'GROUP ACTIVITY UTILITY SCORES (use these to rank — do NOT deviate):',
      `  Hiking/outdoors: ${groupScores.hiking}`,
      `  Nightlife:       ${groupScores.nightlife}`,
      `  Museums/culture: ${groupScores.museums}`,
      `  Beaches/water:   ${groupScores.beaches}`,
      `  Adventure:       ${groupScores.adventure}`,
      '',
      mustAvoid ? `MUST-AVOID ACTIVITIES (hard block — exclude these): ${mustAvoid}` : '',
      mobilityNotes ? `MOBILITY CONSTRAINTS: ${mobilityNotes}` : '',
      '',
      'Propose a ranked activity shortlist for this group.',
    ].filter(l => l !== undefined).join('\n');
  }
}
