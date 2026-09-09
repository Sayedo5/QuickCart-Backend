import http from 'http';
import { createApp } from './app';
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
    console.log(`   email OTP: ${env.mailEnabled ? 'SMTP' : 'console (dev)'} · uploads: ${env.cloudinaryEnabled ? 'Cloudinary' : 'disabled'}\n`);
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
