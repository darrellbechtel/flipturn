import { Hono, type Context } from 'hono';
import type { PrismaClient } from '@flipturn/db';
import type { Redis } from 'ioredis';
import type { EmailSender } from './email.js';
import { errorHandler } from './middleware/error.js';
import { authRoutes } from './routes/auth.js';
import { athletesRoutes, userAthletesRoutes } from './routes/athletes.js';
import { dataRoutes } from './routes/data.js';
import { healthRoute, meRoutes } from './routes/ops.js';
import { wellKnownRoutes } from './routes/well-known.js';

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
  /**
   * Apple Developer Team ID, threaded into apple-app-site-association.
   * When unset, /.well-known/apple-app-site-association returns 404.
   */
  readonly iosAppTeamId?: string | undefined;
  /**
   * Android signing-cert SHA-256 fingerprint (from EAS build output),
   * threaded into assetlinks.json. When unset, /.well-known/assetlinks.json
   * returns 404.
   */
  readonly androidAppSha256?: string | undefined;
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
  app.route(
    '/.well-known',
    wellKnownRoutes({
      iosAppTeamId: deps.iosAppTeamId,
      androidAppSha256: deps.androidAppSha256,
    }),
  );

  return app;
}
