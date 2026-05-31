import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

function model() {
  return process.env.CLAUDE_MODEL ?? 'claude-haiku-4-5-20251001';
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BudgetInput {
  /** Private individual budgets — NEVER returned to the client. */
  privateBudgets: number[];
  /** Live member count — always use group.members.length at call time. */
  groupSize: number;
  destination: string | null;
  tripName: string;
  /** Hard caps submitted by members (from constraint fields). */
  hardCaps: number[];
  /** budgetConsciousness slider averages (0-100). Higher = more budget-conscious. */
  avgBudgetConsciousness: number;
}

export interface BudgetAnalysis {
  /** Computed in code from sorted privateBudgets — authoritative. */
  median: number;
  min: number;
  max: number;
  /** Recommended group total in USD — authoritative, set by code after LLM suggests a raw figure. */
  proposed: number;
  /** Per-person = proposed / groupSize — always computed in code, never from LLM. */
  perPerson: number;
  rationale: string;
  /** Short plain-English summary shown in the group chat bubble.
   *  Dollar figures in this string are injected by code after the LLM responds —
   *  the LLM writes {{TOTAL}} and {{PER_PERSON}} placeholders which we replace. */
  summary: string;
  strategy: 'consensus' | 'tiered' | 'scope_reduction';
  /** Only present when strategy === 'tiered'. */
  tierSplit?: {
    highTier: { label: string; amount: number };
    lowTier:  { label: string; amount: number };
    rationale: string;
  };
}

export interface ReproposeInput {
  currentProposed: number;
  /** Pushback comments collected from REJECT votes. */
  rejectComments: string[];
  previousStrategy: BudgetAnalysis['strategy'];
  budgetInput: BudgetInput;
  roundNum: number;
}

// ---------------------------------------------------------------------------
// Stats helpers (all computed in code — never from LLM)
// ---------------------------------------------------------------------------

function computeStats(privateBudgets: number[]) {
  const sorted = [...privateBudgets].sort((a, b) => a - b);
  const n = sorted.length;
  const median = n % 2 === 0
    ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    : sorted[Math.floor(n / 2)];
  return { sorted, median, min: sorted[0] ?? 0, max: sorted[n - 1] ?? 0 };
}

/**
 * Round a proposed total to the nearest $50 and ensure it divides evenly
 * by groupSize so the per-person figure is a clean integer.
 * This keeps the card and narrative consistent without any LLM math.
 */
function roundToCleanPerPerson(rawProposed: number, groupSize: number): number {
  const perPersonRaw = rawProposed / groupSize;
  const perPersonRounded = Math.round(perPersonRaw / 50) * 50 || 50;
  return perPersonRounded * groupSize;
}

/**
 * Replace {{TOTAL}} and {{PER_PERSON}} placeholders in the LLM's summary
 * with the authoritative computed values.
 * If the LLM ignored placeholders and wrote its own dollar figures, detect
 * mismatches and fall back to a safe template.
 */
function reconcileSummary(
  rawSummary: string,
  proposed: number,
  perPerson: number,
  roundNum: number,
): string {
  const fmt = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

  // Replace placeholders first (approach a)
  let summary = rawSummary
    .replace(/\{\{TOTAL\}\}/g, fmt(proposed))
    .replace(/\{\{PER_PERSON\}\}/g, fmt(perPerson));

  // Scan for any dollar figure the LLM may have invented.
  // A "dollar figure" is $N,NNN or $NNN (integers only, 3+ digits or with commas).
  const dollarPattern = /\$[\d,]+/g;
  const authoritative = new Set([fmt(proposed), fmt(perPerson)]);
  const found = summary.match(dollarPattern) ?? [];
  const stray = found.filter(f => !authoritative.has(f));

  if (stray.length > 0) {
    // LLM invented different numbers — fall back to a safe template
    const prefix = roundNum === 1
      ? `Based on everyone's budgets, I'm proposing`
      : `After reviewing your feedback, I'm proposing`;
    summary = `${prefix} ${fmt(proposed)} total (${fmt(perPerson)} per person).`;
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const ANALYSIS_SYSTEM = `You are TripSync Budget Bot — a friendly, pragmatic travel budget mediator.
Your job is to analyse a group's private travel budgets and propose a fair group total.

PRIVACY RULE (critical): Never reveal any individual's budget number. Use only aggregate language.

IMPORTANT — numbers in your response:
- You will be given the AUTHORITATIVE computed values: proposed_total, per_person, median, min, max.
- You MUST use ONLY those exact values. Do NOT invent, round, or paraphrase them with different figures.
- In the "summary" field, write ONLY the placeholders {{TOTAL}} and {{PER_PERSON}} where you would
  mention the total and per-person amounts. The system will substitute the real numbers after you respond.
  Example summary: "Based on everyone's budgets, I'm proposing {{TOTAL}} total ({{PER_PERSON}} per person)."
- In the "rationale" field you may reference the range (min/max) and median by their given values only.

OUTPUT: Return ONLY valid JSON (no prose, no fences):
{
  "rationale": "2-3 sentence explanation — aggregate only, no individual reveals, use only the given stats",
  "summary": "1 friendly sentence using ONLY {{TOTAL}} and {{PER_PERSON}} placeholders for amounts",
  "strategy": "consensus" | "tiered" | "scope_reduction",
  "tierSplit": null | {
    "highTier": { "label": "Higher-budget travelers", "amount": <number from given figures only> },
    "lowTier":  { "label": "Lower-budget travelers",  "amount": <number from given figures only> },
    "rationale": "1 sentence"
  }
}

STRATEGY GUIDE:
- "consensus": budgets are close (within ~30%). Propose the median or just-below-max.
- "tiered": budgets are spread but a 2-tier split works. Propose the blended total.
- "scope_reduction": budgets are far apart. Propose a number at the lower end and note scope adjustments.

tierSplit is ONLY populated when strategy is "tiered", otherwise null.`;

const REPROPOSE_SYSTEM = `You are TripSync Budget Bot. The group rejected your previous proposal.
Read the pushback comments and write a revised narrative.

PRIVACY RULE: Never reveal any individual member's private budget.

IMPORTANT — numbers in your response:
- The system has already computed the new authoritative figures: proposed_total, per_person, median, min, max.
- You MUST use ONLY those exact values. Do NOT invent different numbers.
- In "summary", use ONLY the placeholders {{TOTAL}} and {{PER_PERSON}}.
- Acknowledge the pushback warmly: "I hear you — let me try something different."

OUTPUT: Return ONLY valid JSON (same schema, no prose, no fences).

Strategy progression:
- Round 2 with "consensus": try tiered split if spread is wide, else scope_reduction.
- Round 2+ with "tiered": try scope_reduction.
- Round 3+: always scope_reduction with a clear explanation of what gets cut.`;

// ---------------------------------------------------------------------------
// analyze — first-round budget analysis
// ---------------------------------------------------------------------------

export async function analyzeBudgets(input: BudgetInput): Promise<BudgetAnalysis> {
  const { sorted, median, min, max } = computeStats(input.privateBudgets);
  const proposed = roundToCleanPerPerson(
    // Start from median as the raw candidate; LLM will confirm or adjust via strategy
    median * input.groupSize,
    input.groupSize,
  );
  const perPerson = proposed / input.groupSize;

  const prompt = `
Trip: "${input.tripName}"${input.destination ? ` to ${input.destination}` : ''}
Group size: ${input.groupSize} people
Individual budgets (sorted per-person, USD): ${sorted.map(b => `$${b}`).join(', ')}
Hard caps: ${input.hardCaps.length ? input.hardCaps.map(c => `$${c}`).join(', ') : 'none'}
Avg budget-consciousness: ${input.avgBudgetConsciousness}/100

AUTHORITATIVE computed figures — use these exact values, do not invent alternatives:
  median per-person = $${median}
  min per-person = $${min}
  max per-person = $${max}
  proposed group total = $${proposed}  ← the amount you are proposing
  per person = $${perPerson}

Write only the rationale, summary (with {{TOTAL}}/{{PER_PERSON}} placeholders), strategy, and tierSplit.`.trim();

  const response = await client.messages.create({
    model: model(),
    max_tokens: 600,
    system: ANALYSIS_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  });

  return buildAnalysis(response, { median, min, max, proposed, perPerson }, 1);
}

// ---------------------------------------------------------------------------
// repropose — subsequent rounds after rejection
// ---------------------------------------------------------------------------

export async function reproposeBudget(input: ReproposeInput): Promise<BudgetAnalysis> {
  const { sorted, median, min, max } = computeStats(input.budgetInput.privateBudgets);

  // For a reproposal, allow the LLM to conceptually nudge direction, but we
  // compute the authoritative new proposed figure in code:
  // - If previous strategy was consensus, step down toward min.
  // - If tiered, try scope_reduction by moving 10% toward min.
  // - scope_reduction: step further toward min (capped at min * groupSize).
  const groupSize = input.budgetInput.groupSize;
  let rawCandidate: number;
  if (input.previousStrategy === 'consensus') {
    rawCandidate = ((median + min) / 2) * groupSize;
  } else {
    const step = (input.currentProposed - min * groupSize) * 0.2;
    rawCandidate = Math.max(input.currentProposed - step, min * groupSize);
  }
  const proposed = roundToCleanPerPerson(rawCandidate, groupSize);
  const perPerson = proposed / groupSize;

  const comments = input.rejectComments.length
    ? input.rejectComments.map((c, i) => `Member ${i + 1}: "${c}"`).join('\n')
    : 'No specific comments provided.';

  const prompt = `
Trip: "${input.budgetInput.tripName}"${input.budgetInput.destination ? ` to ${input.budgetInput.destination}` : ''}
Group size: ${groupSize}
Previous proposal: $${input.currentProposed} (strategy: ${input.previousStrategy})
This is round ${input.roundNum}.

Rejection feedback (anonymised):
${comments}

Individual budgets (sorted per-person, USD): ${sorted.map(b => `$${b}`).join(', ')}

AUTHORITATIVE computed figures — use these exact values:
  median per-person = $${median}
  min per-person = $${min}
  max per-person = $${max}
  new proposed group total = $${proposed}
  per person = $${perPerson}

Write only rationale, summary ({{TOTAL}}/{{PER_PERSON}} placeholders), strategy, and tierSplit.`.trim();

  const response = await client.messages.create({
    model: model(),
    max_tokens: 600,
    system: REPROPOSE_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  });

  return buildAnalysis(response, { median, min, max, proposed, perPerson }, input.roundNum);
}

// ---------------------------------------------------------------------------
// buildAnalysis — parse LLM response, enforce authoritative numbers
// ---------------------------------------------------------------------------

function buildAnalysis(
  response: Anthropic.Message,
  authoritative: { median: number; min: number; max: number; proposed: number; perPerson: number },
  roundNum: number,
): BudgetAnalysis {
  const raw = response.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('');

  const jsonText = raw.replace(/^```(?:json)?/m, '').replace(/```$/m, '').trim();

  let parsed: Partial<{ rationale: string; summary: string; strategy: string; tierSplit: unknown }> = {};
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    // ignore — defaults below handle it
  }

  const { median, min, max, proposed, perPerson } = authoritative;

  const rawSummary = typeof parsed.summary === 'string' && parsed.summary.length > 0
    ? parsed.summary
    : `Based on everyone's budgets, I'm proposing {{TOTAL}} total ({{PER_PERSON}} per person).`;

  const summary = reconcileSummary(rawSummary, proposed, perPerson, roundNum);

  const rationale = typeof parsed.rationale === 'string' && parsed.rationale.length > 0
    ? parsed.rationale
    : 'Based on the group\'s budgets, this proposal aims to balance everyone\'s comfort.';

  const strategy = (['consensus', 'tiered', 'scope_reduction'] as const).find(
    s => s === parsed.strategy,
  ) ?? 'consensus';

  const tierSplit = strategy === 'tiered' && parsed.tierSplit != null
    ? (parsed.tierSplit as BudgetAnalysis['tierSplit'])
    : undefined;

  return { median, min, max, proposed, perPerson, rationale, summary, strategy, tierSplit };
}
