import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env';

/**
 * Transactional email. With SMTP configured (Gmail app password, Resend, Brevo…)
 * messages are sent for real; without it, in development, the OTP is printed to
 * the server console so the full flow still works locally.
 */

let transporter: Transporter | null = null;

const getTransporter = (): Transporter | null => {
  if (!env.mailEnabled) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    });
  }
  return transporter;
};

const otpTemplate = (code: string, purpose: string) => `
<!doctype html>
<html><body style="margin:0;padding:24px;background:#FAFAFA;font-family:Inter,Segoe UI,Arial,sans-serif;color:#1A1A1A">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 4px 12px rgba(0,0,0,.08)">
    <div style="font-size:22px;font-weight:700;color:#FF6B35;margin-bottom:8px">QuickCart</div>
    <h1 style="font-size:20px;margin:0 0 12px">Your ${purpose === 'signup' ? 'sign-up' : 'sign-in'} code</h1>
    <p style="color:#6B6B6B;margin:0 0 20px">Enter this 6-digit code in the app. It expires in 5 minutes.</p>
    <div style="font-size:36px;letter-spacing:10px;font-weight:700;text-align:center;padding:16px;background:#FFF1EB;border-radius:12px;color:#1A1A1A">${code}</div>
    <p style="color:#9A9A9A;font-size:12px;margin:20px 0 0">If you did not request this, you can safely ignore this email.</p>
  </div>
</body></html>`;

export const sendOtpEmail = async (to: string, code: string, purpose: 'login' | 'signup'): Promise<{ delivered: boolean }> => {
  const transport = getTransporter();
  if (!transport) {
    if (env.isProd) throw new Error('SMTP is not configured; cannot send OTP emails in production.');
    // eslint-disable-next-line no-console
    console.log(`\n📧 [dev] OTP for ${to} (${purpose}): ${code}\n`);
    return { delivered: false };
  }
  await transport.sendMail({
    from: env.MAIL_FROM,
    to,
    subject: `${code} is your QuickCart verification code`,
    text: `Your QuickCart verification code is ${code}. It expires in 5 minutes.`,
    html: otpTemplate(code, purpose),
  });
  return { delivered: true };
};

export const sendPlainEmail = async (to: string, subject: string, text: string) => {
  const transport = getTransporter();
  if (!transport) {
    // eslint-disable-next-line no-console
    if (!env.isProd) console.log(`\n📧 [dev] Email to ${to}: ${subject}\n${text}\n`);
    return;
  }
  await transport.sendMail({ from: env.MAIL_FROM, to, subject, text });
};
