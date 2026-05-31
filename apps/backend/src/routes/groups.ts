import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { GroupStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/jwt';
import { generateUniqueGroupCode } from '../lib/groupCode';
import { authenticate, requireAdmin } from '../middleware/auth';

export const groupsRouter = Router();

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const CreateGroupSchema = z.object({
  name: z.string().min(1).max(100),
  destination: z.string().max(100).optional(),
  adminName: z.string().min(1).max(80),
  password: z.string().min(4).max(72), // bcrypt caps at 72 bytes
});

const JoinGroupSchema = z.object({
  name: z.string().min(1).max(80),
  password: z.string().min(1),
});

// ---------------------------------------------------------------------------
// POST /groups — create group, admin becomes first member
// ---------------------------------------------------------------------------

groupsRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateGroupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { name, destination, adminName, password } = parsed.data;

  const passwordHash = await bcrypt.hash(password, 10);
  const groupCode = await generateUniqueGroupCode();

  // Create group + admin member in a transaction so we never get an orphan group.
  const { group, adminMember } = await prisma.$transaction(async (tx) => {
    const group = await tx.group.create({
      data: { name, groupCode, passwordHash, destination },
    });
    const adminMember = await tx.member.create({
      data: { groupId: group.id, name: adminName, isAdmin: true },
    });
    await tx.group.update({
      where: { id: group.id },
      data: { adminMemberId: adminMember.id },
    });
    return { group, adminMember };
  });

  const token = signToken({ memberId: adminMember.id, groupId: group.id, isAdmin: true });

  res.status(201).json({
    groupCode: group.groupCode,
    password,           // returned once so admin can share it; never stored in plain text again
    token,
    member: { id: adminMember.id, name: adminMember.name, isAdmin: true },
  });
});

// ---------------------------------------------------------------------------
// POST /groups/:code/join
// ---------------------------------------------------------------------------

groupsRouter.post('/:code/join', async (req: Request, res: Response): Promise<void> => {
  const parsed = JoinGroupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { name, password } = parsed.data;

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

  if (group.status === GroupStatus.COMPLETE) {
    res.status(409).json({ error: 'This trip is already complete and not accepting new members' });
    return;
  }

  const member = await prisma.member.create({
    data: { groupId: group.id, name, isAdmin: false },
  });

  const token = signToken({ memberId: member.id, groupId: group.id, isAdmin: false });

  res.status(201).json({
    token,
    member: { id: member.id, name: member.name, isAdmin: false },
    group: { id: group.id, name: group.name, destination: group.destination, status: group.status },
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
          // Only expose privateBudget to admins
          privateBudget: req.member!.isAdmin,
        },
        orderBy: { joinedAt: 'asc' },
      },
    },
  });

  if (!group) {
    res.status(404).json({ error: 'Group not found' });
    return;
  }

  // Verify the token holder actually belongs to this group.
  if (req.member!.groupId !== group.id) {
    res.status(403).json({ error: 'You are not a member of this group' });
    return;
  }

  const { passwordHash: _pw, ...safeGroup } = group;
  res.json(safeGroup);
});

// ---------------------------------------------------------------------------
// POST /groups/:code/lock-preferences  [admin only]
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
      data: { status: GroupStatus.BUDGET_NEGOTIATION },
    });

    res.json({ status: updated.status });
  }
);

// ---------------------------------------------------------------------------
// POST /groups/:code/trigger-planning  [admin only]
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
      data: { status: GroupStatus.PLANNING },
    });

    res.json({ status: updated.status });
  }
);
