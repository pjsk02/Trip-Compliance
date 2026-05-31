import { z } from 'zod';
import { BaseAgent, contextSummary } from '../agent';
import {
  TransportationProposalSchema,
  type TransportationProposal,
  type PlanningContext,
  groupMean,
} from '../schemas';

export class TransportationAgent extends BaseAgent<TransportationProposal> {
  readonly name = 'transportation';

  protected schema(): z.ZodType<TransportationProposal> {
    return TransportationProposalSchema;
  }

  protected safeDefault(ctx: PlanningContext): TransportationProposal {
    const flightEstimate = Math.round((ctx.lockedBudget / ctx.groupSize) * 0.20);
    return {
      agent: 'transportation',
      legs: [
        {
          from: 'Origin city',
          to: ctx.destination,
          mode: 'flight',
          estimatedCostPerPersonUsd: flightEstimate,
          estimatedDurationHours: 4,
          notes: 'Estimated round-trip flight cost',
        },
      ],
      localTransportSummary: `Day-to-day transport in ${ctx.destination} via public transit, taxis, and walking.`,
      totalTransportCostPerPersonUsd: flightEstimate,
    };
  }

  protected systemPrompt(): string {
    return `You are the TripSync Transportation Planner agent. You create a transport plan covering:
1. Arrival leg (origin city / major hub → destination)
2. Departure leg (return)
3. Key intra-destination legs (airport transfers, intercity travel between sites)
4. A summary of local day-to-day transport

RULES:
1. If flightComfort score is high (≥70): prefer direct flights, business-friendly options.
   If low (≤40): budget carriers or ground transport is fine.
2. Prefer modes that fit group size — large groups (≥6) often need private transfers or vans.
3. Estimate costs realistically for the destination and group size. Mark estimates as per-person.
4. For mobility constraints: flag modes that may not be suitable and suggest alternatives.
5. Local transport summary: describe how the group gets around day-to-day (metro, tuk-tuk, rented scooters, walking, etc.) based on the destination.
6. totalTransportCostPerPersonUsd = sum of all leg costs per person.

CRITICAL — "mode" field rules:
- Each leg's "mode" must be EXACTLY ONE value from this closed list (no phrases, no slash-combos, no free text):
    flight | train | bus | ferry | taxi | rental_car | metro | walk | rideshare
- If you are unsure between two modes, pick the MOST LIKELY one and mention the alternative in "notes".
- WRONG: "ride-share or rental car"  "flight/train"  "bus or metro"  "taxi/rideshare"
- RIGHT: "rideshare"  "rental_car"  "flight"

Assume origin is a major international airport in the travellers' country unless destination implies otherwise.

OUTPUT: Return ONLY valid JSON. No prose, no markdown fences:
{
  "agent": "transportation",
  "legs": [
    {
      "from": "Boston Logan Airport",
      "to": "Rome Fiumicino Airport",
      "mode": "flight",
      "estimatedCostPerPersonUsd": 650,
      "estimatedDurationHours": 9.5,
      "notes": "Direct transatlantic flight; business class optional for high flightComfort"
    }
  ],
  "localTransportSummary": "2-3 sentence description of daily transport",
  "totalTransportCostPerPersonUsd": 800
}`;
  }

  protected buildUserPrompt(ctx: PlanningContext): string {
    const flightComfort = groupMean(ctx.members.map(m => m.scores.logistics.flightComfort));
    const budgetScore   = groupMean(ctx.members.map(m => m.scores.logistics.budgetConsciousness));

    const mobilityNotes = ctx.members
      .filter(m => m.constraints.mobilityLimitations)
      .map(m => `${m.name}: ${m.constraints.mobilityLimitations}`)
      .join('; ');

    const visaNotes = ctx.members
      .filter(m => m.constraints.visaRestrictions)
      .map(m => `${m.name}: ${m.constraints.visaRestrictions}`)
      .join('; ');

    return [
      contextSummary(ctx),
      '',
      'TRANSPORT SIGNALS:',
      `  Flight comfort preference: ${flightComfort}/100`,
      `  Budget-consciousness: ${budgetScore}/100`,
      `  Group size: ${ctx.groupSize} people`,
      mobilityNotes ? `  Mobility constraints: ${mobilityNotes}` : '',
      visaNotes     ? `  Visa notes: ${visaNotes}` : '',
      '',
      `Plan transport for a ${ctx.tripDuration}-night trip to ${ctx.destination} for ${ctx.groupSize} people.`,
    ].filter(Boolean).join('\n');
  }
}
