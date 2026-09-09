import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../config/db';
import { env } from '../config/env';
import { sendOtpEmail } from '../services/emailService';
import { AppError, unauthorized } from '../utils/errors';
import { issueRefreshToken, revokeRefreshToken, rotateRefreshToken, signAccessToken, signSignupToken, verifySignupToken } from '../utils/jwt';
import { generateOtp, maskEmail, OTP_MAX_ATTEMPTS, OTP_RESEND_COOLDOWN_MS, OTP_TTL_MS } from '../utils/otp';
import { ok } from '../utils/response';
import { userOut } from '../utils/serialize';
import type { User } from '@prisma/client';

const issueSession = async (user: User) => ({
  user: userOut(user),
  tokens: {
    accessToken: signAccessToken({ sub: user.id, role: user.role, email: user.email }),
    refreshToken: await issueRefreshToken(user.id),
  },
});

/** POST /api/auth/send-otp — emails a 6-digit code (or logs it in dev without SMTP). */
export const sendOtp = async (req: Request, res: Response) => {
  const { email, purpose } = req.body as { email: string; purpose: 'login' | 'signup' };

  const user = await prisma.user.findUnique({ where: { email } });
  if (user?.isBlocked) throw new AppError('BLOCKED', 'This account has been blocked. Contact support.', 403);

  const recent = await prisma.otp.findFirst({ where: { email }, orderBy: { createdAt: 'desc' } });
  if (recent && Date.now() - recent.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((OTP_RESEND_COOLDOWN_MS - (Date.now() - recent.createdAt.getTime())) / 1000);
    throw new AppError('OTP_COOLDOWN', `Please wait ${wait}s before requesting another code.`, 429);
  }

  const code = generateOtp();
  await prisma.otp.updateMany({ where: { email, isUsed: false }, data: { isUsed: true } });
  await prisma.otp.create({ data: { email, code, purpose: purpose === 'signup' ? 'SIGNUP' : 'LOGIN', expiresAt: new Date(Date.now() + OTP_TTL_MS) } });
  const { delivered } = await sendOtpEmail(email, code, purpose);

  ok(res, {
    sessionId: email,
    destination: maskEmail(email),
    channel: 'email',
    expiresIn: OTP_TTL_MS / 1000,
    isNewUser: !user,
    // Only ever present in development without SMTP, so the app can be tested end-to-end.
    ...(delivered || env.isProd ? {} : { devCode: code }),
  }, delivered ? 'Verification code sent.' : 'Verification code generated (check the server console).');
};

/** POST /api/auth/verify-otp — returns a session for existing users or a signupToken for new ones. */
export const verifyOtp = async (req: Request, res: Response) => {
  const { email, code } = req.body as { email: string; code: string };
  const otp = await prisma.otp.findFirst({ where: { email, isUsed: false }, orderBy: { createdAt: 'desc' } });
  if (!otp) throw new AppError('SESSION_EXPIRED', 'Your session expired. Please request a new code.', 400);
  if (otp.expiresAt < new Date()) throw new AppError('OTP_EXPIRED', 'This code has expired. Please request a new one.', 400);
  if (otp.attempts >= OTP_MAX_ATTEMPTS) throw new AppError('OTP_LOCKED', 'Too many wrong attempts. Please request a new code.', 429);

  if (otp.code !== code) {
    await prisma.otp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    const left = OTP_MAX_ATTEMPTS - otp.attempts - 1;
    throw new AppError('INVALID_OTP', left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Incorrect code. Please request a new one.', 400);
  }

  await prisma.otp.update({ where: { id: otp.id }, data: { isUsed: true } });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return ok(res, { isNewUser: true, signupToken: signSignupToken(email) }, 'Email verified. Complete your profile to finish.');
  }
  if (user.isBlocked) throw new AppError('BLOCKED', 'This account has been blocked. Contact support.', 403);
  const verified = user.isVerified ? user : await prisma.user.update({ where: { id: user.id }, data: { isVerified: true } });
  ok(res, { isNewUser: false, ...(await issueSession(verified)) }, 'Signed in.');
};

/** POST /api/auth/signup — completes registration after the email was verified. */
export const signup = async (req: Request, res: Response) => {
  const { signupToken, name, phone, dialCode } = req.body as { signupToken: string; name: string; phone: string; dialCode: string };
  const email = verifySignupToken(signupToken);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.isBlocked) throw new AppError('BLOCKED', 'This account has been blocked.', 403);
    return ok(res, await issueSession(existing), 'Signed in.');
  }
  const user = await prisma.user.create({ data: { name, email, phone, dialCode, isVerified: true } });
  // Seed the customer's default payment options so checkout works immediately.
  await prisma.paymentMethod.createMany({
    data: [
      { userId: user.id, type: 'CASH', label: 'Cash on Delivery', isDefault: true },
      { userId: user.id, type: 'WALLET', label: 'QuickCart Wallet' },
    ],
  });
  ok(res, await issueSession(user), 'Welcome to QuickCart!', 201);
};

/** POST /api/auth/admin/login — password login for admin-panel accounts only. */
export const adminLogin = async (req: Request, res: Response) => {
  const { email, password } = req.body as { email: string; password: string };
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.role !== 'ADMIN' || !user.passwordHash) throw unauthorized('Invalid email or password.');
  if (user.isBlocked) throw new AppError('BLOCKED', 'This account has been blocked.', 403);
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw unauthorized('Invalid email or password.');
  ok(res, await issueSession(user), 'Signed in.');
};

/** POST /api/auth/refresh — rotates the refresh token and issues a new access token. */
export const refresh = async (req: Request, res: Response) => {
  const { refreshToken } = req.body as { refreshToken: string };
  const { user, refreshToken: next } = await rotateRefreshToken(refreshToken);
  ok(res, { accessToken: signAccessToken({ sub: user.id, role: user.role, email: user.email }), refreshToken: next });
};

/** POST /api/auth/logout — revokes the refresh token (access tokens expire naturally). */
export const logout = async (req: Request, res: Response) => {
  const { refreshToken } = (req.body ?? {}) as { refreshToken?: string };
  if (refreshToken) await revokeRefreshToken(refreshToken);
  ok(res, null, 'Signed out.');
};

/** GET /api/auth/me */
export const me = async (req: Request, res: Response) => {
  ok(res, userOut(req.user!));
};
