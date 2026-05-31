import { Router, Request, Response } from 'express';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { ChatRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { chatTurn, extractPreferences, detectCoverage } from '../lib/preferenceAgent';

export const membersRouter = Router();

// All member routes require authentication.
membersRouter.use(authenticate);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dbMessagesToParams(
  msgs: { role: ChatRole; content: string }[],
): MessageParam[] {
  return msgs.map(m => ({
    role: m.role === ChatRole.USER ? 'user' : 'assistant',
    content: m.content,
  }));
}

// Ownership guard: token holder must be the member themselves.
async function loadOwnedMember(req: Request, res: Response) {
  const member = await prisma.member.findUnique({
    where: { id: req.params.id },
    include: {
      group: { select: { destination: true, status: true } },
      chatMessages: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!member) { res.status(404).json({ error: 'Member not found' }); return null; }
  if (member.id !== req.member!.memberId) {
    res.status(403).json({ error: 'You can only access your own chat' });
    return null;
  }
  return member;
}

// ---------------------------------------------------------------------------
// GET /members/:id/chat — load full history + coverage state
// ---------------------------------------------------------------------------

membersRouter.get('/:id/chat', async (req: Request, res: Response): Promise<void> => {
  const member = await loadOwnedMember(req, res);
  if (!member) return;

  const history = dbMessagesToParams(member.chatMessages);
  const coverage = detectCoverage(history);

  res.json({
    messages: member.chatMessages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
    })),
    coverage,
    preferenceStatus: member.preferenceStatus,
  });
});

// ---------------------------------------------------------------------------
// POST /members/:id/chat — append user message, get agent reply
// ---------------------------------------------------------------------------

const ChatBodySchema = z.object({
  message: z.string().min(1).max(2000),
});

membersRouter.post('/:id/chat', async (req: Request, res: Response): Promise<void> => {
  const parsed = ChatBodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const member = await loadOwnedMember(req, res);
  if (!member) return;

  if (member.preferenceStatus === 'COMPLETE') {
    res.status(409).json({ error: 'Preferences already finalized. No further chat needed.' });
    return;
  }

  const { message } = parsed.data;

  // Bump status to IN_PROGRESS on first message
  if (member.preferenceStatus === 'PENDING') {
    await prisma.member.update({
      where: { id: member.id },
      data: { preferenceStatus: 'IN_PROGRESS' },
    });
  }

  const history = dbMessagesToParams(member.chatMessages);

  // If this is the very first message, prepend an agent greeting
  let agentReply: string;
  let isComplete: boolean;

  if (history.length === 0 && message === '__init__') {
    // Synthetic greeting — client sends "__init__" to open the chat cold.
    agentReply = `Hi ${member.name}! I'm here to learn about your travel preferences for this trip${member.group.destination ? ` to ${member.group.destination}` : ''}. This will only take a few minutes and helps me build a trip everyone will love.\n\nLet's start with activities — are you more into outdoor adventures like hiking, or do you prefer cultural experiences like museums and local markets?`;
    isComplete = false;
  } else {
    const result = await chatTurn(
      history,
      message,
      member.name,
      member.group.destination,
    );
    agentReply = result.reply;
    isComplete = result.complete;
  }

  // Persist both turns atomically — skip user message for the __init__ synthetic turn
  const messagesToCreate =
    message === '__init__'
      ? [{ memberId: member.id, role: ChatRole.ASSISTANT, content: agentReply }]
      : [
          { memberId: member.id, role: ChatRole.USER, content: message },
          { memberId: member.id, role: ChatRole.ASSISTANT, content: agentReply },
        ];

  await prisma.chatMessage.createMany({ data: messagesToCreate });

  // Re-fetch full history for coverage calculation
  const updatedMessages = await prisma.chatMessage.findMany({
    where: { memberId: member.id },
    orderBy: { createdAt: 'asc' },
  });
  const updatedHistory = dbMessagesToParams(updatedMessages);
  const coverage = detectCoverage(updatedHistory);

  res.json({
    reply: agentReply,
    complete: isComplete,
    coverage,
  });
});

// ---------------------------------------------------------------------------
// POST /members/:id/finalize-preferences — extract + save structured profile
// ---------------------------------------------------------------------------

membersRouter.post('/:id/finalize-preferences', async (req: Request, res: Response): Promise<void> => {
  const member = await loadOwnedMember(req, res);
  if (!member) return;

  if (member.preferenceStatus === 'COMPLETE') {
    // Idempotent — return existing profile
    const profile = await prisma.preferenceProfile.findUnique({ where: { memberId: member.id } });
    res.json({ profile, alreadyComplete: true });
    return;
  }

  if (member.chatMessages.length < 4) {
    res.status(409).json({ error: 'Not enough conversation to extract preferences. Keep chatting!' });
    return;
  }

  const history = dbMessagesToParams(member.chatMessages);

  let profile;
  try {
    profile = await extractPreferences(history);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Extraction failed';
    res.status(502).json({ error: `Could not extract preferences: ${msg}` });
    return;
  }

  const { estimatedBudget, ...profileWithoutBudget } = profile;

  await prisma.$transaction(async tx => {
    // Upsert in case of retry
    await tx.preferenceProfile.upsert({
      where: { memberId: member.id },
      create: {
        memberId: member.id,
        scores: profileWithoutBudget.scores,
        priorities: profileWithoutBudget.priorities,
      },
      update: {
        scores: profileWithoutBudget.scores,
        priorities: profileWithoutBudget.priorities,
      },
    });

    await tx.member.update({
      where: { id: member.id },
      data: {
        preferenceStatus: 'COMPLETE',
        ...(estimatedBudget ? { privateBudget: estimatedBudget } : {}),
      },
    });
  });

  res.json({ profile: profileWithoutBudget });
});
