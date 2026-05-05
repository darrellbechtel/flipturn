import { serve } from '@hono/node-server';
import { Resend } from 'resend';
import { getEnv } from './env.js';
import { getLogger } from './logger.js';
import { initSentry } from './sentry.js';
import { createApp } from './app.js';
import { ResendEmailSender, InMemoryEmailSender, type EmailSender } from './email.js';
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
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
