import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { PreferenceProfileSchema, type PreferenceProfile, type CategoryCoverage } from './preferenceSchema';

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

function model() {
  return process.env.CLAUDE_MODEL ?? 'claude-haiku-4-5-20251001';
}

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

export const CHAT_SYSTEM_PROMPT = `You are the TripSync AI Preference Agent. Your job is to have a warm,
friendly conversation with a traveler to learn their preferences for an upcoming group trip.

You MUST gather signal on all four categories before considering the conversation complete:
1. ACTIVITIES — hiking, nightlife, museums/culture, beaches, adventure sports
2. FOOD — street food vs fine dining, local cuisine, dietary restrictions, alcohol
3. LOGISTICS — flight comfort preferences, accommodation type (hotel/hostel/Airbnb), trip pace (relaxed vs packed), transport preferences
4. CONSTRAINTS — hard budget cap (collect the TOTAL budget in USD as a number), mobility limitations, schedule flexibility, visa/passport constraints, must-avoid items

CONVERSATION RULES:
- Ask one topic at a time. Never ask more than 2 questions per message.
- Be conversational, not clinical. React to what they say before asking the next thing.
- If they mention a number for budget, confirm it ("So roughly $X total for the trip including flights?").
- After you have signal on all four categories, pivot to the RATING PHASE:
  Present a SHORT list of the specific things they mentioned and ask them to rate each as:
  Must Have / Nice to Have / Neutral / Avoid
  Do this in one message — list all items and ask for ratings together.
- After they rate everything, confirm with a brief, warm summary and say you're done collecting.
  End your final message with exactly the token: [PREFERENCES_COMPLETE]

COVERAGE TRACKING (internal, never show to user):
Track which categories you have sufficient signal on. Only advance to rating phase when all 4 are covered.

Keep messages concise (2-4 sentences + question). Be warm and human, not robotic.`;

const EXTRACTION_SYSTEM_PROMPT = `You are a structured data extractor.
Given a chat conversation between a traveler and an AI agent, extract the traveler's preferences
into the exact JSON schema below. Output ONLY valid JSON — no prose, no markdown fences, no explanation.

SCHEMA:
{
  "scores": {
    "activities": {
      "hiking": 0-100,
      "nightlife": 0-100,
      "museums": 0-100,
      "beaches": 0-100,
      "adventure": 0-100
    },
    "food": {
      "streetFood": 0-100,
      "fineDining": 0-100,
      "localCuisine": 0-100,
      "dietary": { "<restriction>": 0-100 },
      "alcohol": 0-100
    },
    "logistics": {
      "flightComfort": 0-100,
      "accommodationType": { "hotel": 0-100, "hostel": 0-100, "airbnb": 0-100 },
      "pace": 0-100,
      "budgetSplit": 0-100,
      "transport": { "publicTransit": 0-100, "taxi": 0-100, "rental": 0-100 }
    },
    "constraints": {
      "hardBudgetCap": 0-100,
      "mobility": 0-100,
      "schedule": 0-100,
      "visa": 0-100
    }
  },
  "priorities": {
    "mustHave": ["string"],
    "niceToHave": ["string"],
    "neutral": ["string"],
    "avoid": ["string"]
  },
  "estimatedBudget": <number in USD or null>
}

SCORING GUIDE:
- 0 = hard avoid / strong dislike
- 25 = mild dislike / not preferred
- 50 = neutral / no strong opinion
- 75 = preferred / would enjoy
- 100 = must-have / deal-breaker if absent

If information for a dimension was not discussed, infer 50 (neutral).
If something was explicitly rated "Must Have" → 90-100. "Nice to Have" → 65-80. "Neutral" → 45-55. "Avoid" → 0-20.
Extract estimatedBudget as a number if the traveler mentioned a total dollar amount, otherwise null.`;

// ---------------------------------------------------------------------------
// Coverage detection — reads last assistant message for per-category signals
// ---------------------------------------------------------------------------

const COVERAGE_KEYWORDS: Record<keyof CategoryCoverage, string[]> = {
  activities: ['hik', 'nightlife', 'museum', 'beach', 'adventure', 'sport', 'outdoor', 'culture', 'sightseeing'],
  food: ['food', 'eat', 'dine', 'restaurant', 'diet', 'vegetarian', 'vegan', 'allerg', 'alcohol', 'drink', 'cuisine'],
  logistics: ['flight', 'hotel', 'hostel', 'airbnb', 'accommodation', 'pace', 'transport', 'budget', 'spend', 'cost', 'money', '$'],
  constraints: ['limit', 'mobility', 'wheelchair', 'visa', 'passport', 'schedule', 'must', 'avoid', 'cannot', "can't"],
};

export function detectCoverage(messages: MessageParam[]): CategoryCoverage {
  // Scan the full conversation for keyword presence
  const allText = messages
    .map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join(' ')
    .toLowerCase();

  return {
    activities:  COVERAGE_KEYWORDS.activities.some(k => allText.includes(k)),
    food:        COVERAGE_KEYWORDS.food.some(k => allText.includes(k)),
    logistics:   COVERAGE_KEYWORDS.logistics.some(k => allText.includes(k)),
    constraints: COVERAGE_KEYWORDS.constraints.some(k => allText.includes(k)),
  };
}

export function isComplete(coverage: CategoryCoverage): boolean {
  return Object.values(coverage).every(Boolean);
}

// ---------------------------------------------------------------------------
// Chat turn — appends user message, gets next assistant reply
// ---------------------------------------------------------------------------

export async function chatTurn(
  history: MessageParam[],
  userMessage: string,
  memberName: string,
  destination: string | null,
): Promise<{ reply: string; complete: boolean }> {
  const messages: MessageParam[] = [
    ...history,
    { role: 'user', content: userMessage },
  ];

  const systemWithContext = `${CHAT_SYSTEM_PROMPT}

Current trip context:
- Traveler name: ${memberName}
- Destination: ${destination ?? 'not yet decided'}`;

  const response = await client.messages.create({
    model: model(),
    max_tokens: 600,
    system: systemWithContext,
    messages,
  });

  const reply = response.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('');

  const complete = reply.includes('[PREFERENCES_COMPLETE]');
  // Strip the sentinel token before returning to the client
  const cleanReply = reply.replace('[PREFERENCES_COMPLETE]', '').trim();

  return { reply: cleanReply, complete };
}

// ---------------------------------------------------------------------------
// Extraction — converts full conversation into a validated PreferenceProfile
// ---------------------------------------------------------------------------

export async function extractPreferences(
  history: MessageParam[],
): Promise<PreferenceProfile> {
  const conversationText = history
    .map(m => {
      const role = m.role === 'user' ? 'Traveler' : 'Agent';
      const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return `${role}: ${text}`;
    })
    .join('\n\n');

  const response = await client.messages.create({
    model: model(),
    max_tokens: 1500,
    system: EXTRACTION_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Extract preferences from this conversation:\n\n${conversationText}`,
      },
    ],
  });

  const raw = response.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('');

  // Defensive parse — strip any accidental markdown fences
  const jsonText = raw
    .replace(/^```(?:json)?/m, '')
    .replace(/```$/m, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error(`Claude returned non-JSON output: ${raw.slice(0, 200)}`);
  }

  const result = PreferenceProfileSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Extracted JSON failed schema validation: ${result.error.message}`);
  }

  return result.data;
}
