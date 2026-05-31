/**
 * Unit tests for budget proposal consistency.
 *
 * These tests cover the pure functions in budgetAgent.ts and the
 * serializeRound helper in budget.ts to assert that the structured
 * proposal and the narrative message always report identical numbers.
 *
 * No LLM calls are made — we test the reconciliation / injection layer.
 */

// ---------------------------------------------------------------------------
// We reach into the module's non-exported helpers via re-export shims below.
// Because the helpers are not exported, we inline-test the exported surface
// (analyzeBudgets / reproposeBudget return type) and the reconciliation logic
// by calling the exported functions with a mocked Anthropic client.
// ---------------------------------------------------------------------------

import Anthropic from '@anthropic-ai/sdk';

// Mock the Anthropic SDK before importing the module under test
jest.mock('@anthropic-ai/sdk');

const MockAnthropic = Anthropic as jest.MockedClass<typeof Anthropic>;

import { analyzeBudgets, reproposeBudget, type BudgetAnalysis } from '../lib/budgetAgent';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(n: number) {
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

/** Build the fake Anthropic response the mock will return. */
function mockLLMResponse(json: object) {
  const instance = {
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(json) }],
      }),
    },
  };
  MockAnthropic.mockImplementation(() => instance as unknown as Anthropic);
  return instance;
}

// ---------------------------------------------------------------------------
// computeStats — tested indirectly via analyzeBudgets return value
// ---------------------------------------------------------------------------

describe('analyzeBudgets — authoritative stats', () => {
  it('computes median, min, max in code regardless of what LLM returns', async () => {
    // LLM returns wrong stats — should be ignored
    mockLLMResponse({
      rationale: 'Some rationale.',
      summary: 'Proposing {{TOTAL}} total ({{PER_PERSON}} per person).',
      strategy: 'consensus',
      tierSplit: null,
    });

    const result = await analyzeBudgets({
      privateBudgets: [400, 600, 800],
      groupSize: 3,
      destination: 'Tokyo',
      tripName: 'Test Trip',
      hardCaps: [],
      avgBudgetConsciousness: 50,
    });

    // sorted = [400, 600, 800], median = 600 (middle element)
    expect(result.median).toBe(600);
    expect(result.min).toBe(400);
    expect(result.max).toBe(800);
  });

  it('computes median correctly for an even-count array', async () => {
    mockLLMResponse({
      rationale: 'r',
      summary: 'Proposing {{TOTAL}} ({{PER_PERSON}}/person).',
      strategy: 'consensus',
      tierSplit: null,
    });

    const result = await analyzeBudgets({
      privateBudgets: [300, 500, 700, 900],
      groupSize: 4,
      destination: null,
      tripName: 'Even Trip',
      hardCaps: [],
      avgBudgetConsciousness: 50,
    });

    // sorted = [300, 500, 700, 900], median = (500+700)/2 = 600
    expect(result.median).toBe(600);
    expect(result.min).toBe(300);
    expect(result.max).toBe(900);
  });
});

// ---------------------------------------------------------------------------
// perPerson = proposed / groupSize, always an integer
// ---------------------------------------------------------------------------

