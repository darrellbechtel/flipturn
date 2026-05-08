// MUST be the first import — populates process.env from the production
// secrets file before getEnv() reads it. See ./loadSecrets.ts for why.
import './loadSecrets.js';
import { getEnv } from './env.js';
import { getLogger } from './logger.js';
import { initSentry } from './sentry.js';
import {
  startScrapeWorker,
  startSchedulerWorker,
  startPriorityWarmerWorker,
  startPriorityWarmerPlanWorker,
  startClubDirectoryWorker,
} from './worker.js';
import { startScheduler } from './scheduler.js';
import { startHeartbeat, stopHeartbeat } from './heartbeat.js';
import { disconnectRedis } from './redis.js';

async function main() {
  getEnv();
  initSentry();
  const log = getLogger();
  log.info('flipturn workers starting');

  const scrapeWorker = startScrapeWorker();
  const schedulerWorker = startSchedulerWorker();
  await startScheduler();
  // All three no-op unless INDEX_CRAWL_ENABLED === 'true'.
  const priorityWarmerWorker = startPriorityWarmerWorker();
  const priorityWarmerPlan = await startPriorityWarmerPlanWorker();
  const clubDirectoryWorker = startClubDirectoryWorker();
  startHeartbeat();
  log.info(
    { indexCrawlEnabled: process.env.INDEX_CRAWL_ENABLED === 'true' },
    'workers + scheduler + heartbeat running; ctrl-c to stop',
  );

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'shutting down');
    stopHeartbeat();
    await scrapeWorker.close();
    await schedulerWorker.close();
    if (priorityWarmerWorker) await priorityWarmerWorker.close();
    if (priorityWarmerPlan) {
      await priorityWarmerPlan.worker.close();
      await priorityWarmerPlan.queue.close();
    }
    if (clubDirectoryWorker) await clubDirectoryWorker.close();
    await disconnectRedis();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
