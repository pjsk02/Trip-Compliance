import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { GroupStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { signToken, verifyToken, isMemberToken } from '../lib/jwt';
import { generateUniqueGroupCode } from '../lib/groupCode';
import { authenticate, requireUser, requireAdmin } from '../middleware/auth';
import { runOrchestrator } from '../lib/planning/orchestrator';
import type { MemberPreferenceSnapshot } from '../lib/planning/schemas';
import type { PreferenceScores, PreferencePriorities, ConstraintFields } from '../lib/preferenceSchema';
import type { StreamEvent } from '../lib/planning/streamEvents';

export const groupsRouter = Router();

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const CreateGroupSchema = z.object({
  name:        z.string().min(1).max(100),
  destination: z.string().max(100).optional(),
  password:    z.string().min(4).max(72),
  startDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // YYYY-MM-DD
  endDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** Compute tripDays (inclusive) and tripDuration (nights) from ISO date strings. */
function computeTripDuration(startDate: string, endDate: string): { tripDays: number; tripDuration: number } {
  const start = new Date(startDate);
  const end   = new Date(endDate);
  const msPerDay = 1000 * 60 * 60 * 24;
  const tripDays = Math.round((end.getTime() - start.getTime()) / msPerDay) + 1;
  return { tripDays, tripDuration: tripDays - 1 };
}

const JoinGroupSchema = z.object({
  password: z.string().min(1),
});

// ---------------------------------------------------------------------------
// POST /groups — authenticated user creates a group, becomes admin member
// ---------------------------------------------------------------------------

groupsRouter.post('/', requireUser, async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateGroupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { name, destination, password } = parsed.data;
  const { userId } = req.user!;

  const dbUser = await prisma.user.findUnique({ where: { id: userId } });
  if (!dbUser) {
    res.status(401).json({ error: 'User not found' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const groupCode    = await generateUniqueGroupCode();

  const { group, adminMember } = await prisma.$transaction(async (tx) => {
    const group = await tx.group.create({
      data: { name, groupCode, passwordHash, destination },
    });
    const adminMember = await tx.member.create({
      data: { groupId: group.id, userId: dbUser.id, name: dbUser.name, isAdmin: true },
    });
    await tx.group.update({
      where: { id: group.id },
      data:  { adminMemberId: adminMember.id },
    });
    return { group, adminMember };
  });

  // Issue a member-scoped token so the client can immediately enter the group flow.
  const token = signToken({ memberId: adminMember.id, groupId: group.id, isAdmin: true });

  res.status(201).json({
    groupCode: group.groupCode,
    password,
    token,
    member: { id: adminMember.id, name: adminMember.name, isAdmin: true },
  });
});

// ---------------------------------------------------------------------------
// POST /groups/:code/join — authenticated user joins an existing group
// ---------------------------------------------------------------------------

groupsRouter.post('/:code/join', requireUser, async (req: Request, res: Response): Promise<void> => {
  const parsed = JoinGroupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { password } = parsed.data;
  const { userId }   = req.user!;

  const dbUser = await prisma.user.findUnique({ where: { id: userId } });
  if (!dbUser) {
    res.status(401).json({ error: 'User not found' });
    return;
  }

  const group = await prisma.group.findUnique({
    where: { groupCode: req.params.code.toUpperCase() },
  });
  if (!group) {
    res.status(404).json({ error: 'Group not found' });
    return;
  }

  const passwordMatch = await bcrypt.compare(password, group.passwordHash);
  if (!passwordMatch) {
    res.status(401).json({ error: 'Incorrect password' });
    return;
  }

  if (group.status !== GroupStatus.COLLECTING) {
    res.status(409).json({ error: 'This group is locked and not accepting new members' });
    return;
  }

  // Prevent duplicate membership.
  const existing = await prisma.member.findFirst({
    where: { groupId: group.id, userId: dbUser.id },
  });
  if (existing) {
    const token = signToken({ memberId: existing.id, groupId: group.id, isAdmin: existing.isAdmin });
    res.json({
      token,
      member: { id: existing.id, name: existing.name, isAdmin: existing.isAdmin },
      group:  { id: group.id, name: group.name, destination: group.destination, status: group.status },
    });
    return;
  }

  const member = await prisma.member.create({
    data: { groupId: group.id, userId: dbUser.id, name: dbUser.name, isAdmin: false },
  });

  const token = signToken({ memberId: member.id, groupId: group.id, isAdmin: false });

  res.status(201).json({
    token,
    member: { id: member.id, name: member.name, isAdmin: false },
    group:  { id: group.id, name: group.name, destination: group.destination, status: group.status },
  });
});

// ---------------------------------------------------------------------------
// POST /groups/:code/enter — re-issue a member token for an existing member
// Uses only the user token (no password). For re-entering from the Home page.
// ---------------------------------------------------------------------------

groupsRouter.post('/:code/enter', requireUser, async (req: Request, res: Response): Promise<void> => {
  const { userId } = req.user!;

  const group = await prisma.group.findUnique({
    where: { groupCode: req.params.code.toUpperCase() },
  });
  if (!group) {
    res.status(404).json({ error: 'Group not found' });
    return;
  }

  const member = await prisma.member.findFirst({
    where: { groupId: group.id, userId },
  });
  if (!member) {
    res.status(403).json({ error: 'You are not a member of this group' });
    return;
  }

  const token = signToken({ memberId: member.id, groupId: group.id, isAdmin: member.isAdmin });
  res.json({
    token,
    member: { id: member.id, name: member.name, isAdmin: member.isAdmin },
    group:  { id: group.id, name: group.name, destination: group.destination, status: group.status },
  });
});

// ---------------------------------------------------------------------------
// GET /groups/:code — group state + member roster
// ---------------------------------------------------------------------------

groupsRouter.get('/:code', authenticate, async (req: Request, res: Response): Promise<void> => {
  const group = await prisma.group.findUnique({
    where: { groupCode: req.params.code.toUpperCase() },
    include: {
      members: {
        select: {
          id: true,
          name: true,
          isAdmin: true,
          preferenceStatus: true,
          joinedAt: true,
          privateBudget: req.member?.isAdmin ?? false,
        },
        orderBy: { joinedAt: 'asc' },
      },
    },
  });

  if (!group) {
    res.status(404).json({ error: 'Group not found' });
    return;
  }

  // Allow access with either a user token (any group member) or a member token (must match group).
  if (req.member) {
    if (req.member.groupId !== group.id) {
      res.status(403).json({ error: 'You are not a member of this group' });
      return;
    }
  } else if (req.user) {
    const isMember = await prisma.member.findFirst({
      where: { groupId: group.id, userId: req.user.userId },
    });
    if (!isMember) {
      res.status(403).json({ error: 'You are not a member of this group' });
      return;
    }
  } else {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const { passwordHash: _pw, ...safeGroup } = group;
  res.json(safeGroup);
});

// ---------------------------------------------------------------------------
// POST /groups/:code/lock-preferences  [admin only, member token]
// ---------------------------------------------------------------------------

groupsRouter.post(
  '/:code/lock-preferences',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const group = await prisma.group.findUnique({
      where: { groupCode: req.params.code.toUpperCase() },
    });
    if (!group) { res.status(404).json({ error: 'Group not found' }); return; }
    if (req.member!.groupId !== group.id) { res.status(403).json({ error: 'Forbidden' }); return; }

    if (group.status !== GroupStatus.COLLECTING) {
      res.status(409).json({ error: `Cannot lock preferences from status "${group.status}"` });
      return;
    }

    const updated = await prisma.group.update({
      where: { id: group.id },
      data:  { status: GroupStatus.BUDGET_NEGOTIATION },
    });

    res.json({ status: updated.status });
  }
);

// ---------------------------------------------------------------------------
// POST /groups/:code/unlock-preferences  [admin only, member token]
// Reverts BUDGET_NEGOTIATION back to COLLECTING; clears downstream data if
// budget has been proposed/locked or planning has started.
// ---------------------------------------------------------------------------

groupsRouter.post(
  '/:code/unlock-preferences',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const group = await prisma.group.findUnique({
      where: { groupCode: req.params.code.toUpperCase() },
      include: {
        budgetRounds: { select: { id: true }, take: 1 },
        itineraries:  { select: { id: true }, take: 1 },
      },
    });
    if (!group) { res.status(404).json({ error: 'Group not found' }); return; }
    if (req.member!.groupId !== group.id) { res.status(403).json({ error: 'Forbidden' }); return; }

    if (group.status !== GroupStatus.BUDGET_NEGOTIATION) {
      res.status(409).json({ error: `Cannot unlock preferences from status "${group.status}"` });
      return;
    }

    const hasDownstream =
      group.lockedBudget !== null ||
      group.budgetRounds.length > 0 ||
      group.itineraries.length > 0;

    // Caller can pass { confirm: true } to acknowledge discarding downstream data.
    // If downstream data exists and confirm is missing, return a warning payload.
    const { confirm } = req.body as { confirm?: boolean };
    if (hasDownstream && !confirm) {
      res.status(200).json({
        requiresConfirmation: true,
        warning:
          'Unlocking preferences will discard all budget proposals and any generated itinerary. Pass { "confirm": true } to proceed.',
      });
      return;
    }

    await prisma.$transaction(async tx => {
      // Clear downstream: budget rounds (cascade deletes votes), itineraries (cascade deletes feedback)
      await tx.budgetRound.deleteMany({ where: { groupId: group.id } });
      await tx.itinerary.deleteMany({ where: { groupId: group.id } });

      // Reset preference profiles so members can re-edit; reset status to PENDING
      await tx.member.updateMany({
        where: { groupId: group.id },
        data: { preferenceStatus: 'PENDING' },
      });

      await tx.group.update({
        where: { id: group.id },
        data: { status: GroupStatus.COLLECTING, lockedBudget: null },
      });
    });

    res.json({ status: GroupStatus.COLLECTING, downstreamCleared: hasDownstream });
  }
);

// ---------------------------------------------------------------------------
// POST /groups/:code/trigger-planning  [admin only, member token]
// ---------------------------------------------------------------------------

groupsRouter.post(
  '/:code/trigger-planning',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const group = await prisma.group.findUnique({
      where: { groupCode: req.params.code.toUpperCase() },
    });
    if (!group) { res.status(404).json({ error: 'Group not found' }); return; }
    if (req.member!.groupId !== group.id) { res.status(403).json({ error: 'Forbidden' }); return; }

    if (group.status !== GroupStatus.BUDGET_NEGOTIATION) {
      res.status(409).json({ error: `Cannot trigger planning from status "${group.status}"` });
      return;
    }

    const updated = await prisma.group.update({
      where: { id: group.id },
      data:  { status: GroupStatus.PLANNING },
    });

    res.json({ status: updated.status });
  }
);

// ---------------------------------------------------------------------------
// GET /groups/:code/stream-generate  [admin only, token in query param]
// SSE endpoint: runs the pipeline with event callbacks, streams events to
// the client, saves the itinerary, then emits 'done'. Generation continues
// even if the client disconnects — the save always happens.
// EventSource can't send custom headers, so auth token comes in ?token=
// ---------------------------------------------------------------------------

groupsRouter.get(
  '/:code/stream-generate',
  async (req: Request, res: Response): Promise<void> => {
    // ── Auth via query param (EventSource limitation) ──────────────────────
    const tokenParam = req.query.token as string | undefined;
    if (!tokenParam) { res.status(401).json({ error: 'Missing token query param' }); return; }
    let memberInfo: import('../lib/jwt').MemberTokenPayload;
    try {
      const payload = verifyToken(tokenParam);
      if (!isMemberToken(payload)) { res.status(401).json({ error: 'Member token required' }); return; }
      memberInfo = payload;
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' }); return;
    }
    if (!memberInfo.isAdmin) { res.status(403).json({ error: 'Admin access required' }); return; }

    // ── Validate query params ──────────────────────────────────────────────
    const tripDuration        = parseInt(req.query.tripDuration as string, 10);
    const maxNegotiationRounds = Math.min(parseInt((req.query.maxNegotiationRounds as string) ?? '3', 10) || 3, 5);
    if (isNaN(tripDuration) || tripDuration < 1 || tripDuration > 30) {
      res.status(400).json({ error: 'tripDuration must be 1–30' }); return;
    }

    // ── Load group (same guards as the POST route) ─────────────────────────
    const group = await prisma.group.findUnique({
      where: { groupCode: req.params.code.toUpperCase() },
      include: {
        members: { include: { user: true, preferenceProfile: true } },
        budgetRounds: { orderBy: { roundNum: 'desc' }, take: 1 },
      },
    });
    if (!group) { res.status(404).json({ error: 'Group not found' }); return; }
    if (memberInfo.groupId !== group.id) { res.status(403).json({ error: 'Forbidden' }); return; }

    if (group.status !== GroupStatus.PLANNING && group.status !== GroupStatus.BUDGET_NEGOTIATION) {
      res.status(409).json({ error: `Cannot generate from status "${group.status}"` }); return;
    }
    if (!group.destination) {
      res.status(409).json({ error: 'Group must have a destination set.' }); return;
    }

    const lockedBudget = group.lockedBudget
      ? parseFloat(group.lockedBudget.toString())
      : (group.budgetRounds[0]?.proposed ? parseFloat(group.budgetRounds[0].proposed.toString()) : null);
    if (!lockedBudget || lockedBudget <= 0) {
      res.status(409).json({ error: 'Locked budget required before generating.' }); return;
    }

    const MIN_GROUP_SIZE = parseInt(process.env.MIN_PLANNING_GROUP_SIZE ?? '3', 10);
    const completedCount = group.members.filter(m => m.preferenceStatus === 'COMPLETE').length;
    if (completedCount < MIN_GROUP_SIZE) {
      res.status(409).json({ error: `Need ${MIN_GROUP_SIZE} completed profiles, have ${completedCount}.` }); return;
    }

    const defaultConstraints: ConstraintFields = { dietaryRestrictions: [], alcoholPreference: 'sometimes' };
    const members: MemberPreferenceSnapshot[] = [];
    for (const m of group.members) {
      if (!m.preferenceProfile) continue;
      const profile = m.preferenceProfile as unknown as {
        scores: PreferenceScores; priorities: PreferencePriorities;
        constraintFields?: ConstraintFields; chatNuance?: string;
      };
      members.push({
        memberId: m.id, userId: m.userId ?? m.id, name: m.name,
        scores: profile.scores, priorities: profile.priorities,
        constraints: profile.constraintFields ?? defaultConstraints,
        chatNuance: profile.chatNuance ?? null,
      });
    }
    if (members.length === 0) {
      res.status(409).json({ error: 'No members with complete preference profiles.' }); return;
    }

    const ctx = { destination: group.destination, tripDuration, groupSize: members.length, lockedBudget, members };

    // ── Open SSE stream ────────────────────────────────────────────────────
    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    function sendEvent(event: StreamEvent): void {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    // ── Run pipeline — save completes even if client disconnects ───────────
    try {
      const result = await runOrchestrator(ctx, maxNegotiationRounds, sendEvent);

      const itinerary = result.itinerary as {
        dayPlans: unknown; budgetBreakdown: unknown;
        satisfactionScores: unknown; tradeoffReport: string; adminOverrideFlag: boolean;
      };

      const existing = await prisma.itinerary.findFirst({
        where: { groupId: group.id }, orderBy: { version: 'desc' }, select: { version: true },
      });
      const version = (existing?.version ?? 0) + 1;

      const saved = await prisma.$transaction(async tx => {
        const record = await tx.itinerary.create({
          data: {
            groupId: group.id, version,
            dayPlans:           itinerary.dayPlans           as object,
            budgetBreakdown:    itinerary.budgetBreakdown    as object,
            satisfactionScores: itinerary.satisfactionScores as object,
            tradeoffReport:     itinerary.tradeoffReport,
          },
        });
        if (!itinerary.adminOverrideFlag && group.status !== GroupStatus.COMPLETE) {
          await tx.group.update({ where: { id: group.id }, data: { status: GroupStatus.COMPLETE } });
        }
        return record;
      });

      sendEvent({ type: 'done', itineraryId: saved.id, version: saved.version });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Pipeline failed';
      sendEvent({ type: 'agent_error', agent: 'orchestrator', message: msg });
    } finally {
      res.end();
    }
  },
);

// ---------------------------------------------------------------------------
// POST /groups/:code/generate-itinerary  [admin only, member token]
// Runs the full planning pipeline: agent proposals → negotiation → consensus
// → itinerary assembly → save Itinerary v1 to DB.
// ---------------------------------------------------------------------------

const GenerateItineraryBodySchema = z.object({
  tripDuration:         z.number().int().min(1).max(30),   // nights
  maxNegotiationRounds: z.number().int().min(1).max(5).optional(),
});

groupsRouter.post(
  '/:code/generate-itinerary',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = GenerateItineraryBodySchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

    const group = await prisma.group.findUnique({
      where: { groupCode: req.params.code.toUpperCase() },
      include: {
        members: {
          include: {
            user:              true,
            preferenceProfile: true,
          },
        },
        budgetRounds: {
          orderBy: { roundNum: 'desc' },
          take: 1,
        },
      },
    });

    if (!group) { res.status(404).json({ error: 'Group not found' }); return; }
    if (req.member!.groupId !== group.id) { res.status(403).json({ error: 'Forbidden' }); return; }

    if (group.status !== GroupStatus.PLANNING && group.status !== GroupStatus.BUDGET_NEGOTIATION) {
      res.status(409).json({ error: `Cannot generate itinerary from status "${group.status}"` });
      return;
    }

    // MVP: destination is a required INPUT — must be set at group creation or before planning
    if (!group.destination) {
      res.status(409).json({ error: 'Group must have a destination set before generating an itinerary.' });
      return;
    }

    // Require a locked budget
    const lockedBudget = group.lockedBudget
      ? parseFloat(group.lockedBudget.toString())
      : (group.budgetRounds[0]?.proposed ? parseFloat(group.budgetRounds[0].proposed.toString()) : null);

    if (!lockedBudget || lockedBudget <= 0) {
      res.status(409).json({ error: 'A locked budget is required before generating an itinerary.' });
      return;
    }

    // MVP: minimum group size before planning is triggered
    const MIN_GROUP_SIZE = parseInt(process.env.MIN_PLANNING_GROUP_SIZE ?? '3', 10);
    const completedCount = group.members.filter(m => m.preferenceStatus === 'COMPLETE').length;
    if (completedCount < MIN_GROUP_SIZE) {
      res.status(409).json({
        error: `At least ${MIN_GROUP_SIZE} members must complete preferences before planning. Currently ${completedCount} complete.`,
        completedCount,
        required: MIN_GROUP_SIZE,
      });
      return;
    }

    // Build member preference snapshots — only members with complete profiles
    const members: MemberPreferenceSnapshot[] = [];
    for (const m of group.members) {
      if (!m.preferenceProfile) continue;
      const profile = m.preferenceProfile as unknown as {
        scores: PreferenceScores;
        priorities: PreferencePriorities;
        constraintFields?: ConstraintFields;
        chatNuance?: string;
      };

      const defaultConstraints: ConstraintFields = {
        dietaryRestrictions: [],
        alcoholPreference:   'sometimes',
      };

      members.push({
        memberId:    m.id,
        userId:      m.userId ?? m.id,
        name:        m.name,
        scores:      profile.scores,
        priorities:  profile.priorities,
        constraints: profile.constraintFields ?? defaultConstraints,
        chatNuance:  profile.chatNuance ?? null,
      });
    }

    if (members.length === 0) {
      res.status(409).json({ error: 'No members have completed preference profiles.' });
      return;
    }

    const ctx = {
      destination:  group.destination,
      tripDuration: parsed.data.tripDuration,
      groupSize:    members.length,
      lockedBudget,
      members,
    };

    // Run the full pipeline
    let result;
    try {
      result = await runOrchestrator(ctx, parsed.data.maxNegotiationRounds ?? 3);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Planning pipeline failed';
      res.status(502).json({ error: `Orchestrator error: ${msg}` });
      return;
    }

    const itinerary = result.itinerary as {
      dayPlans:           unknown;
      budgetBreakdown:    unknown;
      satisfactionScores: unknown;
      tradeoffReport:     string;
      adminOverrideFlag:  boolean;
    };

    // Determine next version number
    const existing = await prisma.itinerary.findFirst({
      where:   { groupId: group.id },
      orderBy: { version: 'desc' },
      select:  { version: true },
    });
    const version = (existing?.version ?? 0) + 1;

    // Persist
    const saved = await prisma.$transaction(async tx => {
      const record = await tx.itinerary.create({
        data: {
          groupId:           group.id,
          version,
          dayPlans:          itinerary.dayPlans as object,
          budgetBreakdown:   itinerary.budgetBreakdown as object,
          satisfactionScores: itinerary.satisfactionScores as object,
          tradeoffReport:    itinerary.tradeoffReport,
        },
      });

      // Advance group to COMPLETE if consensus succeeded without admin override
      if (!itinerary.adminOverrideFlag && group.status !== GroupStatus.COMPLETE) {
        await tx.group.update({
          where: { id: group.id },
          data:  { status: GroupStatus.COMPLETE },
        });
      }

      return record;
    });

    res.status(201).json({
      id:                saved.id,
      version:           saved.version,
      adminOverrideFlag: itinerary.adminOverrideFlag,
      consensusStatus:   (result.consensus as { status: string }).status,
      negotiationRounds: (result.negotiation as { rounds: unknown[] }).rounds.length,
      dayPlans:          itinerary.dayPlans,
      budgetBreakdown:   itinerary.budgetBreakdown,
      satisfactionScores: itinerary.satisfactionScores,
      tradeoffReport:    itinerary.tradeoffReport,
      generatedAt:       saved.createdAt.toISOString(),
      createdAt:         saved.createdAt.toISOString(),
      durationMs:        result.durationMs,
    });
  }
);

// ---------------------------------------------------------------------------
// GET /groups/:code/itinerary  — fetch the latest saved itinerary
// ---------------------------------------------------------------------------

groupsRouter.get(
  '/:code/itinerary',
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    const group = await prisma.group.findUnique({
      where: { groupCode: req.params.code.toUpperCase() },
    });
    if (!group) { res.status(404).json({ error: 'Group not found' }); return; }

    // Verify membership
    if (req.member) {
      if (req.member.groupId !== group.id) {
        res.status(403).json({ error: 'You are not a member of this group' }); return;
      }
    } else if (req.user) {
      const isMember = await prisma.member.findFirst({
        where: { groupId: group.id, userId: req.user.userId },
      });
      if (!isMember) { res.status(403).json({ error: 'You are not a member of this group' }); return; }
    } else {
      res.status(401).json({ error: 'Authentication required' }); return;
    }

    const itinerary = await prisma.itinerary.findFirst({
      where:   { groupId: group.id },
      orderBy: { version: 'desc' },
    });

    if (!itinerary) {
      res.status(404).json({ error: 'No itinerary found for this group' });
      return;
    }

    res.json({
      id:                 itinerary.id,
      version:            itinerary.version,
      dayPlans:           itinerary.dayPlans,
      budgetBreakdown:    itinerary.budgetBreakdown,
      satisfactionScores: itinerary.satisfactionScores,
      tradeoffReport:     itinerary.tradeoffReport,
      adminOverrideFlag:  false,
      negotiationRounds:  0,
      generatedAt:        itinerary.createdAt.toISOString(),
      createdAt:          itinerary.createdAt.toISOString(),
    });
  }
);

// ---------------------------------------------------------------------------
// POST /groups/:code/admin-approve-itinerary  [admin only]
// When consensus fails the fairness floor, the admin can approve the best-
// available itinerary anyway. Marks it as admin-approved and advances to COMPLETE.
// ---------------------------------------------------------------------------

groupsRouter.post(
  '/:code/admin-approve-itinerary',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const group = await prisma.group.findUnique({
      where: { groupCode: req.params.code.toUpperCase() },
    });
    if (!group) { res.status(404).json({ error: 'Group not found' }); return; }
    if (req.member!.groupId !== group.id) { res.status(403).json({ error: 'Forbidden' }); return; }

    const itinerary = await prisma.itinerary.findFirst({
      where:   { groupId: group.id },
      orderBy: { version: 'desc' },
    });
    if (!itinerary) {
      res.status(404).json({ error: 'No itinerary to approve. Generate one first.' });
      return;
    }

    // Advance to COMPLETE and tag the itinerary as admin-approved
    await prisma.$transaction(async tx => {
      await tx.group.update({
        where: { id: group.id },
        data:  { status: GroupStatus.COMPLETE },
      });
      // Patch the satisfactionScores blob to record adminApproved flag
      const scores = (itinerary.satisfactionScores as Record<string, unknown>) ?? {};
      await tx.itinerary.update({
        where: { id: itinerary.id },
        data:  { satisfactionScores: { ...scores, adminApproved: true, adminApprovedAt: new Date().toISOString() } },
      });
    });

    res.json({ approved: true, itineraryId: itinerary.id, version: itinerary.version });
  }
);

// ---------------------------------------------------------------------------
// POST /groups/:code/nudge-members  [admin only]
// Sends a lightweight nudge payload for members who haven't submitted yet.
// Returns the list of pending members so the frontend can display them.
// (In production this would send an email/push; for MVP it returns the list.)
// ---------------------------------------------------------------------------

groupsRouter.post(
  '/:code/nudge-members',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const group = await prisma.group.findUnique({
      where: { groupCode: req.params.code.toUpperCase() },
      include: {
        members: { select: { id: true, name: true, preferenceStatus: true, userId: true } },
      },
    });
    if (!group) { res.status(404).json({ error: 'Group not found' }); return; }
    if (req.member!.groupId !== group.id) { res.status(403).json({ error: 'Forbidden' }); return; }

    const pending = group.members.filter(m => m.preferenceStatus !== 'COMPLETE');

    // MVP: return nudge data — no email integration yet
    res.json({
      nudged: pending.map(m => ({ id: m.id, name: m.name, status: m.preferenceStatus })),
      message: `${pending.length} member(s) notified to complete their preferences.`,
      shareCode: group.groupCode,
      groupName: group.name,
    });
  }
);

