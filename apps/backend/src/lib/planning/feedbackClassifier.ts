/**
 * Feedback Classifier
 *
 * Uses Claude to map free-text member feedback → ClassifiedFeedback:
 *   - FeedbackType  (ACTIVITY_REWEIGHT | BUDGET_CUT | TRANSPORT_VETO | PREFERENCE_CHANGE)
 *   - targetAgent   (activity | budget | transportation | food)
 *   - structured adjustment payload
 */
import Anthropic from '@anthropic-ai/sdk';
import {
  ClassifiedFeedbackSchema,
  type ClassifiedFeedback,
  type MemberPreferenceSnapshot,
} from './schemas';

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

function model(): string {
  return process.env.CLAUDE_MODEL ?? 'claude-haiku-4-5-20251001';
}

const SYSTEM = `You are a TripSync feedback classifier. A group member has submitted free-text feedback about their trip itinerary.

Your job is to:
1. Identify the feedback type from these four options:
   - ACTIVITY_REWEIGHT: Member wants to change the mix of activity types (e.g. "more nightlife, less museums")
   - BUDGET_CUT: Member wants to reduce the per-person cost (e.g. "cut $200 per person", "too expensive")
   - TRANSPORT_VETO: Member cannot do a specific transport option — hard veto (e.g. "I can't do the 6am flight", "need a later train")
   - PREFERENCE_CHANGE: Member's personal preference has changed (e.g. "I'm now vegetarian", "I no longer drink alcohol")

2. Identify the target agent: activity | budget | transportation | food

3. Produce a structured adjustment payload.

OUTPUT RULES:
- Return ONLY valid JSON, no prose, no markdown.
- For ACTIVITY_REWEIGHT:
  { "type": "ACTIVITY_REWEIGHT", "boost": ["nightlife"], "reduce": ["museums"], "instruction": "Increase nightlife weight, reduce museum activities" }
  boost/reduce must be arrays of: hiking | nightlife | museums | beaches | adventure
- For BUDGET_CUT:
  { "type": "BUDGET_CUT", "cutPerPersonUsd": 200, "instruction": "Reduce per-person spend by $200 via cheaper alternatives" }
  Estimate cutPerPersonUsd from the text. If vague (e.g. "a bit cheaper"), use 50. If "much cheaper", use 150.
- For TRANSPORT_VETO:
  { "type": "TRANSPORT_VETO", "vetoDescription": "6am flight", "instruction": "Replace the 6am departure with a later option, even if slightly more expensive" }
- For PREFERENCE_CHANGE:
  { "type": "PREFERENCE_CHANGE", "memberId": "<id>", "memberName": "<name>", "changes": { "dietaryRestrictions": ["vegetarian"] }, "instruction": "Member is now vegetarian — re-run food planning with this constraint" }
  Only include "memberId" and "memberName" if the member context below identifies the submitter.
  For dietary changes, add to dietaryRestrictions. For alcohol, set alcoholPreference.

Full response format:
{
  "type": "ACTIVITY_REWEIGHT|BUDGET_CUT|TRANSPORT_VETO|PREFERENCE_CHANGE",
  "targetAgent": "activity|budget|transportation|food",
  "adjustment": { ... },
  "summary": "One sentence plain-English summary of what will change"
}`;

export async function classifyFeedback(
  rawText: string,
  submitter: Pick<MemberPreferenceSnapshot, 'memberId' | 'name'>,
): Promise<ClassifiedFeedback> {
  const userPrompt = [
    `Submitter: ${submitter.name} (id: ${submitter.memberId})`,
    `Feedback: "${rawText}"`,
  ].join('\n');

  const res = await getClient().messages.create({
    model: model(),
    max_tokens: 1000,
    system: SYSTEM,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const raw = res.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('');

  let parsed: unknown;
  try {
    const start = raw.search(/[{[]/);
    parsed = JSON.parse(start >= 0 ? raw.slice(start) : raw);
  } catch {
    throw new Error(`[feedbackClassifier] non-JSON response: ${raw.slice(0, 300)}`);
  }

  const result = ClassifiedFeedbackSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `[feedbackClassifier] schema validation failed: ${result.error.message}\nRaw: ${JSON.stringify(parsed).slice(0, 400)}`,
    );
  }

  return result.data;
}
