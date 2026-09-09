import { PrismaClient } from '@prisma/client';
import { env } from './env';

/**
 * Single Prisma client for the whole process. Neon's pooled connection string
 * is used at runtime; migrations use DIRECT_URL (see prisma/schema.prisma).
 */
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

/**
 * On Vercel every request may land on a fresh, short-lived instance, so each one
 * must hold a single connection and skip prepared statements — Neon's pooled
 * endpoint is PgBouncer in transaction mode and cannot reuse them across
 * connections. A long-running server (local, Render, Railway) keeps the URL as-is.
 */
const runtimeDatabaseUrl = () => {
  if (!process.env.VERCEL) return env.DATABASE_URL;
  try {
    const url = new URL(env.DATABASE_URL);
    if (!url.searchParams.has('pgbouncer')) url.searchParams.set('pgbouncer', 'true');
    if (!url.searchParams.has('connection_limit')) url.searchParams.set('connection_limit', '1');
    return url.toString();
  } catch {
    return env.DATABASE_URL; // malformed URL: let Prisma report it
  }
};

export const prisma: PrismaClient =
  global.__prisma ??
  new PrismaClient({
    log: env.isProd ? ['error'] : ['warn', 'error'],
    datasources: { db: { url: runtimeDatabaseUrl() } },
  });

if (!env.isProd) global.__prisma = prisma;

export const disconnectDb = () => prisma.$disconnect();