// ---------------------------------------------------------------------------
// PATCH /groups/:code/set-deadline  [admin only]
// Sets the preference submission deadline on the group.
// ---------------------------------------------------------------------------

const SetDeadlineSchema = z.object({
  deadline: z.string().datetime({ message: 'deadline must be an ISO 8601 datetime string' }),
});

groupsRouter.patch(
  '/:code/set-deadline',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = SetDeadlineSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

    const group = await prisma.group.findUnique({
      where: { groupCode: req.params.code.toUpperCase() },
    });
    if (!group) { res.status(404).json({ error: 'Group not found' }); return; }
    if (req.member!.groupId !== group.id) { res.status(403).json({ error: 'Forbidden' }); return; }

    const updated = await prisma.group.update({
      where: { id: group.id },
      data:  { submissionDeadline: new Date(parsed.data.deadline) },
    });

    res.json({ deadline: updated.submissionDeadline?.toISOString() ?? null });
  }
);

// ---------------------------------------------------------------------------
// DELETE /groups/:code/members/:memberId  [admin only, member token]
// Admin kicks a member. Admin cannot kick themselves.
// Deletes member's PreferenceProfile, ChatMessages, BudgetVotes, Feedback.
// (Cascade on Member → those all delete automatically via onDelete: Cascade)
// ---------------------------------------------------------------------------

