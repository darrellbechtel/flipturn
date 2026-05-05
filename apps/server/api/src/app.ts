import { Hono, type Context } from 'hono';
import type { PrismaClient } from '@flipturn/db';
import type { Redis } from 'ioredis';
import type { EmailSender } from './email.js';
import { errorHandler } from './middleware/error.js';
import { authRoutes } from './routes/auth.js';
import { athletesRoutes, userAthletesRoutes } from './routes/athletes.js';
import { dataRoutes } from './routes/data.js';
import { healthRoute, meRoutes } from './routes/ops.js';

export interface AppDeps {
  readonly prisma: PrismaClient;
  readonly email: EmailSender;
  readonly enqueueScrape: (job: { athleteId: string; sncId: string }) => Promise<string>;
  readonly baseUrl: string;
  readonly mobileDeepLinkBase: string;
  /**
   * Optional so test harnesses can omit it. When undefined, rate-limit
   * middleware is skipped (see routes/auth.ts). Production wiring must always
   * provide a Redis client.
   */
  readonly redis?: Redis | undefined;
  /**
   * Optional override for the rate-limit identity extractor. The testApp
   * helper supplies a per-instance identity so parallel test files can't
   * collide in the shared 'unknown' bucket.
   */
  readonly rateLimitIdentify?: ((c: Context) => string) | undefined;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.onError(errorHandler);

  app.route('/v1/auth', authRoutes(deps));
  app.route('/v1/athletes', athletesRoutes(deps));
  app.route('/v1/athletes', dataRoutes(deps));
  app.route('/v1/user-athletes', userAthletesRoutes(deps));
  app.route('/v1/health', healthRoute(deps));
  app.route('/v1/me', meRoutes(deps));

  return app;
}
