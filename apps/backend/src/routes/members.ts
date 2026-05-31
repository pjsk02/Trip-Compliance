import { Router, Request, Response } from 'express';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { ChatRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireMember } from '../middleware/auth';
import { chatTurn, extractChatNuance, extractPreferences, detectCoverage } from '../lib/preferenceAgent';
import {
  SliderValuesSchema,
  ConstraintFieldsSchema,
  derivePriorities,
  scoresFromSliders,
  type SliderValues,
  type ConstraintFields,
} from '../lib/preferenceSchema';

export const membersRouter = Router();

membersRouter.use(requireMember);

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

async function loadOwnedMember(req: Request, res: Response) {
  const member = await prisma.member.findUnique({
    where: { id: req.params.id },
    include: {
      group: { select: { destination: true, status: true } },
      chatMessages: { orderBy: { createdAt: 'asc' } },
      preferenceProfile: true,
    },
  });
  if (!member) { res.status(404).json({ error: 'Member not found' }); return null; }
  if (member.id !== req.member!.memberId) {
    res.status(403).json({ error: 'You can only access your own preferences' });
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

  // Pull saved slider/constraint data from profile if it exists
  const profile = member.preferenceProfile as { sliderValues?: unknown; constraintFields?: unknown } | null;

  res.json({
    messages: member.chatMessages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
    })),
    coverage,
    preferenceStatus: member.preferenceStatus,
    sliderValues: profile?.sliderValues ?? null,
    constraintFields: profile?.constraintFields ?? null,
  });
});

// ---------------------------------------------------------------------------
// POST /members/:id/save-sliders
// Saves slider values + constraint fields directly — no LLM involved.
// Creates/updates the PreferenceProfile and bumps status to IN_PROGRESS.
// ---------------------------------------------------------------------------

const SaveSlidersBodySchema = z.object({
  sliderValues:     SliderValuesSchema,
  constraintFields: ConstraintFieldsSchema,
});

membersRouter.post('/:id/save-sliders', async (req: Request, res: Response): Promise<void> => {
  const parsed = SaveSlidersBodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const member = await loadOwnedMember(req, res);
  if (!member) return;

  if (member.preferenceStatus === 'COMPLETE') {
    res.status(409).json({ error: 'Preferences already finalized.' });
    return;
  }

  const { sliderValues, constraintFields } = parsed.data;

  // Derive scores + priorities directly from slider values
  const scores     = scoresFromSliders(sliderValues, constraintFields);
  const priorities = derivePriorities(sliderValues);

  await prisma.$transaction(async tx => {
    await tx.preferenceProfile.upsert({
      where: { memberId: member.id },
      create: {
        memberId: member.id,
        scores,
        priorities,
        sliderValues: sliderValues as object,
        constraintFields: constraintFields as object,
      },
      update: {
        scores,
        priorities,
        sliderValues: sliderValues as object,
        constraintFields: constraintFields as object,
      },
    });

    if (member.preferenceStatus === 'PENDING') {
      await tx.member.update({
        where: { id: member.id },
        data: { preferenceStatus: 'IN_PROGRESS' },
      });
    }

    // Store budget privately on member record
    if (constraintFields.totalBudget) {
      await tx.member.update({
        where: { id: member.id },
        data: { privateBudget: constraintFields.totalBudget },
      });
    }
  });

  res.json({ scores, priorities });
});

