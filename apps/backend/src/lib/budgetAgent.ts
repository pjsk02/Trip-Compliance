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
  groupSize: number;
  destination: string | null;
  tripName: string;
  /** Hard caps submitted by members (from constraint fields). */
  hardCaps: number[];
  /** budgetConsciousness slider averages (0-100). Higher = more budget-conscious. */
  avgBudgetConsciousness: number;
}

export interface BudgetAnalysis {
  median: number;
  min: number;
  max: number;
  /** Recommended group total in USD. */
  proposed: number;
  rationale: string;
  /** Short plain-English summary shown in the group chat bubble. */
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
// Prompts
// ---------------------------------------------------------------------------

const ANALYSIS_SYSTEM = `You are TripSync Budget Bot — a friendly, pragmatic travel budget mediator.
Your job is to analyse a group's private travel budgets and propose a fair group total.

PRIVACY RULE (critical): You NEVER reveal any individual's budget number. You only describe the range
and recommend a group total. Do not say "one person said $X" — only use aggregate language.

OUTPUT: Return ONLY valid JSON matching this schema (no prose, no fences):
{
  "median": number,
  "min": number,
  "max": number,
  "proposed": number,
  "rationale": "2-3 sentence explanation of the proposed number — aggregate only, no individual reveals",
  "summary": "1 friendly sentence for the group chat, e.g. 'Based on everyone's budgets, I'm proposing $4,200 total.'",
  "strategy": "consensus" | "tiered" | "scope_reduction",
  "tierSplit": null | {
    "highTier": { "label": "Higher-budget travelers", "amount": number },
    "lowTier":  { "label": "Lower-budget travelers",  "amount": number },
    "rationale": "1 sentence"
  }
}

STRATEGY GUIDE:
- "consensus": budgets are close (within ~30%). Propose the median or just-below-max.
- "tiered": budgets are spread but a 2-tier split (some pay more, some pay less) works. Propose the blended total.
- "scope_reduction": budgets are far apart. Propose a number at the lower end and note what scope adjustments that might require.

tierSplit is ONLY populated when strategy is "tiered", otherwise null.`;

const REPROPOSE_SYSTEM = `You are TripSync Budget Bot. The group rejected your previous proposal.
Read the pushback comments and propose a revised number.

PRIVACY RULE: Never reveal any individual member's private budget.

OUTPUT: Return ONLY valid JSON (same schema as analysis, no prose, no fences).

When re-proposing:
- Round 2 with "consensus": try tiered split if spread is wide, else scope_reduction.
- Round 2+ with "tiered": try scope_reduction.
- Round 3+: always scope_reduction with a clear explanation of what gets cut.
- The summary should acknowledge the pushback warmly: "I hear you — let me try something different."`;

// ---------------------------------------------------------------------------
// analyze — first-round budget analysis
// ---------------------------------------------------------------------------

export async function analyzeBudgets(input: BudgetInput): Promise<BudgetAnalysis> {
  const sorted = [...input.privateBudgets].sort((a, b) => a - b);
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];
  const min = sorted[0] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;

  const prompt = `
Trip: "${input.tripName}"${input.destination ? ` to ${input.destination}` : ''}
Group size: ${input.groupSize} people
Individual budgets (sorted, USD total per person): ${sorted.map(b => `$${b}`).join(', ')}
Hard caps from members: ${input.hardCaps.length ? input.hardCaps.map(c => `$${c}`).join(', ') : 'none'}
Average budget-consciousness score: ${input.avgBudgetConsciousness}/100 (higher = more cost-sensitive)

Computed: median=$${median}, min=$${min}, max=$${max}

Propose a fair group total budget in USD and explain your reasoning.`.trim();

  const response = await client.messages.create({
    model: model(),
    max_tokens: 600,
    system: ANALYSIS_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  });

  return parseAnalysisResponse(response, median, min, max);
}

// ---------------------------------------------------------------------------
// repropose — subsequent rounds after rejection
// ---------------------------------------------------------------------------

export async function reproposeBudget(input: ReproposeInput): Promise<BudgetAnalysis> {
  const sorted = [...input.budgetInput.privateBudgets].sort((a, b) => a - b);
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];
  const min = sorted[0] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;

  const comments = input.rejectComments.length
    ? input.rejectComments.map((c, i) => `Member ${i + 1}: "${c}"`).join('\n')
    : 'No specific comments provided.';

  const prompt = `
Trip: "${input.budgetInput.tripName}"${input.budgetInput.destination ? ` to ${input.budgetInput.destination}` : ''}
Group size: ${input.budgetInput.groupSize}
Previous proposal: $${input.currentProposed} (strategy: ${input.previousStrategy})
This is round ${input.roundNum} of negotiation.

Rejection comments from members (anonymised):
${comments}

Individual budgets (sorted, USD): ${sorted.map(b => `$${b}`).join(', ')}
Computed: median=$${median}, min=$${min}, max=$${max}

Propose a revised group budget that addresses the pushback.`.trim();

  const response = await client.messages.create({
    model: model(),
    max_tokens: 600,
    system: REPROPOSE_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  });

  return parseAnalysisResponse(response, median, min, max);
}

// ---------------------------------------------------------------------------
// Helper — parse Claude's JSON response
// ---------------------------------------------------------------------------

function parseAnalysisResponse(
  response: Anthropic.Message,
  median: number,
  min: number,
  max: number,
): BudgetAnalysis {
  const raw = response.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('');

  const jsonText = raw.replace(/^```(?:json)?/m, '').replace(/```$/m, '').trim();

  let parsed: Partial<BudgetAnalysis>;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    // Fallback: safe median-based proposal
    parsed = {};
  }

  return {
    median:   parsed.median   ?? median,
    min:      parsed.min      ?? min,
    max:      parsed.max      ?? max,
    proposed: parsed.proposed ?? median,
    rationale: parsed.rationale ?? 'Based on the group\'s budgets, this proposal aims to balance everyone\'s comfort.',
    summary:   parsed.summary  ?? `Based on everyone's budgets, I'm proposing $${parsed.proposed ?? median} total.`,
    strategy:  parsed.strategy ?? 'consensus',
    tierSplit: parsed.tierSplit ?? undefined,
  };
}
