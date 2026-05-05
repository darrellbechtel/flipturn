import { getEnv } from './env.js';
import { getLogger } from './logger.js';
import { initSentry } from './sentry.js';

async function main() {
  const env = getEnv();
  initSentry();
  const log = getLogger();
  log.info({ nodeEnv: env.NODE_ENV }, 'flipturn workers boot — env validated');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal:', err);
  process.exit(1);
});
