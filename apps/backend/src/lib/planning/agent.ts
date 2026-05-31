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
 * Safe default: if both attempts fail and the agent implements safeDefault(),
 * the orchestrator continues with that fallback rather than white-screening.
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { PlanningContext } from './schemas';

// Lazy-init so the key is read after dotenv has loaded (important for tests).
let _anthropic: Anthropic | null = null;

export function getClient(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic();
  return _anthropic;
}

function model(): string {
  return process.env.CLAUDE_MODEL ?? 'claude-haiku-4-5-20251001';
}

/**
 * Extract the first complete JSON object from raw LLM output.
 *
 * Handles all three failure modes observed in production:
 *  1. Markdown code fences   (```json … ```)
 *  2. Leading prose before { (model ignores "no prose" instruction)
 *  3. Trailing text after }  ("Unexpected non-whitespace after JSON" error) ← primary fix
 *
 * Uses brace-depth tracking that respects string literals so nested {}
 * and escaped quotes inside strings are handled correctly.
 */
export function extractJsonObject(raw: string): string {
  // Strip markdown fences (handles ``` and ```json variants, anywhere in the string)
  let text = raw
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim();

  const start = text.indexOf('{');
  if (start === -1) return text; // no object — JSON.parse will fail with a useful message

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (inString) {
      if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }

    // Outside a string literal
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') { depth++; continue; }
    if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1); // found the matching close
    }
  }

  // Unbalanced braces — return from start to end; JSON.parse will surface the error
  return text.slice(start);
}

/** Attempt to parse and validate raw text. Returns the parsed value or an error descriptor. */
function parseAndValidate<T>(
  raw: string,
  schema: z.ZodType<T>,
  agentName: string,
): { data: T } | { error: string; rawJson: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(raw));
  } catch (e) {
    return {
      error: `JSON parse failed: ${(e as Error).message}`,
      rawJson: raw.slice(0, 500),
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

const REPAIR_SYSTEM = `You are a JSON repair assistant. The previous response from an AI agent contained invalid JSON or failed schema validation.
Your ONLY job is to return the corrected JSON — no prose, no markdown fences, just the raw JSON object.`;

export abstract class BaseAgent<TProposal> {
  abstract readonly name: string;

  protected abstract systemPrompt(): string;
  protected abstract buildUserPrompt(ctx: PlanningContext): string;
  protected abstract schema(): z.ZodType<TProposal>;

  /**
   * Return a minimal valid proposal used as a last-resort fallback when both
   * LLM attempts fail. Return null to let the error propagate (preserves old
   * behaviour). Override in agents where a safe stub is better than a crash.
   */
  protected safeDefault(_ctx: PlanningContext): TProposal | null {
    return null;
  }

  async propose(ctx: PlanningContext): Promise<TProposal> {
    // ── Attempt 1: normal call ─────────────────────────────────────────────
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

    // ── Attempt 2: repair prompt ───────────────────────────────────────────
    // Feed Claude its own bad output + the specific validation error so it
    // can correct just the structural/schema issues.
    const repairPrompt = [
      `The "${this.name}" agent returned invalid output.`,
      ``,
      `VALIDATION ERROR: ${attempt1.error}`,
      ``,
      `BAD OUTPUT (truncated):`,
      attempt1.rawJson,
      ``,
      `Return ONLY the corrected JSON object — no prose, no fences.`,
      `Required schema:`,
      this.systemPrompt().slice(0, 1000),
    ].join('\n');

    let raw2 = '';
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
    } catch (repairErr) {
      console.error(`[${this.name}] Repair call failed:`, repairErr);
    }

    const attempt2 = parseAndValidate(raw2, this.schema(), this.name);
    if ('data' in attempt2) return attempt2.data;

    // ── Both failed — try safe default before throwing ─────────────────────
    const fallback = this.safeDefault(ctx);
    if (fallback !== null) {
      console.error(
        `[${this.name}] Both parse attempts failed — using safe default.\n` +
        `  Attempt 1: ${attempt1.error}\n` +
        `  Attempt 2: ${attempt2.error}`,
      );
      return fallback;
    }

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
