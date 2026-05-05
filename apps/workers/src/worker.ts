import { Worker, type Job } from 'bullmq';
import { getPrisma } from '@flipturn/db';
import { SCRAPE_ATHLETE_QUEUE, type ScrapeAthleteJob } from './queue.js';
import { getRedis } from './redis.js';
import { getLogger } from './logger.js';
import { politeFetch, FetchBlockedError } from './fetch.js';
import { parseStub } from './parser/stub.js';
import { reconcile } from './reconcile.js';
import { recomputePersonalBests } from './personalBest.js';

export function startScrapeWorker(): Worker<ScrapeAthleteJob> {
  const log = getLogger();

  const worker = new Worker<ScrapeAthleteJob>(
    SCRAPE_ATHLETE_QUEUE,
    async (job: Job<ScrapeAthleteJob>) => {
      const { athleteId, sncId, fixtureName } = job.data;
      log.info({ jobId: job.id, athleteId, sncId, fixtureName }, 'job started');

      // In Plan 2, fixtureName branches us into the stub parser without fetching.
      // Plan 3 flips this to: real URL → real fetch → real parser.
      let body = '';
      if (!fixtureName) {
        const url = buildSourceUrl(sncId);
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
      }

      const snapshot = parseStub({ fixtureName, sncId, body });

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

/**
 * Build the source URL for an SNC athlete. This is a Plan 2 placeholder.
 * Per ADR 0002, the real URL is `https://www.swimming.ca/swimmer/<id>/`,
 * but Plan 2's pipeline only ever runs the fixture path (fixtureName set),
 * so this isn't exercised. Plan 3 replaces this with the real URL builder.
 */
function buildSourceUrl(sncId: string): string {
  return `https://www.swimming.ca/swimmer/${encodeURIComponent(sncId)}/`;
}
