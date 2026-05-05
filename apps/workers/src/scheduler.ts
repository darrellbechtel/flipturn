import { Queue } from 'bullmq';
import { getPrisma } from '@flipturn/db';
import { enqueueScrapeAthlete } from './queue.js';
import { getRedis } from './redis.js';
import { getLogger } from './logger.js';

const SCHEDULER_QUEUE = 'flipturn-scheduler';
const SCHEDULER_REPEAT_KEY = 'flipturn-scheduler-tick';

let _schedulerQueue: Queue | undefined;

function getSchedulerQueue(): Queue {
  if (!_schedulerQueue) {
    _schedulerQueue = new Queue(SCHEDULER_QUEUE, { connection: getRedis() });
  }
  return _schedulerQueue;
}

/**
 * Enqueue a scrape job for every Athlete with sncId set.
 * Called by the BullMQ repeatable job (every 24h).
 */
export async function tickScheduler(): Promise<{ enqueued: number }> {
  const prisma = getPrisma();
  const log = getLogger();
  const athletes = await prisma.athlete.findMany({
    select: { id: true, sncId: true },
  });
  for (const a of athletes) {
    await enqueueScrapeAthlete(
      { athleteId: a.id, sncId: a.sncId },
      // Spread over 5min to smear the burst.
      { delay: Math.floor(Math.random() * 5 * 60 * 1000) },
    );
  }
  log.info({ enqueued: athletes.length }, 'scheduler tick complete');
  return { enqueued: athletes.length };
}

/**
 * Register a BullMQ repeatable job that calls tickScheduler() every 24h.
 * The actual processing happens in worker.ts via startSchedulerWorker.
 */
export async function startScheduler(): Promise<void> {
  const queue = getSchedulerQueue();
  await queue.add(
    SCHEDULER_REPEAT_KEY,
    {},
    {
      repeat: { every: 24 * 60 * 60 * 1000 }, // 24h
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 100 },
    },
  );
  getLogger().info('scheduler registered (every 24h)');
}

export { SCHEDULER_QUEUE };
