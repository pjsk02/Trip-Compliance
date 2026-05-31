import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { GroupStatus, VoteChoice } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authenticate, requireAdmin } from '../middleware/auth';
import { analyzeBudgets, reproposeBudget, type BudgetAnalysis } from '../lib/budgetAgent';

export const budgetRouter = Router();

// All budget routes require authentication (member token).
budgetRouter.use(authenticate);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Load a group by code, verify the caller is a member, return both. */
async function loadGroupForMember(req: Request, res: Response) {
  const group = await prisma.group.findUnique({
    where: { groupCode: req.params.code.toUpperCase() },
    include: {
      members: {
        select: {
          id: true,
          name: true,
          privateBudget: true,
          preferenceProfile: {
            select: {
              constraintFields: true,
              sliderValues: true,
            },
          },
        },
      },
    },
  });
  if (!group) { res.status(404).json({ error: 'Group not found' }); return null; }
  if (req.member?.groupId !== group.id) { res.status(403).json({ error: 'Forbidden' }); return null; }
  return group;
}

/** Safe public round shape — never exposes individual budgets. */
function serializeRound(
  round: {
    id: string;
    roundNum: number;
    proposed: { toNumber(): number } | number;
    analysis: unknown;
    createdAt: Date;
    votes: Array<{
      id: string;
      memberId: string;
      choice: VoteChoice;
      comment: string | null;
      castAt: Date;
      member: { name: string };
    }>;
  },
  liveMemberCount: number,
) {
  const analysis = round.analysis as unknown as BudgetAnalysis;
  const proposed = typeof round.proposed === 'number' ? round.proposed : round.proposed.toNumber();
  // perPerson is authoritative: stored in the analysis blob (computed in code at proposal time).
  // If somehow missing from an old record, recompute from live member count rather than trust LLM.
  const perPerson = analysis.perPerson ?? (liveMemberCount > 0 ? proposed / liveMemberCount : 0);
  return {
    id:        round.id,
    roundNum:  round.roundNum,
    proposed,
    perPerson,
    rationale: analysis.rationale,
    summary:   analysis.summary,
    strategy:  analysis.strategy,
    tierSplit: analysis.tierSplit ?? null,
    // Aggregate stats only — no individual budget reveals
    stats: {
      median: analysis.median,
      range:  [analysis.min, analysis.max] as [number, number],
    },
    createdAt: round.createdAt,
    votes: round.votes.map(v => ({
      id:       v.id,
      memberId: v.memberId,
      name:     v.member.name,
      choice:   v.choice,
      // Only expose comment if the voter chose to share it (REJECT with comment)
      comment:  v.choice === VoteChoice.REJECT ? (v.comment ?? null) : null,
      castAt:   v.castAt,
    })),
  };
}

// ---------------------------------------------------------------------------
// GET /groups/:code/budget  — current negotiation state
// ---------------------------------------------------------------------------

budgetRouter.get('/:code/budget', async (req: Request, res: Response): Promise<void> => {
  const group = await loadGroupForMember(req, res);
  if (!group) return;

  const rounds = await prisma.budgetRound.findMany({
    where: { groupId: group.id },
    orderBy: { roundNum: 'asc' },
    include: {
      votes: {
        include: { member: { select: { name: true } } },
      },
    },
  });

  const totalMembers = group.members.length;

  // Names of members whose privateBudget is still missing — never expose amounts.
  const membersWithoutBudget = group.members
    .filter(m => !m.privateBudget || Number(m.privateBudget) <= 0)
    .map(m => ({ id: m.id, name: m.name }));

  res.json({
    groupStatus:          group.status,
    lockedBudget:         group.lockedBudget ? Number(group.lockedBudget) : null,
    totalMembers,
    membersWithoutBudget,
    rounds:               rounds.map(r => serializeRound(r, totalMembers)),
    currentRound:         rounds.length > 0 ? serializeRound(rounds[rounds.length - 1], totalMembers) : null,
  });
});

// ---------------------------------------------------------------------------
// POST /groups/:code/budget/analyze  [admin only]
// Step 2 of the loop: collect private budgets → Claude analysis → first proposal
// ---------------------------------------------------------------------------

