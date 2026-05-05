import { getEnv } from './env.js';
import { getLogger } from './logger.js';
import { initSentry } from './sentry.js';
import { startScrapeWorker } from './worker.js';
import { startHeartbeat, stopHeartbeat } from './heartbeat.js';
import { disconnectRedis } from './redis.js';

async function main() {
  getEnv();
  initSentry();
  const log = getLogger();
  log.info('flipturn workers starting');

  const worker = startScrapeWorker();
  startHeartbeat();
  log.info('worker + heartbeat running; ctrl-c to stop');

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'shutting down');
    stopHeartbeat();
    await worker.close();
    await disconnectRedis();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal:', err);
  process.exit(1);
});
