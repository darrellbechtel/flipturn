import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { Hono } from 'hono';
import { Redis } from 'ioredis';
import { rateLimit } from '../../src/middleware/rateLimit.js';
import { errorHandler } from '../../src/middleware/error.js';

const TEST_REDIS_URL = 'redis://localhost:56379';
const redis = new Redis(TEST_REDIS_URL, { maxRetriesPerRequest: null });

describe('rateLimit middleware', () => {
  beforeEach(async () => {
    const keys = await redis.keys('rl:test-bucket:*');
    if (keys.length) await redis.del(...keys);
  });

  afterAll(async () => {
    await redis.quit();
  });

  it('allows up to `limit` requests, then 429s', async () => {
    const app = new Hono();
    app.onError(errorHandler);
    app.use(
      '/limited',
      rateLimit(redis, {
        bucket: 'test-bucket',
        windowSec: 60,
        limit: 3,
        identify: () => 'fixed-ip',
      }),
    );
    app.get('/limited', (c) => c.json({ ok: true }));

    expect((await app.request('/limited')).status).toBe(200);
    expect((await app.request('/limited')).status).toBe(200);
    expect((await app.request('/limited')).status).toBe(200);
    expect((await app.request('/limited')).status).toBe(429);
  });

  it('isolates buckets by identity', async () => {
    const app = new Hono();
    app.onError(errorHandler);
    let id = 'a';
    app.use(
      '/limited',
      rateLimit(redis, {
        bucket: 'test-bucket',
        windowSec: 60,
        limit: 1,
        identify: () => id,
      }),
    );
    app.get('/limited', (c) => c.json({ ok: true }));

    expect((await app.request('/limited')).status).toBe(200);
    expect((await app.request('/limited')).status).toBe(429);
    id = 'b';
    expect((await app.request('/limited')).status).toBe(200);
  });
});
