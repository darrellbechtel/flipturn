import { Hono } from 'hono';
import type { PrismaClient } from '@flipturn/db';
import type { EmailSender } from './email.js';
import { errorMiddleware } from './middleware/error.js';

export interface AppDeps {
  readonly prisma: PrismaClient;
  readonly email: EmailSender;
  readonly enqueueScrape: (job: { athleteId: string; sncId: string }) => Promise<string>;
  readonly baseUrl: string;
  readonly mobileDeepLinkBase: string;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.use('*', errorMiddleware);

  // Routes wired in Tasks 5-8. For now, a stub /v1/health.
  app.get('/v1/health', (c) => c.json({ ok: true }));

  return app;
}