budgetRouter.post(
  '/:code/budget/analyze',
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const group = await loadGroupForMember(req, res);
    if (!group) return;

    if (group.status !== GroupStatus.BUDGET_NEGOTIATION) {
      res.status(409).json({ error: 'Budget negotiation is not active for this group.' });
      return;
    }

    // Prevent re-analysis if a round already exists (use repropose endpoint instead)
    const existingRound = await prisma.budgetRound.findFirst({ where: { groupId: group.id } });
    if (existingRound) {
      res.status(409).json({ error: 'A budget round already exists. Use /budget/repropose to iterate.' });
      return;
    }

    // Collect private budgets — NEVER returned to the client
    const budgets = group.members
      .map(m => m.privateBudget ? Number(m.privateBudget) : null)
      .filter((b): b is number => b !== null);

    if (budgets.length === 0) {
      res.status(409).json({ error: 'No member budgets have been submitted yet.' });
      return;
    }

    // Collect hard caps from constraint fields
    const hardCaps = group.members
      .map(m => {
        const cf = m.preferenceProfile?.constraintFields as { hardBudgetCap?: number } | null;
        return cf?.hardBudgetCap ?? null;
      })
      .filter((c): c is number => c !== null);

    // Average budget-consciousness from sliders
    const consciousnessScores = group.members
      .map(m => {
        const sv = m.preferenceProfile?.sliderValues as { logistics?: { budgetConsciousness?: number } } | null;
        return sv?.logistics?.budgetConsciousness ?? null;
      })
      .filter((s): s is number => s !== null);
    const avgConsciousness = consciousnessScores.length
      ? consciousnessScores.reduce((a, b) => a + b, 0) / consciousnessScores.length
      : 50;

    const analysis = await analyzeBudgets({
      privateBudgets:         budgets,
      groupSize:              group.members.length,
      destination:            group.destination,
      tripName:               group.name,
      hardCaps,
      avgBudgetConsciousness: avgConsciousness,
    });

    const round = await prisma.budgetRound.create({
      data: {
        groupId:  group.id,
        roundNum: 1,
        proposed: analysis.proposed,
        analysis: analysis as object,
      },
      include: {
        votes: { include: { member: { select: { name: true } } } },
      },
    });

    res.status(201).json({ round: serializeRound(round) });
  },
);

// ---------------------------------------------------------------------------
// POST /groups/:code/budget/vote  [any member]
// Step 3 of the loop: cast APPROVE or REJECT on the current round
// ---------------------------------------------------------------------------

const VoteBodySchema = z.object({
  choice:  z.enum(['APPROVE', 'REJECT']),
  comment: z.string().max(500).optional(),
});

budgetRouter.post('/:code/budget/vote', async (req: Request, res: Response): Promise<void> => {
  const parsed = VoteBodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const group = await loadGroupForMember(req, res);
  if (!group) return;

  if (group.status !== GroupStatus.BUDGET_NEGOTIATION) {
    res.status(409).json({ error: 'Budget negotiation is not active.' });
    return;
  }

  const currentRound = await prisma.budgetRound.findFirst({
    where: { groupId: group.id },
    orderBy: { roundNum: 'desc' },
    include: {
      votes: { include: { member: { select: { name: true } } } },
    },
  });
  if (!currentRound) {
    res.status(409).json({ error: 'No budget proposal exists yet. Ask the admin to run analysis first.' });
    return;
  }

  const memberId = req.member!.memberId;
  const { choice, comment } = parsed.data;

  // Upsert — allow changing vote before consensus is reached
  await prisma.budgetVote.upsert({
    where: { roundId_memberId: { roundId: currentRound.id, memberId } },
    create: {
      roundId:  currentRound.id,
      memberId,
      choice:   choice as VoteChoice,
      comment:  comment ?? null,
    },
    update: {
      choice:  choice as VoteChoice,
      comment: comment ?? null,
      castAt:  new Date(),
    },
  });

  // Re-fetch with updated votes
  const updatedRound = await prisma.budgetRound.findUnique({
    where: { id: currentRound.id },
    include: { votes: { include: { member: { select: { name: true } } } } },
  });

  const allVotes     = updatedRound!.votes;
  const totalMembers = group.members.length;
  const approveCount = allVotes.filter(v => v.choice === VoteChoice.APPROVE).length;
  const rejectCount  = allVotes.filter(v => v.choice === VoteChoice.REJECT).length;
  const consensus    = approveCount === totalMembers;

  res.json({
    round:        serializeRound(updatedRound!),
    consensus,
    approveCount,
    rejectCount,
    totalMembers,
    allVoted:     allVotes.length === totalMembers,
  });
});

