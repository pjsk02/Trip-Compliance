import { z } from 'zod';
import { BaseAgent, contextSummary, extractJsonObject, getClient } from '../agent';
import {
  BudgetProposalSchema,
  type BudgetProposal,
  type PlanningContext,
  type ActivityProposal,
  type FoodProposal,
  type AccommodationProposal,
  type TransportationProposal,
  groupMean,
} from '../schemas';
import type { OnEvent } from '../streamEvents';

export interface BudgetAgentInput {
  ctx:              PlanningContext;
  activity:         ActivityProposal;
  food:             FoodProposal;
  accommodation:    AccommodationProposal;
  transportation:   TransportationProposal;
  /**
   * The group's real locked budget before any planning buffer is applied.
   * This is what appears in the budget proposal's `lockedBudgetUsd` field —
   * the group-agreed figure, not the internally-buffered planning budget.
   */
  realLockedBudget?: number;
}

// ---------------------------------------------------------------------------
// Schema for the LLM's ONLY job: substitution suggestions.
// All numeric budget fields are computed in code — the model never produces them.
// ---------------------------------------------------------------------------

const SubstitutionsSchema = z.object({
  substitutions: z
    .array(
      z.object({
        replace:   z.string(),
        with:      z.string(),
        savingUsd: z.number().nonnegative(),
      }),
    )
    .default([]),
});

/**
 * Budget Agent — Wave 2 of the planning pipeline.
 *
 * Design: ALL numeric fields (lines, totalEstimatedUsd, lockedBudgetUsd,
 * surplus, overrunFlag) are computed in code from the other agents' proposals.
 * The LLM is invoked ONLY when over budget, and then only to suggest
 * substitutions (text + saving estimate). This eliminates the number
 * hallucination and schema mismatch bugs that caused white-screen failures.
 */
export class BudgetAgent extends BaseAgent<BudgetProposal> {
  readonly name = 'budget';

  private input!: BudgetAgentInput;

  withInput(input: BudgetAgentInput): this {
    this.input = input;
    return this;
  }

  // These three are required by BaseAgent but not used — propose() is overridden.
  protected schema(): z.ZodType<BudgetProposal> { return BudgetProposalSchema; }
  protected systemPrompt(): string { return SCHEMA_REFERENCE; }
  protected buildUserPrompt(_ctx: PlanningContext): string { return ''; }

  protected safeDefault(ctx: PlanningContext): BudgetProposal {
    // Always available — computeFromAgents() is pure and cannot throw.
    return { ...this.computeFromAgents(ctx), substitutions: [] };
  }

  /**
   * Main entry point — overrides BaseAgent.propose() entirely.
   * No LLM calls for numbers. LLM called at most once, only for substitutions.
   */
  async propose(ctx: PlanningContext): Promise<BudgetProposal> {
    const computed = this.computeFromAgents(ctx);

    if (!computed.overrunFlag) {
      // Within budget — no substitutions needed, no LLM call.
      return { ...computed, substitutions: [] };
    }

    // Over budget — ask the LLM for substitution suggestions only.
    const substitutions = await this.fetchSubstitutions(ctx, computed).catch(err => {
      console.error(`[budget] Substitutions call failed (${err.message}) — using empty list`);
      return [] as BudgetProposal['substitutions'];
    });

    return { ...computed, substitutions };
  }

  // ---------------------------------------------------------------------------
  // Pure math — computes budget from the other agents' proposals.
  // ---------------------------------------------------------------------------

