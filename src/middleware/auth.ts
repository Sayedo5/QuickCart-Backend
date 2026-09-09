import { NextFunction, Request, Response } from 'express';
import { Role, User } from '@prisma/client';
import { prisma } from '../config/db';
import { forbidden, unauthorized } from '../utils/errors';
import { verifyAccessToken } from '../utils/jwt';

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

const bearer = (req: Request) => {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
};

/** Requires a valid access token; loads the user and rejects blocked accounts. */
export const requireAuth = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const token = bearer(req);
    if (!token) throw unauthorized();
    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw unauthorized('This account no longer exists.');
    if (user.isBlocked) throw forbidden('Your account has been blocked. Contact support.');
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
};

/** Attaches the user when a token is present but does not require one. */
export const optionalAuth = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const token = bearer(req);
    if (token) {
      const payload = verifyAccessToken(token);
      const user = await prisma.user.findUnique({ where: { id: payload.sub } });
      if (user && !user.isBlocked) req.user = user;
    }
  } catch {
    // ignore invalid tokens on public routes
  }
  next();
};

export const requireRole = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) return next(unauthorized());
  if (!roles.includes(req.user.role)) return next(forbidden());
  next();
};

export const requireAdmin = [requireAuth, requireRole('ADMIN')];