groupsRouter.delete(
  '/:code/members/:memberId',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const group = await prisma.group.findUnique({
      where: { groupCode: req.params.code.toUpperCase() },
    });
    if (!group) { res.status(404).json({ error: 'Group not found' }); return; }
    if (req.member!.groupId !== group.id) { res.status(403).json({ error: 'Forbidden' }); return; }

    const { memberId } = req.params;

    // Admin cannot remove themselves via this endpoint
    if (memberId === req.member!.memberId) {
      res.status(400).json({ error: 'You cannot remove yourself as admin. Use "leave group" to transfer admin or disband.' });
      return;
    }

    const target = await prisma.member.findFirst({
      where: { id: memberId, groupId: group.id },
    });
    if (!target) {
      res.status(404).json({ error: 'Member not found in this group' });
      return;
    }

    await prisma.member.delete({ where: { id: memberId } });

    res.json({ removed: true, memberId });
  }
);

// ---------------------------------------------------------------------------
// POST /groups/:code/leave  [any member, member token]
// Member leaves the group. Their Member row + all related data is deleted.
// - If the admin tries to leave while other members remain → blocked (must transfer admin first).
// - If the last member leaves → group is archived (deleted).
// ---------------------------------------------------------------------------

groupsRouter.post(
  '/:code/leave',
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    if (!req.member) {
      res.status(401).json({ error: 'Member token required' });
      return;
    }

    const group = await prisma.group.findUnique({
      where: { groupCode: req.params.code.toUpperCase() },
      include: { members: { select: { id: true, isAdmin: true } } },
    });
    if (!group) { res.status(404).json({ error: 'Group not found' }); return; }
    if (req.member.groupId !== group.id) { res.status(403).json({ error: 'Forbidden' }); return; }

    const me = group.members.find(m => m.id === req.member!.memberId);
    if (!me) { res.status(404).json({ error: 'You are not in this group' }); return; }

    const remainingAfterLeave = group.members.filter(m => m.id !== me.id);

    // Admin cannot leave if other members remain — must transfer admin first
    if (me.isAdmin && remainingAfterLeave.length > 0) {
      res.status(409).json({
        error: 'As the organizer, you cannot leave while other members remain. Transfer organizer role first.',
      });
      return;
    }

    if (remainingAfterLeave.length === 0) {
      // Last member — delete the whole group (cascade deletes everything)
      await prisma.group.delete({ where: { id: group.id } });
      res.json({ left: true, groupDeleted: true });
    } else {
      await prisma.member.delete({ where: { id: me.id } });
      res.json({ left: true, groupDeleted: false });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /groups/:code/finalize  [admin only, member token]
// Officially finalizes a specific itinerary version as the group's trip plan.
// Body: { itineraryId: string }
// Sets Group.finalItineraryId, Group.finalizedAt, Group.status = COMPLETE.
// Can be re-called to change the finalized version (re-finalize).
// ---------------------------------------------------------------------------

const FinalizeBodySchema = z.object({
  itineraryId: z.string().min(1),
});

groupsRouter.post(
  '/:code/finalize',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = FinalizeBodySchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

    const group = await prisma.group.findUnique({
      where: { groupCode: req.params.code.toUpperCase() },
    });
    if (!group) { res.status(404).json({ error: 'Group not found' }); return; }
    if (req.member!.groupId !== group.id) { res.status(403).json({ error: 'Forbidden' }); return; }

    // Verify the itinerary belongs to this group
    const itinerary = await prisma.itinerary.findFirst({
      where: { id: parsed.data.itineraryId, groupId: group.id },
    });
    if (!itinerary) {
      res.status(404).json({ error: 'Itinerary not found in this group' });
      return;
    }

    // Read quality signals from the stored JSON so we can surface guardrail info
    const budget  = itinerary.budgetBreakdown as Record<string, unknown>;
    const scores  = itinerary.satisfactionScores as Record<string, unknown>;
    const surplus = typeof budget.surplus === 'number' ? budget.surplus : null;
    const fairnessFloorMet = typeof scores.fairnessFloorMet === 'boolean' ? scores.fairnessFloorMet : true;

    const warnings: string[] = [];
    if (surplus !== null && surplus < 0) {
      warnings.push(`This plan is over budget by $${Math.abs(surplus).toFixed(0)}.`);
    }
    if (!fairnessFloorMet) {
      warnings.push('One or more members are below the 70% satisfaction floor.');
    }

    // Persist the finalization
    await prisma.group.update({
      where: { id: group.id },
      data: {
        finalItineraryId: itinerary.id,
        finalizedAt:      new Date(),
        status:           GroupStatus.COMPLETE,
      },
    });

    res.json({
      finalized:   true,
      itineraryId: itinerary.id,
      version:     itinerary.version,
      finalizedAt: new Date().toISOString(),
      warnings,
    });
  }
);

// ---------------------------------------------------------------------------
// POST /groups/:code/unfinalize  [admin only, member token]
// Removes the finalization — group reverts to PLANNING status so the admin
// can pick a different version or regenerate.
// ---------------------------------------------------------------------------

groupsRouter.post(
  '/:code/unfinalize',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const group = await prisma.group.findUnique({
      where: { groupCode: req.params.code.toUpperCase() },
    });
    if (!group) { res.status(404).json({ error: 'Group not found' }); return; }
    if (req.member!.groupId !== group.id) { res.status(403).json({ error: 'Forbidden' }); return; }

    if (!group.finalItineraryId) {
      res.status(409).json({ error: 'Group is not finalized' });
      return;
    }

    await prisma.group.update({
      where: { id: group.id },
      data: {
        finalItineraryId: null,
        finalizedAt:      null,
        status:           GroupStatus.PLANNING,
      },
    });

    res.json({ unfinalized: true });
  }
);

