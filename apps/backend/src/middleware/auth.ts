import { Request, Response, NextFunction } from 'express';
import { verifyToken, isUserToken, isMemberToken, UserTokenPayload, MemberTokenPayload } from '../lib/jwt';

declare global {
  namespace Express {
    interface Request {
      /** Set when the token is a user-scoped JWT (Google auth). */
      user?: UserTokenPayload;
      /** Set when the token is the legacy member-scoped JWT. */
      member?: MemberTokenPayload;
    }
  }
}

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7);
}

/** Accepts both user-scoped and member-scoped JWTs. */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const token = extractBearer(req);
  if (!token) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }
  try {
    const payload = verifyToken(token);
    if (isUserToken(payload)) {
      req.user = payload;
    } else if (isMemberToken(payload)) {
      req.member = payload;
    }
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/** Requires a user-scoped JWT (issued after Google login). */
export function requireUser(req: Request, res: Response, next: NextFunction): void {
  const token = extractBearer(req);
  if (!token) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }
  try {
    const payload = verifyToken(token);
    if (!isUserToken(payload)) {
      res.status(401).json({ error: 'User authentication required' });
      return;
    }
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/** Requires a member-scoped JWT (legacy, preference flow). */
export function requireMember(req: Request, res: Response, next: NextFunction): void {
  const token = extractBearer(req);
  if (!token) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }
  try {
    const payload = verifyToken(token);
    if (!isMemberToken(payload)) {
      res.status(401).json({ error: 'Member authentication required' });
      return;
    }
    req.member = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.member?.isAdmin) {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}
