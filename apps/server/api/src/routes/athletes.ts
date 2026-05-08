import { Hono, type MiddlewareHandler } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { AthleteSearchQuerySchema, OnboardAthleteSchema } from '@flipturn/shared';
import type { AppDeps } from '../app.js';
import { ApiError, errorHandler } from '../middleware/error.js';
import { sessionMiddleware } from '../middleware/session.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { searchAthletes } from '../services/athleteSearch.js';

// No-op middleware used when deps.redis is undefined (test harnesses that
// don't exercise rate limiting). Mirrors the pattern in routes/auth.ts so the
// route shape is identical regardless of whether limiting is active.
const passThrough: MiddlewareHandler = async (_c, next) => {
  await next();
};

export function athletesRoutes(deps: AppDeps): Hono {
  const r = new Hono();
  r.onError(errorHandler);
  r.use('*', sessionMiddleware(deps.prisma));

  // Rate limit: 50 search requests per identity per minute. Generous enough
  // for legitimate typeahead-style usage (~1 req/keystroke at 80 wpm) and
  // tight enough to slow down scraping the index. Runs after the session
  // middleware so authenticated users can't be denied by IP-spoofed traffic
  // exhausting their bucket — every entry into this route is already a
  // valid session.
  const searchLimiter: MiddlewareHandler = deps.redis
    ? rateLimit(deps.redis, {
        bucket: 'athlete-search',
        windowSec: 60,
        limit: 50,
        ...(deps.rateLimitIdentify ? { identify: deps.rateLimitIdentify } : {}),
      })
    : passThrough;

  r.post('/onboard', zValidator('json', OnboardAthleteSchema), async (c) => {
    const { sncId, relationship } = c.req.valid('json');
    const { user } = c.get('auth');

    const athlete = await deps.prisma.athlete.upsert({
      where: { sncId },
      update: {},
      create: { sncId, primaryName: 'Pending scrape' },
    });

    await deps.prisma.userAthlete.upsert({
      where: { userId_athleteId: { userId: user.id, athleteId: athlete.id } },
      update: { relationship },
      create: { userId: user.id, athleteId: athlete.id, relationship },
    });

    await deps.enqueueScrape({ athleteId: athlete.id, sncId: athlete.sncId });

    return c.json({
      athlete: {
        id: athlete.id,
        sncId: athlete.sncId,
        primaryName: athlete.primaryName,
        gender: athlete.gender,
        homeClub: athlete.homeClub,
        lastScrapedAt: athlete.lastScrapedAt?.toISOString() ?? null,
      },
    });
  });

  // GET /search — fuzzy + tsvector ranked athlete search with live remote
  // fallback. The rate limiter is mounted *only* on this path because the
  // existing /onboard and list routes have their own (low-volume) usage
  // patterns and don't share the same threat model.
  r.get('/search', searchLimiter, async (c) => {
    const parsed = AthleteSearchQuerySchema.safeParse({
      q: c.req.query('q'),
      clubId: c.req.query('clubId'),
      province: c.req.query('province'),
      limit: c.req.query('limit'),
    });
    if (!parsed.success) {
      return c.json({ error: 'invalid_query', issues: parsed.error.issues }, 400);
    }
    const { user } = c.get('auth');
    const result = await searchAthletes({
      prisma: deps.prisma,
      ...(deps.searchFetch ? { fetch: deps.searchFetch } : {}),
      args: {
        q: parsed.data.q,
        ...(parsed.data.clubId !== undefined ? { clubId: parsed.data.clubId } : {}),
        ...(parsed.data.province !== undefined ? { province: parsed.data.province } : {}),
        limit: parsed.data.limit,
        userId: user.id,
      },
    });
    return c.json(result);
  });

  r.get('/', async (c) => {
    const { user } = c.get('auth');
    const links = await deps.prisma.userAthlete.findMany({
      where: { userId: user.id },
      include: { athlete: true },
      orderBy: { addedAt: 'asc' },
    });
    return c.json({
      athletes: links.map((l) => ({
        id: l.athlete.id,
        sncId: l.athlete.sncId,
        primaryName: l.athlete.primaryName,
        gender: l.athlete.gender,
        homeClub: l.athlete.homeClub,
        relationship: l.relationship,
        lastScrapedAt: l.athlete.lastScrapedAt?.toISOString() ?? null,
      })),
    });
  });

  return r;
}

export function userAthletesRoutes(deps: AppDeps): Hono {
  const r = new Hono();
  r.onError(errorHandler);
  r.use('*', sessionMiddleware(deps.prisma));

  r.delete('/:id', async (c) => {
    const { user } = c.get('auth');
    const athleteId = c.req.param('id');
    const result = await deps.prisma.userAthlete.deleteMany({
      where: { userId: user.id, athleteId },
    });
    if (result.count === 0) {
      throw new ApiError(404, 'Not found', 'not_found');
    }
    return c.body(null, 204);
  });

  return r;
}