// ---------------------------------------------------------------------------
// GET /groups/:code/final  [any authenticated member, member token]
// Returns the finalized itinerary for display to all group members.
// Returns { finalized: false } when no version is finalized yet.
// ---------------------------------------------------------------------------

groupsRouter.get(
  '/:code/final',
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    const group = await prisma.group.findUnique({
      where: { groupCode: req.params.code.toUpperCase() },
      include: { finalItinerary: true },
    });
    if (!group) { res.status(404).json({ error: 'Group not found' }); return; }

    // Verify membership (member token)
    if (req.member) {
      if (req.member.groupId !== group.id) {
        res.status(403).json({ error: 'You are not a member of this group' }); return;
      }
    } else if (req.user) {
      const isMember = await prisma.member.findFirst({
        where: { groupId: group.id, userId: req.user.userId },
      });
      if (!isMember) { res.status(403).json({ error: 'You are not a member of this group' }); return; }
    } else {
      res.status(401).json({ error: 'Authentication required' }); return;
    }

    if (!group.finalItineraryId || !group.finalItinerary) {
      res.json({ finalized: false });
      return;
    }

    const it = group.finalItinerary;
    res.json({
      finalized:          true,
      finalizedAt:        group.finalizedAt?.toISOString() ?? null,
      itinerary: {
        id:                 it.id,
        version:            it.version,
        dayPlans:           it.dayPlans,
        budgetBreakdown:    it.budgetBreakdown,
        satisfactionScores: it.satisfactionScores,
        tradeoffReport:     it.tradeoffReport,
        adminOverrideFlag:  false,
        negotiationRounds:  0,
        generatedAt:        it.createdAt.toISOString(),
        createdAt:          it.createdAt.toISOString(),
      },
    });
  }
);
