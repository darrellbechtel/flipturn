/**
 * Admin endpoints — token-gated operational levers for the athlete-search
 * index. Authenticated by an `x-admin-token` header that must equal
 * `process.env.ADMIN_TOKEN`. When `ADMIN_TOKEN` is unset the gate denies
 * everything (so a misconfigured environment fails closed instead of
 * accidentally exposing /admin/*).
 *
 * NOT mounted under `sessionMiddleware` — these routes are deliberately
 * separate from the user-facing auth surface and are intended to be called
 * by humans/operators with a static token.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { PrismaClient } from '@flipturn/db';
import { enqueueWarmerRun, enqueueClubDirectoryCrawl } from '@flipturn/workers/queue';
import { ApiError, errorHandler } from '../middleware/error.js';

const WarmerRunBodySchema = z.object({
  clubName: z.string().trim().min(1, 'clubName is required'),
});

export function adminRoutes(prisma: PrismaClient): Hono {
  const r = new Hono();
  r.onError(errorHandler);

  // Token gate. Both branches return 401 with the same error code so a caller
  // can't distinguish "no header sent" from "ADMIN_TOKEN unset on server" —
  // smaller information surface for an unauthenticated probe.
  r.use('*', async (c, next) => {
    const expected = process.env.ADMIN_TOKEN;
    const provided = c.req.header('x-admin-token');
    if (!expected || !provided || provided !== expected) {
      throw new ApiError(401, 'admin token required', 'unauthenticated');
    }
    await next();
  });

  // POST /v1/admin/crawl/club-directory — enqueues a one-shot directory crawl.
  // Always returns 202; the actual crawl runs in the worker process under
  // INDEX_CRAWL_ENABLED. If the worker isn't running the job will sit in the
  // queue (intentional — admins use this knob to seed).
  r.post('/crawl/club-directory', async (c) => {
    await enqueueClubDirectoryCrawl('admin');
    return c.json({ enqueued: 1 }, 202);
  });

  // POST /v1/admin/warmer-run — manually triggers a priority-warmer run for
  // one club. Bypasses the daily active-window check — that gate lives in
  // the scheduler, not the queue itself, so an admin enqueue runs as soon
  // as the worker picks it up.
  r.post('/warmer-run', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = WarmerRunBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
    }
    const { clubName } = parsed.data;
    await enqueueWarmerRun(clubName, 'admin');
    return c.json({ enqueued: 1, clubName }, 202);
  });

  // GET /v1/admin/index-stats — three lightweight queries: club count,
  // athlete count, and the 50 most-recently-crawled clubs. Intentionally
  // does NOT join (no athlete-per-club rollup) — keeps page-time cheap for
  // an endpoint that gets dashboard-polled.
  r.get('/index-stats', async (c) => {
    const [totalClubs, totalAthletes, recentCrawls] = await Promise.all([
      prisma.club.count(),
      prisma.athlete.count(),
      prisma.club.findMany({
        // `lastCrawledAt` is nullable; sort newest-first with NULLS LAST so
        // never-crawled clubs don't crowd out the meaningful entries when the
        // list is small.
        orderBy: [{ lastCrawledAt: { sort: 'desc', nulls: 'last' } }],
        take: 50,
        select: {
          id: true,
          name: true,
          lastCrawledAt: true,
        },
      }),
    ]);

    return c.json({
      totalClubs,
      totalAthletes,
      recentCrawls: recentCrawls.map((club) => ({
        id: club.id,
        name: club.name,
        lastCrawledAt: club.lastCrawledAt?.toISOString() ?? null,
      })),
    });
  });

  return r;
}
