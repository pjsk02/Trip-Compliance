import jwt from 'jsonwebtoken';

export interface UserTokenPayload {
  userId: string;
}

/** Legacy shape kept for member-level endpoints that still embed memberId+groupId. */
export interface MemberTokenPayload {
  memberId: string;
  groupId: string;
  isAdmin: boolean;
}

export type TokenPayload = UserTokenPayload | MemberTokenPayload;

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is not set');
  return s;
}

export function signUserToken(payload: UserTokenPayload): string {
  return jwt.sign(payload, secret(), { expiresIn: '30d' });
}

/** @deprecated — kept for member-scoped preference endpoints */
export function signToken(payload: MemberTokenPayload): string {
  return jwt.sign(payload, secret(), { expiresIn: '7d' });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, secret()) as TokenPayload;
}

export function isUserToken(p: TokenPayload): p is UserTokenPayload {
  return 'userId' in p && !('memberId' in p);
}

export function isMemberToken(p: TokenPayload): p is MemberTokenPayload {
  return 'memberId' in p;
}
