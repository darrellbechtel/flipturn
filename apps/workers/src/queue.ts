import { Queue, type JobsOptions } from 'bullmq';
import { getRedis } from './redis.js';

export const SCRAPE_ATHLETE_QUEUE = 'scrape-athlete';

export interface ScrapeAthleteJob {
  /** Internal Athlete.id (cuid). */
  readonly athleteId: string;
  /** SNC athlete ID (e.g. used to construct the source URL). */
  readonly sncId: string;
  /**
   * If set, parser uses the named fixture instead of fetching live.
   * Used in Plan 2's stub parser; ignored in Plan 3+.
   */
  readonly fixtureName?: string | undefined;
}

let _queue: Queue<ScrapeAthleteJob> | undefined;

export function getScrapeAthleteQueue(): Queue<ScrapeAthleteJob> {
  if (!_queue) {
    _queue = new Queue<ScrapeAthleteJob>(SCRAPE_ATHLETE_QUEUE, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 1000 },
      },
    });
  }
  return _queue;
}

export async function enqueueScrapeAthlete(
  job: ScrapeAthleteJob,
  options?: JobsOptions | undefined,
): Promise<string> {
  const queue = getScrapeAthleteQueue();
  const added = await queue.add('scrape', job, options);
  return added.id ?? '<no-id>';
}
