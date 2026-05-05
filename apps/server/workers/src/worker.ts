import { Worker, type Job } from 'bullmq';
import { getPrisma } from '@flipturn/db';
import { SCRAPE_ATHLETE_QUEUE, type ScrapeAthleteJob } from './queue.js';
import { getRedis } from './redis.js';
import { getLogger } from './logger.js';
import { politeFetch, FetchBlockedError, FetchRetryError } from './fetch.js';
import { parseAthletePage } from './parser/athletePage.js';
import { reconcile } from './reconcile.js';
import { recomputePersonalBests } from './personalBest.js';
import { buildAthleteUrl } from './url.js';
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