  private computeFromAgents(ctx: PlanningContext): Omit<BudgetProposal, 'substitutions'> {
    const { activity, food, accommodation, transportation, realLockedBudget } = this.input;
    const { groupSize, lockedBudget, tripDuration } = ctx;

    const rec =
      accommodation.options[accommodation.recommended] ?? accommodation.options[0]!;

    // Per-person cost from each agent
    const accommodationPP = Math.round(rec.pricePerNightPerPersonUsd * tripDuration);
    const foodPP          = Math.round(food.totalFoodCostPerPersonUsd);
    const transportPP     = Math.round(transportation.totalTransportCostPerPersonUsd);

    // Activities: take the candidates that will realistically be scheduled
    // (same window the orchestrator uses for candidate building)
    const activityWindow = Math.min(
      activity.candidates.length,
      Math.max(4, tripDuration * 2),
    );
    const activitiesPP = Math.round(
      activity.candidates
        .slice(0, activityWindow)
        .reduce((s, a) => s + a.estimatedCostPerPersonUsd, 0),
    );

    // Miscellaneous: 5% of per-person budget, minimum $20
    const miscPP = Math.max(20, Math.round((lockedBudget / groupSize) * 0.05));

    const lines = [
      { category: 'Accommodation', estimatedCostPerPersonUsd: accommodationPP, totalUsd: accommodationPP * groupSize },
      { category: 'Food & Dining', estimatedCostPerPersonUsd: foodPP,          totalUsd: foodPP * groupSize },
      { category: 'Activities',    estimatedCostPerPersonUsd: activitiesPP,    totalUsd: activitiesPP * groupSize },
      { category: 'Transportation',estimatedCostPerPersonUsd: transportPP,     totalUsd: transportPP * groupSize },
      { category: 'Miscellaneous', estimatedCostPerPersonUsd: miscPP,          totalUsd: miscPP * groupSize },
    ];

    const totalEstimatedUsd = lines.reduce((s, l) => s + l.totalUsd, 0);

    // Report against the real group-agreed budget, not the internally-buffered
    // planning budget. The buffer is an implementation detail; the group sees 8000,
    // not 7040.
    const reportedBudget = realLockedBudget ?? lockedBudget;
    const surplus        = reportedBudget - totalEstimatedUsd;

    return {
      agent: 'budget',
      lines,
      totalEstimatedUsd,
      lockedBudgetUsd: reportedBudget,
      surplus,
      overrunFlag: surplus < 0,
    };
  }

  // ---------------------------------------------------------------------------
  // LLM call — only for substitution suggestions, never for numbers.
  // ---------------------------------------------------------------------------

  private async fetchSubstitutions(
    ctx: PlanningContext,
    computed: Omit<BudgetProposal, 'substitutions'>,
  ): Promise<BudgetProposal['substitutions']> {
    const { accommodation } = this.input;
    const rec =
      accommodation.options[accommodation.recommended] ?? accommodation.options[0]!;
    const overrunUsd    = Math.abs(computed.surplus);
    const perPersonBudget = Math.round(ctx.lockedBudget / ctx.groupSize);
    const budgetScore   = groupMean(ctx.members.map(m => m.scores.logistics.budgetConsciousness));

    const linesSummary = computed.lines
      .map(l => `  ${l.category}: $${l.estimatedCostPerPersonUsd}/person ($${l.totalUsd} total)`)
      .join('\n');

    const prompt = [
      contextSummary(ctx),
      '',
      'COMPUTED BUDGET BREAKDOWN (from agent proposals):',
      linesSummary,
      `  TOTAL ESTIMATED: $${computed.totalEstimatedUsd} — OVERRUN by $${overrunUsd}`,
      `  Locked budget:   $${ctx.lockedBudget} ($${perPersonBudget}/person)`,
      '',
      `Current accommodation recommendation: ${rec.name} ($${rec.pricePerNightPerPersonUsd}/night/person)`,
      `Group budget-consciousness score: ${budgetScore}/100 (higher = more cost-sensitive)`,
      '',
      'Suggest 1-3 specific, actionable substitutions to bring the total within budget.',
      'Be concrete: name what to replace and with what, and estimate the saving in USD.',
      '',
      'Return ONLY this JSON — no prose, no fences, nothing outside the braces:',
      '{"substitutions":[{"replace":"string","with":"string","savingUsd":number}]}',
      'If no viable substitutions exist, return: {"substitutions":[]}',
    ].join('\n');

    const response = await getClient().messages.create({
      model: process.env.CLAUDE_MODEL ?? 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system:
        'You are a travel budget optimiser. Return ONLY valid JSON — no prose, no markdown fences. ' +
        'Do not include any numbers except the savingUsd values; describe substitutions in plain text.',
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('');

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJsonObject(raw));
    } catch {
      return [];
    }

    const result = SubstitutionsSchema.safeParse(parsed);
    return result.success ? result.data.substitutions : [];
  }
}

// ---------------------------------------------------------------------------
// Schema reference — only used in repair prompts (the base class repair path)
// ---------------------------------------------------------------------------

const SCHEMA_REFERENCE = `Budget agent output schema (for reference only):
{
  "agent": "budget",
  "lines": [{"category":"string","estimatedCostPerPersonUsd":number,"totalUsd":number}],
  "totalEstimatedUsd": number,
  "lockedBudgetUsd": number,
  "surplus": number,
  "overrunFlag": true|false,
  "substitutions": [{"replace":"string","with":"string","savingUsd":number}]
}
substitutions must be an array (can be empty []).`;
