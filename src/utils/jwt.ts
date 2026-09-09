import jwt, { SignOptions } from 'jsonwebtoken';
import crypto from 'crypto';
import { Role } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../config/db';
import { unauthorized } from './errors';

export interface AccessPayload {
  sub: string;
  role: Role;
  email: string;
}

export const signAccessToken = (payload: AccessPayload) =>
  jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: env.JWT_ACCESS_TTL as SignOptions['expiresIn'] });

export const verifyAccessToken = (token: string): AccessPayload => {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessPayload;
  } catch {
    throw unauthorized('Your session has expired. Please sign in again.');
  }
};

/** Refresh tokens are opaque random strings stored (and revocable) in the database. */
export const issueRefreshToken = async (userId: string) => {
  const token = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + env.JWT_REFRESH_TTL_DAYS * 86_400_000);
  await prisma.refreshToken.create({ data: { token, userId, expiresAt } });
  return token;
};

export const rotateRefreshToken = async (token: string) => {
  const existing = await prisma.refreshToken.findUnique({ where: { token }, include: { user: true } });
  if (!existing || existing.revokedAt || existing.expiresAt < new Date()) throw unauthorized('Refresh token is invalid or expired.');
  if (existing.user.isBlocked) throw unauthorized('This account has been blocked.');
  await prisma.refreshToken.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
  const next = await issueRefreshToken(existing.userId);
  return { user: existing.user, refreshToken: next };
};

export const revokeRefreshToken = async (token: string) => {
  await prisma.refreshToken.updateMany({ where: { token, revokedAt: null }, data: { revokedAt: new Date() } });
};

/** Short-lived token proving an email was verified, used to complete signup. */
export const signSignupToken = (email: string) => jwt.sign({ email, kind: 'signup' }, env.JWT_ACCESS_SECRET, { expiresIn: '20m' });

export const verifySignupToken = (token: string): string => {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as { email: string; kind: string };
    if (payload.kind !== 'signup') throw new Error('wrong kind');
    return payload.email;
  } catch {
    throw unauthorized('Your verification expired. Please request a new code.');
  }
};
