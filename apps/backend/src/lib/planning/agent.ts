/**
 * Base Agent abstraction.
 *
 * Each concrete agent:
 *  1. Defines a system prompt that encodes its domain expertise.
 *  2. Builds a user prompt from the PlanningContext.
 *  3. Calls Claude and parses the response as strictly-typed JSON.
 *
 * Retry policy: on JSON parse failure or schema validation failure,
 * sends a "repair prompt" back to Claude with the bad output and the
 * validation error, then tries once more. Max 2 attempts total.
 *
 * The `propose()` method is the single public surface.
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { PlanningContext } from './schemas';

// Lazy-init so the key is read after dotenv has loaded (important for tests).
let _anthropic: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic();
  return _anthropic;
}

function model(): string {
  return process.env.CLAUDE_MODEL ?? 'claude-haiku-4-5-20251001';
}

/** Strip markdown fences and extract first complete JSON object/array. */
function stripFences(raw: string): string {
  let text = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  const start = text.search(/[{[]/);
  if (start > 0) text = text.slice(start);
  return text;
}

/** Attempt to parse and validate raw text. Returns the parsed value or throws with a clear message. */
function parseAndValidate<T>(
  raw: string,
  schema: z.ZodType<T>,
  agentName: string,
): { data: T } | { error: string; rawJson: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch (e) {
    return {
      error: `JSON parse failed: ${(e as Error).message}`,
      rawJson: raw.slice(0, 400),
    };
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    return {
      error: `Schema validation failed: ${result.error.message}`,
      rawJson: JSON.stringify(parsed).slice(0, 600),
    };
  }

  return { data: result.data };
}

const REPAIR_SYSTEM = `You are a JSON repair assistant. The previous response from an AI agent contained invalid JSON or failed schema validation. Your ONLY job is to return the corrected JSON — no prose, no markdown fences, just the raw JSON object.`;

export abstract class BaseAgent<TProposal> {
  abstract readonly name: string;

  protected abstract systemPrompt(): string;
  protected abstract buildUserPrompt(ctx: PlanningContext): string;
  protected abstract schema(): z.ZodType<TProposal>;

  async propose(ctx: PlanningContext): Promise<TProposal> {
    // Attempt 1: normal call
    const response = await getClient().messages.create({
      model: model(),
      max_tokens: 4000,
      system: this.systemPrompt(),
      messages: [{ role: 'user', content: this.buildUserPrompt(ctx) }],
    });

    const raw1 = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('');

    const attempt1 = parseAndValidate(raw1, this.schema(), this.name);
    if ('data' in attempt1) return attempt1.data;

    // Attempt 2: repair prompt — feed Claude its own bad output + the error
    const repairPrompt = [
      `The following JSON output from the "${this.name}" agent is invalid:`,
      ``,
      `ERROR: ${attempt1.error}`,
      ``,
      `INVALID OUTPUT (truncated):`,
      attempt1.rawJson,
      ``,
      `Fix only the structural/schema issues. Return ONLY the corrected JSON object — no prose, no fences.`,
      `Required schema for agent "${this.name}":`,
      this.systemPrompt().slice(0, 800),
    ].join('\n');

    let raw2: string;
    try {
      const repair = await getClient().messages.create({
        model: model(),
        max_tokens: 4000,
        system: REPAIR_SYSTEM,
        messages: [{ role: 'user', content: repairPrompt }],
      });
      raw2 = repair.content
        .filter(b => b.type === 'text')
        .map(b => (b as { type: 'text'; text: string }).text)
        .join('');
    } catch {
      // If the repair call itself fails, surface the original error
      throw new Error(
        `[${this.name}] Attempt 1 failed and repair call errored.\n` +
        `Original error: ${attempt1.error}\nRaw: ${attempt1.rawJson}`,
      );
    }

    const attempt2 = parseAndValidate(raw2, this.schema(), this.name);
    if ('data' in attempt2) return attempt2.data;

    // Both attempts failed — throw with full context
    throw new Error(
      `[${this.name}] Both parse attempts failed.\n` +
      `Attempt 1: ${attempt1.error}\n` +
      `Attempt 2: ${attempt2.error}\n` +
      `Last raw output: ${attempt2.rawJson}`,
    );
  }
}

/** Serialise the PlanningContext into a compact summary string for prompts. */
export function contextSummary(ctx: PlanningContext): string {
  const perPersonBudget = Math.round(ctx.lockedBudget / ctx.groupSize);
  const memberLines = ctx.members.map(m => {
    const a = m.scores.activities;
    const f = m.scores.food;
    const l = m.scores.logistics;
    const c = m.constraints;
    const dietary = c.dietaryRestrictions.length
      ? c.dietaryRestrictions.join(', ')
      : 'none';
    return [
      `  ${m.name}:`,
      `    activities — hiking:${a.hiking} nightlife:${a.nightlife} museums:${a.museums} beaches:${a.beaches} adventure:${a.adventure}`,
      `    food — streetFood:${f.streetFood} fineDining:${f.fineDining} localCuisine:${f.localCuisine}`,
      `    logistics — pace:${l.pace} flightComfort:${l.flightComfort} budgetConsciousness:${l.budgetConsciousness}`,
      `    dietary: ${dietary}  alcohol: ${c.alcoholPreference}`,
      c.mobilityLimitations ? `    mobility: ${c.mobilityLimitations}` : '',
      c.mustAvoidActivities ? `    mustAvoid: ${c.mustAvoidActivities}` : '',
      m.chatNuance ? `    nuance: ${m.chatNuance}` : '',
    ].filter(Boolean).join('\n');
  });

  return [
    `Destination: ${ctx.destination}`,
    `Duration: ${ctx.tripDuration} nights`,
    `Group size: ${ctx.groupSize} people`,
    `Locked budget: $${ctx.lockedBudget} total ($${perPersonBudget}/person)`,
    `NOTE: Use ESTIMATES only — no live pricing APIs. Build in realistic variance.`,
    `Member preferences (scores 0-100):`,
    ...memberLines,
  ].join('\n');
}