// ---------------------------------------------------------------------------
// POST /members/:id/chat — clarifying chat turn (post-slider)
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
    res.status(409).json({ error: 'Preferences already finalized.' });
    return;
  }

  const { message } = parsed.data;
  const history = dbMessagesToParams(member.chatMessages);

  // Pull stored slider context so the AI can reference it
  const profile = member.preferenceProfile as {
    sliderValues?: SliderValues;
    constraintFields?: ConstraintFields;
  } | null;
  const sliders     = profile?.sliderValues     ?? undefined;
  const constraints = profile?.constraintFields ?? undefined;

  let agentReply: string;
  let isComplete: boolean;

  if (history.length === 0 && message === '__init__') {
    // Generate an opening clarifying message grounded in the slider context
    if (sliders && constraints) {
      const result = await chatTurn([], '__start__', member.name, member.group.destination, sliders, constraints);
      agentReply = result.reply;
      isComplete = result.complete;
    } else {
      // Fallback greeting when sliders haven't been submitted yet
      agentReply = `Hi ${member.name}! I'm here to help capture any nuance about your travel preferences${member.group.destination ? ` for your trip to ${member.group.destination}` : ''}. Once you've set your sliders, I'll ask a few quick follow-up questions to fill in the details.`;
      isComplete = false;
    }
  } else {
    const result = await chatTurn(history, message, member.name, member.group.destination, sliders, constraints);
    agentReply = result.reply;
    isComplete = result.complete;
  }

  const messagesToCreate =
    message === '__init__'
      ? [{ memberId: member.id, role: ChatRole.ASSISTANT, content: agentReply }]
      : [
          { memberId: member.id, role: ChatRole.USER, content: message },
          { memberId: member.id, role: ChatRole.ASSISTANT, content: agentReply },
        ];

  await prisma.chatMessage.createMany({ data: messagesToCreate });

  const updatedMessages = await prisma.chatMessage.findMany({
    where: { memberId: member.id },
    orderBy: { createdAt: 'asc' },
  });
  const updatedHistory = dbMessagesToParams(updatedMessages);
  const coverage = detectCoverage(updatedHistory);

  res.json({ reply: agentReply, complete: isComplete, coverage });
});

// ---------------------------------------------------------------------------
// POST /members/:id/finalize-preferences
// Merges slider scores + chat nuance into the final locked PreferenceProfile.
// ---------------------------------------------------------------------------

membersRouter.post('/:id/finalize-preferences', async (req: Request, res: Response): Promise<void> => {
  const member = await loadOwnedMember(req, res);
  if (!member) return;

  if (member.preferenceStatus === 'COMPLETE') {
    const profile = await prisma.preferenceProfile.findUnique({ where: { memberId: member.id } });
    res.json({ profile, alreadyComplete: true });
    return;
  }

  const existingProfile = member.preferenceProfile as {
    scores?: object;
    priorities?: object;
    sliderValues?: SliderValues;
    constraintFields?: ConstraintFields;
    chatNuance?: string;
  } | null;

  const history = dbMessagesToParams(member.chatMessages);

  // If we have slider data, use that as the base and layer chat nuance on top.
  if (existingProfile?.sliderValues && existingProfile?.constraintFields) {
    const sliders     = existingProfile.sliderValues;
    const constraints = existingProfile.constraintFields;

    const baseScores     = scoresFromSliders(sliders, constraints);
    const basePriorities = derivePriorities(sliders);

    // Extract nuance from chat (may be empty if member skipped chat)
    const { chatNuance, priorityOverrides } = await extractChatNuance(history);

    // Merge priority overrides into base priorities (overrides win)
    const mergedPriorities = {
      mustHave:   [...new Set([...basePriorities.mustHave,   ...priorityOverrides.mustHave])],
      niceToHave: [...new Set([...basePriorities.niceToHave, ...priorityOverrides.niceToHave])],
      neutral:    [...new Set([...basePriorities.neutral,    ...priorityOverrides.neutral])],
      avoid:      [...new Set([...basePriorities.avoid,      ...priorityOverrides.avoid])],
    };

    await prisma.$transaction(async tx => {
      await tx.preferenceProfile.upsert({
        where: { memberId: member.id },
        create: {
          memberId: member.id,
          scores: baseScores,
          priorities: mergedPriorities,
          sliderValues: sliders as object,
          constraintFields: constraints as object,
          chatNuance,
        },
        update: {
          scores: baseScores,
          priorities: mergedPriorities,
          chatNuance,
        },
      });

      await tx.member.update({
        where: { id: member.id },
        data: { preferenceStatus: 'COMPLETE' },
      });
    });

    res.json({
      profile: {
        scores: baseScores,
        priorities: mergedPriorities,
        sliderValues: sliders,
        constraintFields: constraints,
        chatNuance,
      },
    });
    return;
  }

  // Fallback: pure-chat path (no sliders — keeps backward compat)
  if (history.length < 4) {
    res.status(409).json({ error: 'Not enough conversation to extract preferences.' });
    return;
  }

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
    await tx.preferenceProfile.upsert({
      where: { memberId: member.id },
      create: { memberId: member.id, scores: profileWithoutBudget.scores, priorities: profileWithoutBudget.priorities },
      update: { scores: profileWithoutBudget.scores, priorities: profileWithoutBudget.priorities },
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
