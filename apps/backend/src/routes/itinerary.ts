/**
 * Itinerary routes
 *
 * GET  /groups/:code/itineraries           — list all versions for the group
 * GET  /groups/:code/itineraries/:version  — single version
 * POST /groups/:code/feedback              — submit feedback → classify → replan → new version
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { GroupStatus, FeedbackType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { classifyFeedback } from '../lib/planning/feedbackClassifier';
import { runOrchestratorWithFeedback } from '../lib/planning/replanOrchestrator';
import { FeedbackAdjustmentSchema } from '../lib/planning/schemas';
import type {
  MemberPreferenceSnapshot,
  FeedbackAdjustment,
} from '../lib/planning/schemas';
import type { PreferenceScores, PreferencePriorities, ConstraintFields } from '../lib/preferenceSchema';

export const itineraryRouter = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMemberSnapshots(
  members: Array<{
    id: string;
    userId: string | null;
    name: string;
    preferenceProfile: {
      scores: unknown;
      priorities: unknown;
      constraintFields?: unknown;
      chatNuance?: string | null;
    } | null;
  }>,
): MemberPreferenceSnapshot[] {
  const defaultConstraints: ConstraintFields = {
    dietaryRestrictions: [],
    alcoholPreference:   'sometimes',
  };

  const snapshots: MemberPreferenceSnapshot[] = [];
  for (const m of members) {
    if (!m.preferenceProfile) continue;
    const profile = m.preferenceProfile as {
      scores: PreferenceScores;
      priorities: PreferencePriorities;
      constraintFields?: ConstraintFields;
      chatNuance?: string | null;
    };
    snapshots.push({
      memberId:    m.id,
      userId:      m.userId ?? m.id,
      name:        m.name,
      scores:      profile.scores,
      priorities:  profile.priorities,
      constraints: profile.constraintFields ?? defaultConstraints,
      chatNuance:  profile.chatNuance ?? null,
    });
  }
  return snapshots;
}

// ---------------------------------------------------------------------------
// GET /groups/:code/itineraries — all versions
// ---------------------------------------------------------------------------

itineraryRouter.get(
  '/:code/itineraries',
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    const group = await prisma.group.findUnique({
      where: { groupCode: req.params.code.toUpperCase() },
    });
    if (!group) { res.status(404).json({ error: 'Group not found' }); return; }

    // Auth: caller must be a member of this group
    if (req.member && req.member.groupId !== group.id) {
      res.status(403).json({ error: 'Forbidden' }); return;
    }

    const itineraries = await prisma.itinerary.findMany({
      where:   { groupId: group.id },
      orderBy: { version: 'asc' },
      include: {
        feedback: {
          orderBy: { createdAt: 'asc' },
          include: { member: { select: { id: true, name: true } } },
        },
      },
    });

    res.json({
      itineraries,
      finalItineraryId: group.finalItineraryId ?? null,
      finalizedAt:      group.finalizedAt?.toISOString() ?? null,
    });
  },
);

// ---------------------------------------------------------------------------
// GET /groups/:code/itineraries/:version — single version
// ---------------------------------------------------------------------------

itineraryRouter.get(
  '/:code/itineraries/:version',
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    const version = parseInt(req.params.version, 10);
    if (isNaN(version)) { res.status(400).json({ error: 'Invalid version' }); return; }

    const group = await prisma.group.findUnique({
      where: { groupCode: req.params.code.toUpperCase() },
    });
    if (!group) { res.status(404).json({ error: 'Group not found' }); return; }

    if (req.member && req.member.groupId !== group.id) {
      res.status(403).json({ error: 'Forbidden' }); return;
    }

    const itinerary = await prisma.itinerary.findUnique({
      where:   { groupId_version: { groupId: group.id, version } },
      include: {
        feedback: {
          orderBy: { createdAt: 'asc' },
          include: { member: { select: { id: true, name: true } } },
        },
      },
    });

    if (!itinerary) { res.status(404).json({ error: 'Itinerary version not found' }); return; }

    res.json(itinerary);
  },
);

// ---------------------------------------------------------------------------
// POST /groups/:code/feedback — classify + replan → save new version
// ---------------------------------------------------------------------------

const FeedbackBodySchema = z.object({
  text:           z.string().min(1).max(2000),
  itineraryVersion: z.number().int().positive().optional(),
  tripDuration:   z.number().int().min(1).max(30),
});

itineraryRouter.post(
  '/:code/feedback',
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = FeedbackBodySchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

    if (!req.member) { res.status(401).json({ error: 'Member authentication required' }); return; }

    const group = await prisma.group.findUnique({
      where: { groupCode: req.params.code.toUpperCase() },
      include: {
        members: {
          include: { user: true, preferenceProfile: true },
        },
        budgetRounds: { orderBy: { roundNum: 'desc' }, take: 1 },
      },
    });

    if (!group) { res.status(404).json({ error: 'Group not found' }); return; }
    if (req.member.groupId !== group.id) { res.status(403).json({ error: 'Forbidden' }); return; }

    if (group.status !== GroupStatus.COMPLETE) {
      res.status(409).json({ error: 'Feedback can only be submitted once an itinerary exists (group status must be COMPLETE)' });
      return;
    }

    if (!group.destination) {
      res.status(409).json({ error: 'Group has no destination set' });
      return;
    }

    // Resolve which itinerary version to replan from
    let baseItinerary;
    if (parsed.data.itineraryVersion) {
      baseItinerary = await prisma.itinerary.findUnique({
        where: { groupId_version: { groupId: group.id, version: parsed.data.itineraryVersion } },
      });
    } else {
      baseItinerary = await prisma.itinerary.findFirst({
        where:   { groupId: group.id },
        orderBy: { version: 'desc' },
      });
    }

    if (!baseItinerary) { res.status(404).json({ error: 'No itinerary found to replan from' }); return; }

    const lockedBudget = group.lockedBudget
      ? parseFloat(group.lockedBudget.toString())
      : (group.budgetRounds[0]?.proposed ? parseFloat(group.budgetRounds[0].proposed.toString()) : null);

    if (!lockedBudget || lockedBudget <= 0) {
      res.status(409).json({ error: 'No locked budget found' });
      return;
    }

    const members = buildMemberSnapshots(group.members as Parameters<typeof buildMemberSnapshots>[0]);
    if (members.length === 0) {
      res.status(409).json({ error: 'No members with completed preference profiles' });
      return;
    }

    // Find the submitting member's snapshot for classification context
    const submitterMember = group.members.find(m => m.id === req.member!.memberId);
    if (!submitterMember) { res.status(403).json({ error: 'Submitter not found in group' }); return; }

    // 1. Classify the feedback
    let classified;
    try {
      classified = await classifyFeedback(parsed.data.text, {
        memberId: submitterMember.id,
        name:     submitterMember.name,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Classification failed';
      res.status(502).json({ error: `Feedback classification error: ${msg}` });
      return;
    }

    // Validate the adjustment schema before storing
    const adjustmentValidation = FeedbackAdjustmentSchema.safeParse(classified.adjustment);
    if (!adjustmentValidation.success) {
      res.status(502).json({ error: `Invalid adjustment from classifier: ${adjustmentValidation.error.message}` });
      return;
    }
    const adjustment = adjustmentValidation.data as FeedbackAdjustment;

    const ctx = {
      destination:  group.destination,
      tripDuration: parsed.data.tripDuration,
      groupSize:    members.length,
      lockedBudget,
      members,
    };

    // 2. Re-run the orchestrator with the adjustment
    let result;
    try {
      result = await runOrchestratorWithFeedback(ctx, adjustment, 3);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Replanning pipeline failed';
      res.status(502).json({ error: `Replan error: ${msg}` });
      return;
    }

    const itinerary = result.itinerary as {
      dayPlans:           unknown;
      budgetBreakdown:    unknown;
      satisfactionScores: unknown;
      tradeoffReport:     string;
      adminOverrideFlag:  boolean;
    };

    // 3. Persist: feedback record + new Itinerary version in one transaction
    const newVersion = baseItinerary.version + 1;

    const saved = await prisma.$transaction(async tx => {
      // Save feedback record (attribute to submitting user)
      await tx.feedback.create({
        data: {
          groupId:     group.id,
          itineraryId: baseItinerary.id,
          memberId:    submitterMember.id,
          rawText:     parsed.data.text,
          type:        classified.type as FeedbackType,
          targetAgent: classified.targetAgent,
          adjustment:  adjustment as object,
        },
      });

      // Save new itinerary version
      const record = await tx.itinerary.create({
        data: {
          groupId:            group.id,
          version:            newVersion,
          dayPlans:           itinerary.dayPlans as object,
          budgetBreakdown:    itinerary.budgetBreakdown as object,
          satisfactionScores: itinerary.satisfactionScores as object,
          tradeoffReport:     itinerary.tradeoffReport,
        },
      });

      return record;
    });

    res.status(201).json({
      itineraryId:       saved.id,
      version:           saved.version,
      feedbackType:      classified.type,
      targetAgent:       classified.targetAgent,
      feedbackSummary:   classified.summary,
      adminOverrideFlag: itinerary.adminOverrideFlag,
      consensusStatus:   (result.consensus as { status: string }).status,
      dayPlans:          itinerary.dayPlans,
      budgetBreakdown:   itinerary.budgetBreakdown,
      satisfactionScores: itinerary.satisfactionScores,
      tradeoffReport:    itinerary.tradeoffReport,
      durationMs:        result.durationMs,
    });
  },
);
