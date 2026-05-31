import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import {
  PreferenceProfileSchema,
  type PreferenceProfile,
  type CategoryCoverage,
  type SliderValues,
  type ConstraintFields,
} from './preferenceSchema';

const client = new Anthropic();

function model() {
  return process.env.CLAUDE_MODEL ?? 'claude-haiku-4-5-20251001';
}

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

// The chat now plays a NARROWER role: the member already set sliders for all
// quantified dimensions. The AI's job is only to ask clarifying follow-ups
// where sliders are ambiguous and to capture free-text nuance.
function buildChatSystemPrompt(
  sliders: SliderValues,
  constraints: ConstraintFields,
): string {
  const sliderSummary = `
Member's slider ratings (1-10 scale, shown as 0-100):
Activities: Hiking ${sliders.activities.hiking}, Nightlife ${sliders.activities.nightlife}, Museums ${sliders.activities.museums}, Beaches ${sliders.activities.beaches}, Adventure Sports ${sliders.activities.adventure}
Food: Street Food ${sliders.food.streetFood}, Fine Dining ${sliders.food.fineDining}, Local Cuisine ${sliders.food.localCuisine}
Logistics: Pace ${sliders.logistics.pace} (0=relaxed, 100=packed), Flight Comfort ${sliders.logistics.flightComfort}, Budget-Conscious ${sliders.logistics.budgetConsciousness}

Categorical fields:
- Dietary restrictions: ${constraints.dietaryRestrictions.length ? constraints.dietaryRestrictions.join(', ') : 'none'}${constraints.dietaryOther ? ` + ${constraints.dietaryOther}` : ''}
- Alcohol: ${constraints.alcoholPreference}
- Hard budget cap: ${constraints.hardBudgetCap ? `$${constraints.hardBudgetCap}` : 'not set'}
- Total budget: ${constraints.totalBudget ? `$${constraints.totalBudget}` : 'not set'}
- Mobility limitations: ${constraints.mobilityLimitations || 'none'}
- Schedule restrictions: ${constraints.scheduleRestrictions || 'none'}
- Visa restrictions: ${constraints.visaRestrictions || 'none'}
- Must-avoid activities: ${constraints.mustAvoidActivities || 'none'}`;

  return `You are the TripSync AI Preference Agent. The member has already set all their preferences via sliders and form fields. Here is what they submitted:

${sliderSummary}

YOUR NARROWER ROLE:
The sliders capture the quantitative ratings. Your ONLY job now is to:
1. Ask 1-3 targeted follow-up questions where the slider ratings suggest ambiguity or interesting nuance worth capturing. Examples:
   - If nightlife is rated high (≥70) AND adventure sports is low (≤30): "You're into nightlife but not adventure sports — are you thinking more about bars and clubs, or live music and events?"
   - If pace is very high (≥80): "You prefer a packed itinerary — do you like having every hour planned, or more spontaneous-but-busy days?"
   - If fine dining is high (≥70) AND street food is also high (≥70): "You enjoy both fine dining and street food — how do you like to balance them on a trip?"
   - If dietary restrictions exist: "Any restaurants or cuisines that are completely off-limits given your dietary needs?"
   - If must-avoid activities is filled: "Tell me more about what you'd like to skip — is there a reason, or just personal preference?"
2. Capture any nuance the sliders can't express (specific preferences, context, memorable past trips).
3. DO NOT ask the member to re-rate anything — sliders already captured that.
4. DO NOT ask about budget amounts — those came from the form.
5. Keep the conversation SHORT — 2 to 4 exchanges total, then wrap up.

When you have enough nuance (or after 4 exchanges), end your message with exactly: [PREFERENCES_COMPLETE]

Start with a warm acknowledgement of their settings, then ask your most useful clarifying question. Be conversational and concise (2-4 sentences per message).`;
}

const NUANCE_EXTRACTION_PROMPT = `You are a structured data extractor. Given a clarifying chat conversation, extract any preference nuance NOT already captured by slider values.

Output ONLY a single JSON object — no prose, no markdown fences:
{
  "chatNuance": "<one paragraph summarising the nuance captured in the conversation, or empty string if nothing noteworthy>",
  "priorityOverrides": {
    "mustHave": ["string"],
    "niceToHave": ["string"],
    "neutral": ["string"],
    "avoid": ["string"]
  }
}

priorityOverrides should only contain items that the chat explicitly revealed override the slider-derived priorities. If the chat added nothing beyond the sliders, return empty arrays. chatNuance should be 1-2 sentences capturing the most useful qualitative context.`;

