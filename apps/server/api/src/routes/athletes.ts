import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { OnboardAthleteSchema } from '@flipturn/shared';
import type { AppDeps } from '../app.js';
import { ApiError, errorHandler } from '../middleware/error.js';
import { sessionMiddleware } from '../middleware/session.js';

export function athletesRoutes(deps: AppDeps): Hono {
  const r = new Hono();
  r.onError(errorHandler);
  r.use('*', sessionMiddleware(deps.prisma));

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
