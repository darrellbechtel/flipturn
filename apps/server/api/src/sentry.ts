import * as Sentry from '@sentry/node';
import { getEnv } from './env.js';
import { getLogger } from './logger.js';

let _initialized = false;

export function initSentry(): void {
  if (_initialized) return;
  const env = getEnv();
  if (!env.SENTRY_DSN) {
    getLogger().info('SENTRY_DSN not set — Sentry disabled');
    _initialized = true;
    return;
  }
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: 0.1,
  });
  getLogger().info('Sentry initialized');
  _initialized = true;
}

export { Sentry };