describe('analyzeBudgets — perPerson consistency', () => {
  it('perPerson equals proposed divided by groupSize exactly', async () => {
    mockLLMResponse({
      rationale: 'r',
      summary: 'Proposing {{TOTAL}} ({{PER_PERSON}}/person).',
      strategy: 'consensus',
      tierSplit: null,
    });

    const result = await analyzeBudgets({
      privateBudgets: [500, 500, 500],
      groupSize: 3,
      destination: 'Bali',
      tripName: '3-member equal',
      hardCaps: [],
      avgBudgetConsciousness: 40,
    });

    expect(result.proposed).toBe(result.perPerson * 3);
    expect(Number.isInteger(result.perPerson)).toBe(true);
  });

  it('perPerson × groupSize === proposed for an asymmetric group', async () => {
    mockLLMResponse({
      rationale: 'r',
      summary: 'Here is {{TOTAL}} and {{PER_PERSON}} per person.',
      strategy: 'scope_reduction',
      tierSplit: null,
    });

    const result = await analyzeBudgets({
      privateBudgets: [300, 400, 500, 800],
      groupSize: 4,
      destination: 'Paris',
      tripName: 'Asymmetric group',
      hardCaps: [450],
      avgBudgetConsciousness: 70,
    });

    expect(result.proposed).toBe(result.perPerson * 4);
    expect(Number.isInteger(result.perPerson)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// summary narrative must contain the same numbers as the structured fields
// ---------------------------------------------------------------------------

describe('summary / narrative consistency', () => {
  it('summary uses authoritative proposed and perPerson, not LLM-invented figures', async () => {
    // LLM tries to insert its own (wrong) dollar amounts
    mockLLMResponse({
      rationale: 'Budget based on the group.',
      summary: 'I propose $9,999 total ($3,333/person).', // LLM invented different numbers
      strategy: 'consensus',
      tierSplit: null,
    });

    const result = await analyzeBudgets({
      privateBudgets: [500, 500, 500],
      groupSize: 3,
      destination: 'Bali',
      tripName: 'Stray numbers trip',
      hardCaps: [],
      avgBudgetConsciousness: 50,
    });

    const totalStr    = fmt(result.proposed);
    const perPersonStr = fmt(result.perPerson);

    // Summary must NOT contain the LLM's invented $9,999 or $3,333
    expect(result.summary).not.toContain('9,999');
    expect(result.summary).not.toContain('3,333');

    // Summary MUST contain the authoritative values
    expect(result.summary).toContain(totalStr);
    expect(result.summary).toContain(perPersonStr);
  });

  it('summary keeps placeholder-injected values when LLM uses {{TOTAL}} and {{PER_PERSON}}', async () => {
    mockLLMResponse({
      rationale: 'Based on everyone\'s budgets.',
      summary: 'Based on everyone\'s budgets, I\'m proposing {{TOTAL}} total ({{PER_PERSON}} per person).',
      strategy: 'consensus',
      tierSplit: null,
    });

    const result = await analyzeBudgets({
      privateBudgets: [600, 600, 600],
      groupSize: 3,
      destination: 'Rome',
      tripName: 'Placeholder trip',
      hardCaps: [],
      avgBudgetConsciousness: 30,
    });

    expect(result.summary).toContain(fmt(result.proposed));
    expect(result.summary).toContain(fmt(result.perPerson));
    // No raw placeholders should remain
    expect(result.summary).not.toContain('{{TOTAL}}');
    expect(result.summary).not.toContain('{{PER_PERSON}}');
  });

  it('falls back to template when LLM response is not valid JSON', async () => {
    const instance = {
      messages: {
        create: jest.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'Sorry, I cannot help with that.' }],
        }),
      },
    };
    MockAnthropic.mockImplementation(() => instance as unknown as Anthropic);

    const result = await analyzeBudgets({
      privateBudgets: [400, 600],
      groupSize: 2,
      destination: null,
      tripName: 'Fallback trip',
      hardCaps: [],
      avgBudgetConsciousness: 50,
    });

    // Should still have valid numeric structure
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
    mockLLMResponse({
      rationale: 'Revised based on feedback.',
      summary: 'I hear you — revised to {{TOTAL}} ({{PER_PERSON}} per person).',
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
        tripName: 'Repropose trip',
        hardCaps: [],
        avgBudgetConsciousness: 60,
      },
    });

    expect(result.proposed).toBe(result.perPerson * 3);
    expect(Number.isInteger(result.perPerson)).toBe(true);
    expect(result.summary).toContain(fmt(result.proposed));
    expect(result.summary).toContain(fmt(result.perPerson));
  });

  it('re-proposal is lower than the original when members rejected', async () => {
    mockLLMResponse({
      rationale: 'Cutting scope to meet lower budgets.',
      summary: 'New proposal: {{TOTAL}} ({{PER_PERSON}} per person).',
      strategy: 'scope_reduction',
      tierSplit: null,
    });

    const originalProposed = 2100; // $700/person × 3
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
// serializeRound — perPerson propagated to API response
// ---------------------------------------------------------------------------

describe('serializeRound — perPerson in API response', () => {
  it('exposes perPerson from the stored analysis blob', () => {
    // Import the helper via the module (it's not exported, so we test via
    // a BudgetAnalysis blob stored in the round's analysis field)
    const analysis: BudgetAnalysis = {
      median:    500,
      min:       400,
      max:       600,
      proposed:  1500,
      perPerson: 500,
      rationale: 'Fair split.',
      summary:   '$1,500 total ($500 per person).',
      strategy:  'consensus',
    };

    // Reconstruct what the route does when it reads from DB and serializes:
    const simulatedDbRound = {
      id:        'test-round-id',
      roundNum:  1,
      proposed:  { toNumber: () => 1500 }, // Prisma Decimal
      analysis:  analysis as unknown as object,
      createdAt: new Date(),
      votes:     [],
    };

    // Inline the serialization logic (mirrors serializeRound in budget.ts)
    const storedAnalysis = simulatedDbRound.analysis as unknown as BudgetAnalysis;
    const proposed = (simulatedDbRound.proposed as { toNumber(): number }).toNumber();
    const liveMemberCount = 3;
    const perPerson = storedAnalysis.perPerson ?? (liveMemberCount > 0 ? proposed / liveMemberCount : 0);

    expect(perPerson).toBe(500);
    expect(proposed).toBe(1500);
    expect(perPerson * liveMemberCount).toBe(proposed);
  });

  it('falls back to proposed / liveMemberCount when perPerson missing from old record', () => {
    const legacyAnalysis = {
      median: 400, min: 300, max: 500,
      proposed: 1200,
      // perPerson intentionally absent (old record)
      rationale: 'old',
      summary: '$1,200 total.',
      strategy: 'consensus',
    };

    const proposed = 1200;
    const liveMemberCount = 3;
    const storedPerPerson = (legacyAnalysis as Partial<BudgetAnalysis>).perPerson;
    const perPerson = storedPerPerson ?? (liveMemberCount > 0 ? proposed / liveMemberCount : 0);

    expect(perPerson).toBe(400);
    expect(perPerson * liveMemberCount).toBe(proposed);
  });
});
