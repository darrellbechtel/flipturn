import { Queue, type JobsOptions } from 'bullmq';
import { getRedis } from './redis.js';

export const SCRAPE_ATHLETE_QUEUE = 'scrape-athlete';

export interface ScrapeAthleteJob {
  /** Internal Athlete.id (cuid). */
  readonly athleteId: string;
  /** SNC athlete ID (used to construct the source URL). */
  readonly sncId: string;
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

// ---------------------------------------------------------------------------
// Priority warmer queue: hydrates the athlete search index by walking
// SwimRankings result pages for each known club.
// ---------------------------------------------------------------------------

export const PRIORITY_WARMER_QUEUE = 'priority-warmer';

export interface PriorityWarmerJob {
  /** Free-text club name used as the search query against SwimRankings. */
  readonly clubName: string;
  /** What triggered this run: scheduled cron or an admin request. */
  readonly reason: 'cron' | 'admin';
}

let _warmerQueue: Queue<PriorityWarmerJob> | undefined;

export function getPriorityWarmerQueue(): Queue<PriorityWarmerJob> {
  if (!_warmerQueue) {
    _warmerQueue = new Queue<PriorityWarmerJob>(PRIORITY_WARMER_QUEUE, {
      connection: getRedis(),
      defaultJobOptions: {
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 1000 },
      },
    });
  }
  return _warmerQueue;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Enqueue a priority-warmer run for one club. Each (clubName, UTC day) pair
 * is deduplicated via `jobId: warm:<clubName>:<dayBucket>` so that admin
 * triggers and the daily cron can't double-up on the same club within a day.
 */
export async function enqueueWarmerRun(
  clubName: string,
  reason: PriorityWarmerJob['reason'] = 'cron',
  delayMs = 0,
): Promise<string> {
  const dayBucket = Math.floor(Date.now() / ONE_DAY_MS);
  const queue = getPriorityWarmerQueue();
  const added = await queue.add(
    `warm:${clubName}`,
    { clubName, reason },
    {
      delay: delayMs,
      attempts: 5,
      backoff: { type: 'exponential', delay: 60_000 },
      jobId: `warm:${clubName}:${dayBucket}`,
    },
  );
  return added.id ?? '<no-id>';
}

// ---------------------------------------------------------------------------
// Club directory crawl queue: hydrates the Club table from the SNC "Find a
// Club" JSONP feed. One-shot (no per-day fan-out); a single run pulls the
// entire directory and upserts every Club row.
// ---------------------------------------------------------------------------

export const CLUB_DIRECTORY_QUEUE = 'club-directory-crawl';

export interface ClubDirectoryCrawlJob {
  /** What triggered this run: scheduled cron or an admin request. */
  readonly reason: 'cron' | 'admin';
}

let _clubDirectoryQueue: Queue<ClubDirectoryCrawlJob> | undefined;

export function getClubDirectoryQueue(): Queue<ClubDirectoryCrawlJob> {
  if (!_clubDirectoryQueue) {
    _clubDirectoryQueue = new Queue<ClubDirectoryCrawlJob>(CLUB_DIRECTORY_QUEUE, {
      connection: getRedis(),
      defaultJobOptions: {
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 500 },
      },
    });
  }
  return _clubDirectoryQueue;
}

/**
 * Enqueue a one-shot club-directory crawl. We don't use a stable jobId here
 * because admin triggers should always run (the daily cron path, when added,
 * can supply its own dedup jobId).
 */
export async function enqueueClubDirectoryCrawl(
  reason: ClubDirectoryCrawlJob['reason'] = 'cron',
  delayMs = 0,
): Promise<string> {
  const queue = getClubDirectoryQueue();
  const added = await queue.add(
    `crawl:${reason}`,
    { reason },
    {
      delay: delayMs,
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
    },
  );
  return added.id ?? '<no-id>';
}