// Legacy extraction prompt — used when no sliders are available (old flow)
const EXTRACTION_SYSTEM_PROMPT = `You are a structured data extractor.
Given a chat conversation between a traveler and an AI agent, extract the traveler's preferences
into the exact JSON schema below. Output ONLY valid JSON — no prose, no markdown fences, no explanation.

SCHEMA:
{
  "scores": {
    "activities": { "hiking": 0-100, "nightlife": 0-100, "museums": 0-100, "beaches": 0-100, "adventure": 0-100 },
    "food": { "streetFood": 0-100, "fineDining": 0-100, "localCuisine": 0-100, "dietary": {}, "alcohol": 0-100 },
    "logistics": { "flightComfort": 0-100, "accommodationType": {}, "pace": 0-100, "budgetSplit": 0-100, "transport": {}, "budgetConsciousness": 50 },
    "constraints": { "hardBudgetCap": 0-100, "mobility": 0-100, "schedule": 0-100, "visa": 0-100 }
  },
  "priorities": { "mustHave": [], "niceToHave": [], "neutral": [], "avoid": [] },
  "estimatedBudget": null
}

If information was not discussed, infer 50 (neutral). "Must Have" → 90-100. "Nice to Have" → 65-80. "Neutral" → 45-55. "Avoid" → 0-20.`;

// ---------------------------------------------------------------------------
// Coverage detection — kept for the legacy pure-chat flow
// ---------------------------------------------------------------------------

const COVERAGE_KEYWORDS: Record<keyof CategoryCoverage, string[]> = {
  activities:  ['hik', 'nightlife', 'museum', 'beach', 'adventure', 'sport', 'outdoor', 'culture'],
  food:        ['food', 'eat', 'dine', 'restaurant', 'diet', 'vegetarian', 'vegan', 'allerg', 'alcohol', 'cuisine'],
  logistics:   ['flight', 'hotel', 'hostel', 'airbnb', 'accommodation', 'pace', 'budget', 'spend', '$'],
  constraints: ['limit', 'mobility', 'visa', 'passport', 'schedule', 'must', 'avoid', 'cannot'],
};

export function detectCoverage(messages: MessageParam[]): CategoryCoverage {
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
// Hybrid chat turn — AI asks clarifying questions given the slider context
// ---------------------------------------------------------------------------

export async function chatTurn(
  history: MessageParam[],
  userMessage: string,
  memberName: string,
  destination: string | null,
  sliders?: SliderValues,
  constraints?: ConstraintFields,
): Promise<{ reply: string; complete: boolean }> {
  const messages: MessageParam[] = [
    ...history,
    { role: 'user', content: userMessage },
  ];

  const systemPrompt = sliders && constraints
    ? buildChatSystemPrompt(sliders, constraints)
    : `You are the TripSync AI Preference Agent gathering travel preferences for ${memberName}. Trip destination: ${destination ?? 'TBD'}. Ask about activities, food, logistics, and constraints. End with [PREFERENCES_COMPLETE] when done.`;

  const systemWithContext = sliders && constraints
    ? `${systemPrompt}\n\nTraveler name: ${memberName}\nDestination: ${destination ?? 'not yet decided'}`
    : systemPrompt;

  const response = await client.messages.create({
    model: model(),
    max_tokens: 500,
    system: systemWithContext,
    messages,
  });

  const reply = response.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('');

  const complete = reply.includes('[PREFERENCES_COMPLETE]');
  const cleanReply = reply.replace('[PREFERENCES_COMPLETE]', '').trim();

  return { reply: cleanReply, complete };
}

// ---------------------------------------------------------------------------
// Nuance extraction — extracts chat nuance + priority overrides from the
// clarifying chat, given that sliders already set the base scores.
// ---------------------------------------------------------------------------

export async function extractChatNuance(
  history: MessageParam[],
): Promise<{ chatNuance: string; priorityOverrides: { mustHave: string[]; niceToHave: string[]; neutral: string[]; avoid: string[] } }> {
  if (history.length === 0) {
    return { chatNuance: '', priorityOverrides: { mustHave: [], niceToHave: [], neutral: [], avoid: [] } };
  }

  const conversationText = history
    .map(m => {
      const role = m.role === 'user' ? 'Traveler' : 'Agent';
      const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return `${role}: ${text}`;
    })
    .join('\n\n');

  const response = await client.messages.create({
    model: model(),
    max_tokens: 600,
    system: NUANCE_EXTRACTION_PROMPT,
    messages: [{ role: 'user', content: `Extract nuance from:\n\n${conversationText}` }],
  });

  const raw = response.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('');

  const jsonText = raw.replace(/^```(?:json)?/m, '').replace(/```$/m, '').trim();

  try {
    const parsed = JSON.parse(jsonText);
    return {
      chatNuance: parsed.chatNuance ?? '',
      priorityOverrides: parsed.priorityOverrides ?? { mustHave: [], niceToHave: [], neutral: [], avoid: [] },
    };
  } catch {
    return { chatNuance: '', priorityOverrides: { mustHave: [], niceToHave: [], neutral: [], avoid: [] } };
  }
}

// ---------------------------------------------------------------------------
// Legacy extraction — full chat → structured profile (used when no sliders)
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
    messages: [{ role: 'user', content: `Extract preferences from:\n\n${conversationText}` }],
  });

  const raw = response.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('');

  const jsonText = raw.replace(/^```(?:json)?/m, '').replace(/```$/m, '').trim();

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
