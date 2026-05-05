import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { AppDeps } from '../app.js';
import { ApiError, errorHandler } from '../middleware/error.js';
import { sessionMiddleware } from '../middleware/session.js';

const SwimsQuerySchema = z.object({
  eventKey: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  cursor: z.string().optional(),
});

const ProgressionQuerySchema = z.object({
  eventKey: z.string().min(1),
});

export function dataRoutes(deps: AppDeps): Hono {
  const r = new Hono();
  r.onError(errorHandler);
  r.use('*', sessionMiddleware(deps.prisma));

  async function assertOwned(c: Context): Promise<string> {
    const { user } = c.get('auth');
    const athleteId = c.req.param('id');
    if (!athleteId) throw new ApiError(400, 'Missing athlete id', 'bad_request');
    const link = await deps.prisma.userAthlete.findUnique({
      where: { userId_athleteId: { userId: user.id, athleteId } },
    });
    if (!link) {
      throw new ApiError(404, 'Athlete not found', 'not_found');
    }
    return athleteId;
  }

  r.get('/:id/swims', zValidator('query', SwimsQuerySchema), async (c) => {
    const athleteId = await assertOwned(c);
    const q = c.req.valid('query');
    const where: { athleteId: string; eventKey?: string } = { athleteId };
    if (q.eventKey) where.eventKey = q.eventKey;

    const swims = await deps.prisma.swim.findMany({
      where,
      take: q.limit + 1,
      // Sort by race date (not scrape time) so the order matches the user's
      // mental model and is stable across re-scrapes.
      orderBy: [{ meet: { startDate: 'desc' } }, { id: 'desc' }],
      include: { meet: { select: { name: true, startDate: true } } },
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const hasMore = swims.length > q.limit;
    const page = swims.slice(0, q.limit);
    const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;
    return c.json({
      swims: page.map((s) => ({
        id: s.id,
        eventKey: s.eventKey,
        timeCentiseconds: s.timeCentiseconds,
        splits: s.splits,
        place: s.place,
        status: s.status,
        meetName: s.meet.name,
        // The actual race date — not scrapedAt, which is when the scraper
        // wrote the row.
        swamAt: s.meet.startDate.toISOString(),
      })),
      nextCursor,
    });
  });

  r.get('/:id/personal-bests', async (c) => {
    const athleteId = await assertOwned(c);
    const pbs = await deps.prisma.personalBest.findMany({
      where: { athleteId },
      orderBy: [{ eventKey: 'asc' }],
    });
    return c.json({
      personalBests: pbs.map((p) => ({
        eventKey: p.eventKey,
        timeCentiseconds: p.timeCentiseconds,
        achievedAt: p.achievedAt.toISOString(),
        swimId: p.swimId,
      })),
    });
  });

  r.get('/:id/progression', zValidator('query', ProgressionQuerySchema), async (c) => {
    const athleteId = await assertOwned(c);
    const { eventKey } = c.req.valid('query');
    const swims = await deps.prisma.swim.findMany({
      where: { athleteId, eventKey, status: 'OFFICIAL' },
      include: { meet: { select: { startDate: true, name: true } } },
      orderBy: { meet: { startDate: 'asc' } },
    });
    return c.json({
      points: swims.map((s) => ({
        date: s.meet.startDate.toISOString(),
        timeCentiseconds: s.timeCentiseconds,
        meetName: s.meet.name,
      })),
    });
  });

  return r;
}
