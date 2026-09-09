import rateLimit from 'express-rate-limit';

const envelope = (message: string) => ({ success: false, data: null, message: null, error: { code: 'RATE_LIMITED', message } });

/** General API limiter: generous, per IP. */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: envelope('Too many requests. Please slow down.'),
});

/** OTP requests: 1 per 45s is enforced in the service; this caps bursts per IP. */
export const otpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: envelope('Too many verification codes requested. Try again in an hour.'),
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: envelope('Too many sign-in attempts. Please wait a few minutes.'),
});
