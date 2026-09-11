import http from 'http';
import { createApp } from './app';
import { describeCorsConfig } from './config/cors';
import { disconnectDb, prisma } from './config/db';
import { env } from './config/env';
import { initSockets } from './sockets/orderSocket';

const start = async () => {
  await prisma.$queryRaw`SELECT 1`; // fail fast if the database is unreachable
  const app = createApp();
  const server = http.createServer(app);
  initSockets(server);

  server.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`\n🚀 ${env.APP_NAME} API listening on http://localhost:${env.PORT}  (${env.NODE_ENV})`);
    // eslint-disable-next-line no-console
    console.log(`   email OTP: ${env.mailEnabled ? 'SMTP' : 'console (dev)'} · uploads: ${env.cloudinaryEnabled ? 'Cloudinary' : 'disabled'}`);
    // Printed every boot so the effective CORS allow-list is verifiable straight
    // from the host's logs, without guessing at dashboard values.
    // eslint-disable-next-line no-console
    console.log(describeCorsConfig());
    // Production requires real SMTP: sendOtpEmail() throws rather than silently
    // logging the code to the console, so signup breaks with an opaque 500 if
    // these are missing. Surface it at boot instead of at first signup.
    if (env.isProd && !env.mailEnabled) {
      // eslint-disable-next-line no-console
      console.error(
        `[config] FATAL-ish: NODE_ENV=production but SMTP is not configured ` +
          `(SMTP_HOST=${env.SMTP_HOST ? 'set' : 'MISSING'}, SMTP_USER=${env.SMTP_USER ? 'set' : 'MISSING'}). ` +
          `POST /auth/send-otp will return 500 until both are set.`,
      );
    }
    // eslint-disable-next-line no-console
    console.log('');
  });

  const shutdown = async (signal: string) => {
    // eslint-disable-next-line no-console
    console.log(`\n${signal} received, shutting down…`);
    server.close(async () => {
      await disconnectDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
};

start().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start server:', err);
  process.exit(1);
});