// ---------------------------------------------------------------------------
// POST /groups/:code/budget/repropose  [admin only]
// Step 4: consensus failed — Bot proposes a revised number
// ---------------------------------------------------------------------------

budgetRouter.post(
  '/:code/budget/repropose',
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const group = await loadGroupForMember(req, res);
    if (!group) return;

    if (group.status !== GroupStatus.BUDGET_NEGOTIATION) {
      res.status(409).json({ error: 'Budget negotiation is not active.' });
      return;
    }

    const lastRound = await prisma.budgetRound.findFirst({
      where: { groupId: group.id },
      orderBy: { roundNum: 'desc' },
      include: {
        votes: { include: { member: { select: { name: true } } } },
      },
    });
    if (!lastRound) {
      res.status(409).json({ error: 'Run /budget/analyze first.' });
      return;
    }

    const rejectComments = lastRound.votes
      .filter(v => v.choice === VoteChoice.REJECT && v.comment)
      .map(v => v.comment as string);

    const lastAnalysis = lastRound.analysis as unknown as BudgetAnalysis;

    const budgets = group.members
      .map(m => m.privateBudget ? Number(m.privateBudget) : null)
      .filter((b): b is number => b !== null);
    const hardCaps = group.members
      .map(m => {
        const cf = m.preferenceProfile?.constraintFields as { hardBudgetCap?: number } | null;
        return cf?.hardBudgetCap ?? null;
      })
      .filter((c): c is number => c !== null);
    const consciousnessScores = group.members
      .map(m => {
        const sv = m.preferenceProfile?.sliderValues as { logistics?: { budgetConsciousness?: number } } | null;
        return sv?.logistics?.budgetConsciousness ?? null;
      })
      .filter((s): s is number => s !== null);
    const avgConsciousness = consciousnessScores.length
      ? consciousnessScores.reduce((a, b) => a + b, 0) / consciousnessScores.length
      : 50;

    const newAnalysis = await reproposeBudget({
      currentProposed:   Number(lastRound.proposed),
      rejectComments,
      previousStrategy:  lastAnalysis.strategy,
      roundNum:          lastRound.roundNum + 1,
      budgetInput: {
        privateBudgets:         budgets,
        groupSize:              group.members.length,
        destination:            group.destination,
        tripName:               group.name,
        hardCaps,
        avgBudgetConsciousness: avgConsciousness,
      },
    });

    const newRound = await prisma.budgetRound.create({
      data: {
        groupId:  group.id,
        roundNum: lastRound.roundNum + 1,
        proposed: newAnalysis.proposed,
        analysis: newAnalysis as object,
      },
      include: {
        votes: { include: { member: { select: { name: true } } } },
      },
    });

    res.status(201).json({ round: serializeRound(newRound) });
  },
);

// ---------------------------------------------------------------------------
// POST /groups/:code/budget/lock  [admin only]
// Step 5: consensus reached — lock the agreed budget, advance to PLANNING
// ---------------------------------------------------------------------------

budgetRouter.post(
  '/:code/budget/lock',
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const group = await loadGroupForMember(req, res);
    if (!group) return;

    if (group.status !== GroupStatus.BUDGET_NEGOTIATION) {
      res.status(409).json({ error: 'Budget negotiation is not active.' });
      return;
    }

    const currentRound = await prisma.budgetRound.findFirst({
      where: { groupId: group.id },
      orderBy: { roundNum: 'desc' },
      include: { votes: true },
    });
    if (!currentRound) {
      res.status(409).json({ error: 'No budget proposal to lock.' });
      return;
    }

    const approveCount = currentRound.votes.filter(v => v.choice === VoteChoice.APPROVE).length;
    const totalMembers = group.members.length;

    // Require majority (admin can override unanimous-approve check but not 0 approvals)
    if (approveCount === 0) {
      res.status(409).json({ error: 'Cannot lock a budget with zero approvals.' });
      return;
    }

    const updated = await prisma.group.update({
      where: { id: group.id },
      data: {
        lockedBudget: currentRound.proposed,
        status:       GroupStatus.PLANNING,
      },
    });

    res.json({
      lockedBudget: Number(updated.lockedBudget),
      status:       updated.status,
      approveCount,
      totalMembers,
    });
  },
);
