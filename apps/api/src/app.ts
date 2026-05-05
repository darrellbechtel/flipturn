import { Hono } from 'hono';
import type { PrismaClient } from '@flipturn/db';
import type { EmailSender } from './email.js';
import { errorHandler } from './middleware/error.js';
import { authRoutes } from './routes/auth.js';
import { athletesRoutes, userAthletesRoutes } from './routes/athletes.js';
import { dataRoutes } from './routes/data.js';

export interface AppDeps {
  readonly prisma: PrismaClient;
  readonly email: EmailSender;
  readonly enqueueScrape: (job: { athleteId: string; sncId: string }) => Promise<string>;
  readonly baseUrl: string;
  readonly mobileDeepLinkBase: string;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.onError(errorHandler);

  app.route('/v1/auth', authRoutes(deps));
  app.route('/v1/athletes', athletesRoutes(deps));
  app.route('/v1/athletes', dataRoutes(deps));
  app.route('/v1/user-athletes', userAthletesRoutes(deps));

  app.get('/v1/health', (c) => c.json({ ok: true }));

  return app;
}
