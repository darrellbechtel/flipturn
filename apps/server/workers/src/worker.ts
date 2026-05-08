import { Queue, Worker, type Job } from 'bullmq';
import { DateTime } from 'luxon';
import { getPrisma } from '@flipturn/db';
import {
  SCRAPE_ATHLETE_QUEUE,
  PRIORITY_WARMER_QUEUE,
  enqueueWarmerRun,
  type ScrapeAthleteJob,
  type PriorityWarmerJob,
} from './queue.js';
import { getRedis } from './redis.js';
import { getLogger } from './logger.js';
import { politeFetch, FetchBlockedError, FetchRetryError } from './fetch.js';
import { parseAthletePage } from './parser/athletePage.js';
import { reconcile } from './reconcile.js';
import { recomputePersonalBests } from './personalBest.js';
import { buildAthleteUrl } from './url.js';
import { runPriorityWarmer, type FetchFn } from './jobs/priorityWarmer.js';
import { planDailyWarm } from './scheduler/warmerScheduler.js';
import { CRAWL_TZ } from './scheduler/window.js';
import { Sentry } from './sentry.js';

export function startScrapeWorker(): Worker<ScrapeAthleteJob> {
  const log = getLogger();

  const worker = new Worker<ScrapeAthleteJob>(
    SCRAPE_ATHLETE_QUEUE,
    async (job: Job<ScrapeAthleteJob>) => {
      const { athleteId, sncId } = job.data;
      const url = buildAthleteUrl(sncId);
      log.info({ jobId: job.id, athleteId, sncId, url }, 'job started');

      let body: string;
      try {
        const result = await politeFetch({ url, sncId });
        body = result.body;
      } catch (err) {
        if (err instanceof FetchBlockedError) {
          log.warn({ jobId: job.id, err: err.message }, 'fetch blocked; skipping');
          return { skipped: true as const, reason: err.message };
        }
        // FetchRetryError + any other error → re-throw so BullMQ retries.
        throw err;
      }

      const snapshot = parseAthletePage(body, { sncId });

      const prisma = getPrisma();
      const { athleteId: dbAthleteId } = await reconcile(prisma, snapshot);
      await recomputePersonalBests(prisma, dbAthleteId);

      log.info({ jobId: job.id, dbAthleteId, swims: snapshot.swims.length }, 'job complete');
      return { dbAthleteId, swims: snapshot.swims.length };
    },
    {
      connection: getRedis(),
      concurrency: 1,
    },
  );

  worker.on('failed', (job, err) => {
    if (err instanceof FetchRetryError) {
      log.warn({ jobId: job?.id, retryAfterMs: err.retryAfterMs }, 'job will retry on backoff');
    } else {
      log.error({ jobId: job?.id, err }, 'job failed');
      // Routine retry errors (FetchRetryError) are not bugs; everything else is.
      Sentry.captureException(err);
    }
  });

  worker.on('completed', (job) => {
    log.debug({ jobId: job.id }, 'job completed');
  });

  return worker;
}

export function startSchedulerWorker(): Worker {
  const log = getLogger();
  const w = new Worker(
    'flipturn-scheduler',
    async () => {
      const { tickScheduler } = await import('./scheduler.js');
      await tickScheduler(getPrisma());
    },
    { connection: getRedis(), concurrency: 1 },
  );
  w.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'scheduler tick failed');
    // Scheduler shouldn't fail under normal operation — capture every failure.
    Sentry.captureException(err);
  });
  return w;
}

// ---------------------------------------------------------------------------
// Priority warmer wiring (athlete-search index hydration).
//
// Everything below is gated on `INDEX_CRAWL_ENABLED === 'true'`. The flag must
// be checked at *start* time (not module-load), because constructing a BullMQ
// Worker eagerly opens a Redis connection — undesirable in tests/CI when the
// flag isn't set.
//
// Two workers register together as a pair:
//   1. `priority-warmer`     — actually runs `runPriorityWarmer` for one club.
//   2. `priority-warmer-plan` — daily cron (15:55 ET) that calls planDailyWarm
//      and, if a plan is returned, enqueues a `priority-warmer` job at the
//      sampled `fireAt` time inside the active window.
// ---------------------------------------------------------------------------

const PRIORITY_WARMER_PLAN_QUEUE = 'priority-warmer-plan';
const PRIORITY_WARMER_PLAN_JOB_ID = 'priority-warmer-plan-cron';
const PRIORITY_WARMER_PLAN_CRON = '55 15 * * *'; // 15:55 in CRAWL_TZ

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

/**
 * Adapt `politeFetch` (which expects `{ url, sncId }` and returns
 * `{ statusCode, body, ... }`) to the minimal `FetchFn` shape the warmer
 * needs (`{ url } -> { status, body }`). The archive layer requires a
 * filesystem-safe `sncId` segment, so we derive one from the URL: the
 * numeric swimmer id when present, otherwise a slug of the path/query.
 */
function deriveSncIdFromUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const swimmerMatch = u.pathname.match(/\/swimmer\/(\d+)/);
    if (swimmerMatch?.[1]) return swimmerMatch[1];
    const slug = `${u.pathname}${u.search}`
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
    const safe = slug.length > 0 ? slug : 'root';
    const candidate = `search-${safe}`;
    return SAFE_SEGMENT.test(candidate) ? candidate : 'search-unknown';
  } catch {
    return 'search-unknown';
  }
}

const politeFetchAdapter: FetchFn = async (req) => {
  const sncId = deriveSncIdFromUrl(req.url);
  try {
    const result = await politeFetch({ url: req.url, sncId });
    return { status: result.statusCode, body: result.body };
  } catch (err) {
    // FetchRetryError + FetchBlockedError both indicate "do not proceed with
    // this URL right now". For the warmer we surface them as non-200 so the
    // job logic skips/aborts gracefully instead of crashing the run, except
    // FetchRetryError on the search URL itself, which we want to bubble up so
    // BullMQ's retry kicks in. The warmer can't tell which URL was the
    // search vs. a profile, so we re-throw FetchRetryError unconditionally
    // and let BullMQ retry the whole run.
    if (err instanceof FetchRetryError) throw err;
    if (err instanceof FetchBlockedError) {
      return { status: 599, body: '' };
    }
    throw err;
  }
};

export function startPriorityWarmerWorker(): Worker<PriorityWarmerJob> | undefined {
  if (process.env.INDEX_CRAWL_ENABLED !== 'true') return undefined;

  const log = getLogger();
  const worker = new Worker<PriorityWarmerJob>(
    PRIORITY_WARMER_QUEUE,
    async (job: Job<PriorityWarmerJob>) => {
      const { clubName, reason } = job.data;
      log.info({ jobId: job.id, clubName, reason }, 'priority-warmer started');
      const result = await runPriorityWarmer({
        prisma: getPrisma(),
        fetch: politeFetchAdapter,
        clubName,
      });
      log.info({ jobId: job.id, clubName, ...result }, 'priority-warmer complete');
      return result;
    },
    { connection: getRedis(), concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    if (err instanceof FetchRetryError) {
      log.warn(
        { jobId: job?.id, retryAfterMs: err.retryAfterMs },
        'priority-warmer will retry on backoff',
      );
    } else {
      log.error({ jobId: job?.id, err }, 'priority-warmer failed');
      Sentry.captureException(err);
    }
  });

  return worker;
}

let _priorityWarmerPlanQueue: Queue | undefined;

function getPriorityWarmerPlanQueue(): Queue {
  if (!_priorityWarmerPlanQueue) {
    _priorityWarmerPlanQueue = new Queue(PRIORITY_WARMER_PLAN_QUEUE, {
      connection: getRedis(),
    });
  }
  return _priorityWarmerPlanQueue;
}

/**
 * Register the daily plan cron + its processor. The cron tick fires at 15:55
 * in `CRAWL_TZ` (just before the active window opens at 16:00); the processor
 * picks today's club via `planDailyWarm` and enqueues a `priority-warmer` job
 * with a `delay` so it lands at the sampled `fireAt`.
 *
 * Returns `{ queue, worker }` so the caller can close both on shutdown, or
 * `undefined` when the flag is off.
 */
export async function startPriorityWarmerPlanWorker(): Promise<
  { queue: Queue; worker: Worker } | undefined
> {
  if (process.env.INDEX_CRAWL_ENABLED !== 'true') return undefined;

  const log = getLogger();
  const queue = getPriorityWarmerPlanQueue();

  // Register the repeatable cron. Static jobId dedups across restarts.
  await queue.add(
    'plan',
    {},
    {
      repeat: { pattern: PRIORITY_WARMER_PLAN_CRON, tz: CRAWL_TZ },
      jobId: PRIORITY_WARMER_PLAN_JOB_ID,
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 100 },
    },
  );

  const worker = new Worker(
    PRIORITY_WARMER_PLAN_QUEUE,
    async (job: Job) => {
      const today = DateTime.now().setZone(CRAWL_TZ);
      const plan = await planDailyWarm({ prisma: getPrisma(), today });
      if (!plan) {
        log.info({ jobId: job.id }, 'priority-warmer plan: no run scheduled today');
        return { scheduled: false as const };
      }
      const delayMs = Math.max(0, plan.fireAt.toMillis() - Date.now());
      const enqueuedId = await enqueueWarmerRun(plan.clubName, 'cron', delayMs);
      log.info(
        {
          jobId: job.id,
          clubName: plan.clubName,
          fireAt: plan.fireAt.toISO(),
          delayMs,
          enqueuedId,
        },
        'priority-warmer plan: enqueued daily run',
      );
      return { scheduled: true as const, clubName: plan.clubName, delayMs };
    },
    { connection: getRedis(), concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'priority-warmer plan tick failed');
    Sentry.captureException(err);
  });

  return { queue, worker };
}
