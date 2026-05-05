import { Hono } from 'hono';
import type { AppDeps } from '../app.js';
import { errorHandler } from '../middleware/error.js';
import { sessionMiddleware } from '../middleware/session.js';
import { getRedis } from '../redis.js';

export function healthRoute(deps: AppDeps): Hono {
  const r = new Hono();
  r.onError(errorHandler);
  r.get('/', async (c) => {
    let dbStatus: 'ok' | 'fail' = 'ok';
    try {
      await deps.prisma.$queryRaw`SELECT 1`;
    } catch {
      dbStatus = 'fail';
    }

    let redisStatus: 'ok' | 'fail' = 'ok';
    try {
      const redis = deps.redis ?? getRedis();
      const reply = await Promise.race([
        redis.ping(),
        new Promise<string>((_, reject) => {
          setTimeout(() => reject(new Error('timeout')), 1000).unref();
        }),
      ]);
      if (reply !== 'PONG') redisStatus = 'fail';
    } catch {
      redisStatus = 'fail';
    }

    return c.json({ db: dbStatus, redis: redisStatus });
  });
  return r;
}

export function meRoutes(deps: AppDeps): Hono {
  const r = new Hono();
  r.onError(errorHandler);
  r.use('*', sessionMiddleware(deps.prisma));

  r.delete('/', async (c) => {
    const { user } = c.get('auth');
    // Schema's onDelete: Cascade handles Sessions, MagicLinkTokens, UserAthlete.
    await deps.prisma.user.delete({ where: { id: user.id } });
    return c.body(null, 204);
  });

  return r;
}
