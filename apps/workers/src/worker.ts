import { Worker, type Job } from 'bullmq';
import { getPrisma } from '@flipturn/db';
import { SCRAPE_ATHLETE_QUEUE, type ScrapeAthleteJob } from './queue.js';
import { getRedis } from './redis.js';
import { getLogger } from './logger.js';
import { politeFetch, FetchBlockedError } from './fetch.js';
import { parseStub } from './parser/stub.js';
import { reconcile } from './reconcile.js';
import { recomputePersonalBests } from './personalBest.js';
import { buildAthleteUrl } from './url.js';

export function startScrapeWorker(): Worker<ScrapeAthleteJob> {
  const log = getLogger();

  const worker = new Worker<ScrapeAthleteJob>(
    SCRAPE_ATHLETE_QUEUE,
    async (job: Job<ScrapeAthleteJob>) => {
      const { athleteId, sncId } = job.data;
      log.info({ jobId: job.id, athleteId, sncId }, 'job started');

      const url = buildAthleteUrl(sncId);
      let body: string;
      try {
        const result = await politeFetch({ url, sncId });
        body = result.body;
      } catch (err) {
        if (err instanceof FetchBlockedError) {
          log.warn({ jobId: job.id, err: err.message }, 'fetch blocked; skipping');
          return { skipped: true as const };
        }
        throw err;
      }

      const snapshot = parseStub({ sncId, body });

      const prisma = getPrisma();
      const { athleteId: dbAthleteId } = await reconcile(prisma, snapshot);
      await recomputePersonalBests(prisma, dbAthleteId);

      log.info({ jobId: job.id, dbAthleteId }, 'job complete');
      return { dbAthleteId, swims: snapshot.swims.length };
    },
    {
      connection: getRedis(),
      concurrency: 1, // Plan 2 keeps it serial; Plan 3 may bump
    },
  );

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'job failed');
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
      // Lazy import to avoid circular import if scheduler.ts grows
      const { tickScheduler } = await import('./scheduler.js');
      await tickScheduler();
    },
    { connection: getRedis(), concurrency: 1 },
  );
  w.on('failed', (job, err) => log.error({ jobId: job?.id, err }, 'scheduler tick failed'));
  return w;
}
