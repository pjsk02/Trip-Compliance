/**
 * Unit tests for budget proposal consistency.
 *
 * Verifies that computed figures (proposed, perPerson, median, min, max) are
 * always authoritative — never invented by the LLM — and that the narrative
 * summary is reconciled to match those exact figures.
 *
 * No live LLM calls are made; the Anthropic SDK is mocked at the instance level.
 */

import Anthropic from '@anthropic-ai/sdk';
import { analyzeBudgets, reproposeBudget, type BudgetAnalysis } from '../lib/budgetAgent';

// ---------------------------------------------------------------------------
// Mock the Anthropic SDK.
// budgetAgent.ts creates the client at module load time:
//   const client = new Anthropic();
// We mock the class constructor so that `new Anthropic()` returns a controlled
// object with a spy on messages.create.
// ---------------------------------------------------------------------------

const mockCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: { create: mockCreate },
    })),
  };
});

// Silence the unused-import warning for Anthropic — it's used by the mock factory
void (Anthropic as unknown);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(n: number) {
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

/** Wire mockCreate to return a JSON payload as though Claude returned it. */
function setLLMResponse(json: object) {
  mockCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text: JSON.stringify(json) }],
  });
}

/** Wire mockCreate to return non-JSON garbage. */
function setLLMGarbage(text = 'Sorry, I cannot help with that.') {
  mockCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text }],
  });
}

// ---------------------------------------------------------------------------
// Stats — median / min / max computed in code
// ---------------------------------------------------------------------------

describe('analyzeBudgets — authoritative stats', () => {
  it('computes median, min, max in code regardless of LLM response', async () => {
    setLLMResponse({
      rationale: 'Some rationale.',
      summary: 'Proposing {{TOTAL}} total ({{PER_PERSON}} per person).',
      strategy: 'consensus',
      tierSplit: null,
    });

    const result = await analyzeBudgets({
      privateBudgets: [400, 600, 800],
      groupSize: 3,
      destination: 'Tokyo',
      tripName: 'Odd median',
      hardCaps: [],
      avgBudgetConsciousness: 50,
    });

    // sorted = [400, 600, 800] → median = 600
    expect(result.median).toBe(600);
    expect(result.min).toBe(400);
    expect(result.max).toBe(800);
  });

  it('computes median correctly for an even-count array', async () => {
    setLLMResponse({
      rationale: 'r',
      summary: 'Proposing {{TOTAL}} ({{PER_PERSON}}/person).',
      strategy: 'consensus',
      tierSplit: null,
    });

    const result = await analyzeBudgets({
      privateBudgets: [300, 500, 700, 900],
      groupSize: 4,
      destination: null,
      tripName: 'Even median',
      hardCaps: [],
      avgBudgetConsciousness: 50,
    });

    // sorted = [300, 500, 700, 900] → median = (500+700)/2 = 600
    expect(result.median).toBe(600);
    expect(result.min).toBe(300);
    expect(result.max).toBe(900);
  });
});

// ---------------------------------------------------------------------------
// perPerson = proposed / groupSize (always a clean integer)
// ---------------------------------------------------------------------------

