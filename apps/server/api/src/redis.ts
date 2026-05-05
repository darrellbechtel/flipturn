import { Redis, type RedisOptions } from 'ioredis';
import { getEnv } from './env.js';
import { getLogger } from './logger.js';

let _client: Redis | undefined;

const COMMON_OPTIONS: RedisOptions = {
  // BullMQ requires this for blocking commands.
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: false,
};

export function getRedis(): Redis {
  if (!_client) {
    const env = getEnv();
    _client = new Redis(env.REDIS_URL, COMMON_OPTIONS);
    _client.on('error', (err) => {
      getLogger().error({ err }, 'redis error');
    });
    _client.on('connect', () => {
      getLogger().debug('redis connected');
    });
  }
  return _client;
}

export async function disconnectRedis(): Promise<void> {
  if (_client) {
    await _client.quit();
    _client = undefined;
  }
}
