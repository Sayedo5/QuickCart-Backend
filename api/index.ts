import type { IncomingMessage, ServerResponse } from 'http';

/**
 * Vercel serverless entry point.
 *
 * An Express app is itself a `(req, res)` handler, so the whole API is exposed
 * through this single function; `vercel.json` rewrites every path to it and the
 * original URL is preserved, so `/api/v1/...` still matches inside Express.
 *
 * NOTE: Socket.io is intentionally NOT initialised here. Serverless functions
 * cannot hold persistent connections — see DEPLOY.md for the real-time options.
 */

type NodeHandler = (req: IncomingMessage, res: ServerResponse) => void;

let app: NodeHandler | null = null;
let initError: Error | null = null;

try {
  // Required lazily so a missing/invalid env var surfaces as readable JSON
  // instead of an opaque 500 with no body.
  const { createApp } = require('../src/app') as typeof import('../src/app');
  const { describeCorsConfig } = require('../src/config/cors') as typeof import('../src/config/cors');
  console.log(describeCorsConfig());
  app = createApp() as unknown as NodeHandler;
} catch (err) {
  initError = err instanceof Error ? err : new Error(String(err));
}

export default function handler(req: IncomingMessage, res: ServerResponse) {
  if (app) return app(req, res);
  res.statusCode = 500;
  res.setHeader('content-type', 'application/json');
  res.end(
    JSON.stringify({
      success: false,
      data: null,
      message: null,
      error: { code: 'CONFIG_ERROR', message: initError?.message ?? 'Server failed to initialise.' },
    }),
  );
}
