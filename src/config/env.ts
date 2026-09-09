import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  APP_NAME: z.string().default('QuickCart'),
  CLIENT_ORIGINS: z.string().default('*'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DIRECT_URL: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 chars'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 chars'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().default(30),
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  MAIL_FROM: z.string().default('QuickCart <no-reply@quickcart.pk>'),
  CLOUDINARY_CLOUD_NAME: z.string().optional().default(''),
  CLOUDINARY_API_KEY: z.string().optional().default(''),
  CLOUDINARY_API_SECRET: z.string().optional().default(''),
  ADMIN_EMAIL: z.string().email().default('admin@quickcart.pk'),
  ADMIN_PASSWORD: z.string().min(8).default('Admin@12345'),
  ADMIN_NAME: z.string().default('QuickCart Admin'),
  EXPO_ACCESS_TOKEN: z.string().optional().default(''),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Fail fast with a readable list instead of crashing later with undefined values.
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = {
  ...parsed.data,
  isProd: parsed.data.NODE_ENV === 'production',
  clientOrigins: parsed.data.CLIENT_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  mailEnabled: !!parsed.data.SMTP_HOST && !!parsed.data.SMTP_USER,
  cloudinaryEnabled: !!parsed.data.CLOUDINARY_CLOUD_NAME && !!parsed.data.CLOUDINARY_API_KEY && !!parsed.data.CLOUDINARY_API_SECRET,
};
