import crypto from 'crypto';

/** Cryptographically random 6-digit code, zero-padded. */
export const generateOtp = (): string => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 45 * 1000;

export const maskEmail = (email: string) => {
  const [name, domain] = email.split('@');
  if (!domain) return email;
  return `${name.slice(0, 1)}${'*'.repeat(Math.max(2, Math.min(6, name.length - 1)))}@${domain}`;
};
