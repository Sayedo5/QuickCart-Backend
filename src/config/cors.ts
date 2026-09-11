import type { CorsOptions } from 'cors';
import { env } from './env';

/**
 * Centralised CORS origin resolution.
 *
 * This module is the single source of truth for which origins may call the API
 * (both the Express app and the Socket.io handshake). It exists because a bare
 * `CLIENT_ORIGINS.split(',')` is unforgiving in ways that are invisible in
 * production: a trailing slash, a stray quote, a newline pasted into a hosting
 * dashboard, or simply a value that was never applied to the running service all
 * fail the same silent way — the `cors` package omits `Access-Control-Allow-Origin`
 * and the browser reports only "No 'Access-Control-Allow-Origin' header is present".
 */

/**
 * Origins that must work regardless of how CLIENT_ORIGINS is configured on the
 * host. The deployed admin panel lives at a known, stable URL, so treating it as
 * a build-time constant removes a hand-typed dashboard value from the critical
 * path of being able to log in at all.
 */
const BUILT_IN_ORIGINS = [
  'https://quick-cart-admin-eight.vercel.app',
  // Vercel gives every branch/preview deploy its own hostname, so the admin
  // panel's preview builds would otherwise be blocked until someone edits env.
  'https://*.vercel.app',
  'http://localhost:3000',
  'http://localhost:8081',
  'http://localhost:19006',
];

/**
 * Normalises one origin entry so cosmetic differences stop mattering.
 * Strips surrounding quotes, whitespace (including stray CR/LF from pasted
 * multi-line values), a trailing slash, and lowercases — origins are
 * case-insensitive in scheme/host, and `https://x.app/` never matches the
 * browser's `Origin: https://x.app`.
 */
export const normaliseOrigin = (value: string): string =>
  value
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim()
    .replace(/\/+$/, '')
    .toLowerCase();

/** Splits on commas *and* whitespace/newlines, so any pasted format works. */
const parseOriginList = (raw: string): string[] =>
  raw
    .split(/[,\s]+/)
    .map(normaliseOrigin)
    .filter(Boolean);

const envOrigins = parseOriginList(env.CLIENT_ORIGINS);

/** True when the configured list explicitly opts into "allow any origin". */
export const allowAnyOrigin = envOrigins.includes('*');

/** The effective allow-list: everything from env, plus the built-in defaults. */
export const allowedOrigins: string[] = Array.from(
  new Set([...envOrigins.filter((o) => o !== '*'), ...BUILT_IN_ORIGINS.map(normaliseOrigin)]),
);

/** Entries containing `*` become anchored regexes (`https://*.vercel.app`). */
const escapeRegExp = (part: string): string => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toPattern = (entry: string): RegExp =>
  new RegExp(`^${entry.split('*').map(escapeRegExp).join('[^.]*')}$`);

const exactOrigins = new Set(allowedOrigins.filter((o) => !o.includes('*')));
const wildcardOrigins = allowedOrigins.filter((o) => o.includes('*')).map(toPattern);

export const isOriginAllowed = (origin: string | undefined): boolean => {
  // Requests with no Origin header are not browser cross-origin requests:
  // the mobile app, curl, server-to-server calls and health checks all land
  // here and must not be rejected.
  if (!origin) return true;
  if (allowAnyOrigin) return true;
  const candidate = normaliseOrigin(origin);
  return exactOrigins.has(candidate) || wildcardOrigins.some((re) => re.test(candidate));
};

export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (isOriginAllowed(origin)) {
      // Reflect the caller's origin rather than returning `*`, which is
      // forbidden when credentials are enabled.
      return callback(null, origin ?? true);
    }
    // Log and reject *without* an error: passing an Error makes the preflight
    // fall through to the error handler and return 500 instead of a clean CORS
    // denial, which is far harder to diagnose from the browser.
    console.warn(`[cors] blocked origin: ${origin}`);
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  // Reflecting the requested headers keeps Authorization, Content-Type and any
  // future custom header working without another deploy.
  allowedHeaders: undefined,
  exposedHeaders: ['Content-Length', 'Content-Type'],
  maxAge: 86_400,
  // Some legacy browsers choke on 204 for preflight.
  optionsSuccessStatus: 204,
  preflightContinue: false,
};

/** Socket.io takes the same policy, expressed in its own option shape. */
export const socketCorsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) =>
    callback(null, isOriginAllowed(origin)),
  credentials: true,
};

/** Printed once at boot so the effective policy is verifiable from host logs. */
export const describeCorsConfig = (): string => {
  const lines = [
    `[cors] CLIENT_ORIGINS raw   : ${JSON.stringify(env.CLIENT_ORIGINS)}`,
    `[cors] parsed from env (${envOrigins.length}) : ${envOrigins.length ? envOrigins.join(', ') : '(none)'}`,
    `[cors] effective allow-list (${allowedOrigins.length}):`,
    ...allowedOrigins.map((o) => `[cors]   - ${o}`),
  ];
  if (allowAnyOrigin) lines.push('[cors] wildcard "*" present — all origins allowed');
  return lines.join('\n');
};
