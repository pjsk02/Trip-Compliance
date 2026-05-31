import { Router, Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { prisma } from '../lib/prisma';
import { signUserToken } from '../lib/jwt';
import { requireUser } from '../middleware/auth';

export const authRouter = Router();

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ---------------------------------------------------------------------------
// POST /auth/google/verify
// Frontend sends the credential (ID token) from @react-oauth/google.
// We verify it with Google, then find-or-create the User, and issue our JWT.
// ---------------------------------------------------------------------------

authRouter.post('/google/verify', async (req: Request, res: Response): Promise<void> => {
  const { credential } = req.body as { credential?: string };
  if (!credential) {
    res.status(400).json({ error: 'credential is required' });
    return;
  }

  let googleId: string;
  let email: string;
  let name: string;
  let avatarUrl: string | undefined;

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub) throw new Error('No sub in Google payload');
    googleId  = payload.sub;
    email     = payload.email ?? '';
    name      = payload.name ?? email;
    avatarUrl = payload.picture;
  } catch {
    res.status(401).json({ error: 'Invalid Google credential' });
    return;
  }

  const user = await prisma.user.upsert({
    where:  { googleId },
    update: { email, name, avatarUrl },
    create: { googleId, email, name, avatarUrl },
  });

  const token = signUserToken({ userId: user.id });

  res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl },
  });
});

// ---------------------------------------------------------------------------
// GET /me — returns the logged-in user + their group memberships
// ---------------------------------------------------------------------------

authRouter.get('/me', requireUser, async (req: Request, res: Response): Promise<void> => {
  const { userId } = req.user!;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      members: {
        include: {
          group: {
            select: {
              id: true,
              name: true,
              groupCode: true,
              destination: true,
              status: true,
              adminMemberId: true,
              finalItineraryId: true,
              finalizedAt: true,
            },
          },
        },
        orderBy: { joinedAt: 'desc' },
      },
    },
  });

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const { members, ...userFields } = user;

  res.json({
    user: userFields,
    memberships: members.map((m) => ({
      memberId:        m.id,
      isAdmin:         m.isAdmin,
      preferenceStatus: m.preferenceStatus,
      joinedAt:        m.joinedAt,
      group:           m.group,
    })),
  });
});