describe('analyzeBudgets — perPerson consistency', () => {
  it('perPerson equals proposed / groupSize exactly', async () => {
    setLLMResponse({
      rationale: 'r',
      summary: 'Proposing {{TOTAL}} ({{PER_PERSON}}/person).',
      strategy: 'consensus',
      tierSplit: null,
    });

    const result = await analyzeBudgets({
      privateBudgets: [500, 500, 500],
      groupSize: 3,
      destination: 'Bali',
      tripName: '3-equal',
      hardCaps: [],
      avgBudgetConsciousness: 40,
    });

    expect(result.proposed).toBe(result.perPerson * 3);
    expect(Number.isInteger(result.perPerson)).toBe(true);
  });

  it('perPerson × groupSize === proposed for an asymmetric group', async () => {
    setLLMResponse({
      rationale: 'r',
      summary: 'Here is {{TOTAL}} and {{PER_PERSON}} per person.',
      strategy: 'scope_reduction',
      tierSplit: null,
    });

    const result = await analyzeBudgets({
      privateBudgets: [300, 400, 500, 800],
      groupSize: 4,
      destination: 'Paris',
      tripName: 'Asymmetric',
      hardCaps: [450],
      avgBudgetConsciousness: 70,
    });

    expect(result.proposed).toBe(result.perPerson * 4);
    expect(Number.isInteger(result.perPerson)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Summary / narrative must contain the same figures as the structured fields
// ---------------------------------------------------------------------------

describe('summary / narrative consistency', () => {
  it('discards LLM-invented dollar figures and uses authoritative values', async () => {
    // LLM inserts wrong numbers — reconcileSummary must replace with fallback
    setLLMResponse({
      rationale: 'Budget based on the group.',
      summary: 'I propose $9,999 total ($3,333/person).',
      strategy: 'consensus',
      tierSplit: null,
    });

    const result = await analyzeBudgets({
      privateBudgets: [500, 500, 500],
      groupSize: 3,
      destination: 'Bali',
      tripName: 'Stray numbers',
      hardCaps: [],
      avgBudgetConsciousness: 50,
    });

    // Summary must NOT contain LLM's invented amounts
    expect(result.summary).not.toContain('9,999');
    expect(result.summary).not.toContain('3,333');

    // Summary MUST contain the authoritative values
    expect(result.summary).toContain(fmt(result.proposed));
    expect(result.summary).toContain(fmt(result.perPerson));
  });

  it('keeps placeholder-injected values when LLM uses {{TOTAL}} / {{PER_PERSON}}', async () => {
    setLLMResponse({
      rationale: "Based on everyone's budgets.",
      summary: "Based on everyone's budgets, I'm proposing {{TOTAL}} total ({{PER_PERSON}} per person).",
      strategy: 'consensus',
      tierSplit: null,
    });

    const result = await analyzeBudgets({
      privateBudgets: [600, 600, 600],
      groupSize: 3,
      destination: 'Rome',
      tripName: 'Placeholder',
      hardCaps: [],
      avgBudgetConsciousness: 30,
    });

    expect(result.summary).toContain(fmt(result.proposed));
    expect(result.summary).toContain(fmt(result.perPerson));
    // Placeholders must be fully replaced
    expect(result.summary).not.toContain('{{TOTAL}}');
    expect(result.summary).not.toContain('{{PER_PERSON}}');
  });

  it('falls back to template when LLM returns non-JSON', async () => {
    setLLMGarbage();

    const result = await analyzeBudgets({
      privateBudgets: [400, 600],
      groupSize: 2,
      destination: null,
      tripName: 'Fallback',
      hardCaps: [],
      avgBudgetConsciousness: 50,
    });

    expect(result.proposed).toBeGreaterThan(0);
    expect(result.perPerson).toBe(result.proposed / 2);
    expect(result.summary).toContain(fmt(result.proposed));
    expect(result.summary).toContain(fmt(result.perPerson));
  });
});

// ---------------------------------------------------------------------------
// reproposeBudget — same guarantees on a re-proposal
// ---------------------------------------------------------------------------

describe('reproposeBudget — perPerson consistency', () => {
  it('perPerson × groupSize === proposed on re-proposal', async () => {
    setLLMResponse({
      rationale: 'Revised based on feedback.',
      summary: "I hear you — revised to {{TOTAL}} ({{PER_PERSON}} per person).",
      strategy: 'scope_reduction',
      tierSplit: null,
    });

    const result = await reproposeBudget({
      currentProposed: 2100,
      rejectComments: ['Too expensive', 'Can we cut the hotel?'],
      previousStrategy: 'consensus',
      roundNum: 2,
      budgetInput: {
        privateBudgets: [500, 600, 700],
        groupSize: 3,
        destination: 'Lisbon',
        tripName: 'Repropose',
        hardCaps: [],
        avgBudgetConsciousness: 60,
      },
    });

    expect(result.proposed).toBe(result.perPerson * 3);
    expect(Number.isInteger(result.perPerson)).toBe(true);
    expect(result.summary).toContain(fmt(result.proposed));
    expect(result.summary).toContain(fmt(result.perPerson));
  });

  it('re-proposal total is lower than original when members rejected', async () => {
    setLLMResponse({
      rationale: 'Cutting scope.',
      summary: 'New: {{TOTAL}} ({{PER_PERSON}}/person).',
      strategy: 'scope_reduction',
      tierSplit: null,
    });

    const originalProposed = 2100;
    const result = await reproposeBudget({
      currentProposed: originalProposed,
      rejectComments: ['Way too much'],
      previousStrategy: 'consensus',
      roundNum: 2,
      budgetInput: {
        privateBudgets: [400, 500, 600],
        groupSize: 3,
        destination: null,
        tripName: 'Lower bid',
        hardCaps: [],
        avgBudgetConsciousness: 80,
      },
    });

    expect(result.proposed).toBeLessThan(originalProposed);
  });
});

// ---------------------------------------------------------------------------
// serializeRound logic — perPerson propagation
// ---------------------------------------------------------------------------

describe('serializeRound — perPerson in API response', () => {
  it('uses perPerson from the stored analysis blob', () => {
    const analysis: BudgetAnalysis = {
      median: 500, min: 400, max: 600,
      proposed: 1500, perPerson: 500,
      rationale: 'Fair split.',
      summary: '$1,500 total ($500 per person).',
      strategy: 'consensus',
    };

    // Mirror what serializeRound does:
    const proposed = 1500;
    const liveMemberCount = 3;
    const perPerson = analysis.perPerson ?? (liveMemberCount > 0 ? proposed / liveMemberCount : 0);

    expect(perPerson).toBe(500);
    expect(proposed).toBe(1500);
    expect(perPerson * liveMemberCount).toBe(proposed);
  });

  it('falls back to proposed / liveMemberCount for legacy records without perPerson', () => {
    const legacyAnalysis: Partial<BudgetAnalysis> = {
      median: 400, min: 300, max: 500,
      proposed: 1200,
      rationale: 'old', summary: '$1,200 total.', strategy: 'consensus',
      // perPerson intentionally absent
    };

    const proposed = 1200;
    const liveMemberCount = 3;
    const perPerson = legacyAnalysis.perPerson ?? (liveMemberCount > 0 ? proposed / liveMemberCount : 0);

    expect(perPerson).toBe(400);
    expect(perPerson * liveMemberCount).toBe(proposed);
  });
});
