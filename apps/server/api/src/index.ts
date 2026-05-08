// MUST be the first import — populates process.env from the production
// secrets file before getEnv() reads it. See ./loadSecrets.ts for why.
import './loadSecrets.js';
import { serve } from '@hono/node-server';
import { Resend } from 'resend';
import { getEnv } from './env.js';
import { getLogger } from './logger.js';
import { initSentry } from './sentry.js';
import { createApp } from './app.js';
import { ResendEmailSender, InMemoryEmailSender, type EmailSender } from './email.js';
import { disconnectRedis } from './redis.js';
import { getPrisma } from '@flipturn/db';
import { enqueueScrapeAthlete } from '@flipturn/workers/queue';

async function main() {
  const env = getEnv();
  initSentry();
  const log = getLogger();

  const prisma = getPrisma();

  let email: EmailSender;
  if (env.RESEND_API_KEY) {
    email = new ResendEmailSender(new Resend(env.RESEND_API_KEY), env.EMAIL_FROM);
    log.info('Resend email sender initialized');
  } else {
    email = new InMemoryEmailSender();
    log.warn('RESEND_API_KEY not set — using InMemoryEmailSender (process-local)');
  }

  const app = createApp({
    prisma,
    email,
    enqueueScrape: async (job) => enqueueScrapeAthlete(job),
    baseUrl: env.BASE_URL,
    mobileDeepLinkBase: env.MOBILE_DEEP_LINK_BASE,
  });

  const server = serve({
    fetch: app.fetch,
    port: env.PORT,
  });

  log.info({ port: env.PORT }, 'flipturn api listening');

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'shutting down');

    // Hard timeout so a stuck socket doesn't hang shutdown forever.
    const hardTimeout = setTimeout(() => {
      log.warn('shutdown hard timeout (10s) reached — forcing exit');
      process.exit(1);
    }, 10_000);
    hardTimeout.unref();

    // Stop accepting new connections and wait for in-flight requests to finish.
    await new Promise<void>((resolve) => {
      // Close idle keep-alive sockets so server.close() can resolve promptly.
      const maybeCloseIdle = (server as { closeIdleConnections?: () => void }).closeIdleConnections;
      if (typeof maybeCloseIdle === 'function') {
        maybeCloseIdle.call(server);
      }
      server.close((err) => {
        if (err) log.warn({ err }, 'server.close error');
        resolve();
      });
    });

    // Disconnect external resources after the HTTP server has drained.
    await Promise.allSettled([prisma.$disconnect(), disconnectRedis()]);

    clearTimeout(hardTimeout);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
