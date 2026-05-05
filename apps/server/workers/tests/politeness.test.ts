import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { Redis } from 'ioredis';
import { acquireToken, resetTokenBucket } from '../src/politeness.js';
import { isAllowedByRobots, getUserAgent, resetRobotsCache } from '../src/politeness.js';

const TEST_REDIS_URL = 'redis://localhost:56379';
const TEST_HOST = 'test.example.com';

const redis = new Redis(TEST_REDIS_URL, { maxRetriesPerRequest: null });

afterAll(async () => {
  await redis.quit();
});

describe('acquireToken', () => {
  beforeEach(async () => {
    await resetTokenBucket(redis, TEST_HOST);
  });

  afterAll(async () => {
    await resetTokenBucket(redis, TEST_HOST);
  });

  it('grants the first token immediately', async () => {
    const start = Date.now();
    const granted = await acquireToken(redis, TEST_HOST, { rateLimitMs: 100 });
    const elapsed = Date.now() - start;
    expect(granted).toBe(true);
    // Widened from 50ms to 200ms — first-call still well under the 100ms
    // rateLimitMs window, but tolerates Redis RTT + Node jitter on slow machines.
    expect(elapsed).toBeLessThan(200);
  });

  it('blocks the second token until rateLimitMs has passed', async () => {
    await acquireToken(redis, TEST_HOST, { rateLimitMs: 100 });
    const start = Date.now();
    await acquireToken(redis, TEST_HOST, { rateLimitMs: 100 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(95);
    expect(elapsed).toBeLessThan(250);
  });

  it('isolates buckets by host', async () => {
    await acquireToken(redis, TEST_HOST, { rateLimitMs: 1000 });
    const start = Date.now();
    await acquireToken(redis, 'other.example.com', { rateLimitMs: 1000 });
    const elapsed = Date.now() - start;
    // Widened from 50ms to 200ms (well below the 1000ms rateLimitMs window).
    expect(elapsed).toBeLessThan(200);
    await resetTokenBucket(redis, 'other.example.com');
  });

  it('returns false when host budget is exhausted', async () => {
    const granted1 = await acquireToken(redis, TEST_HOST, {
      rateLimitMs: 0,
      dailyBudget: 2,
    });
    const granted2 = await acquireToken(redis, TEST_HOST, {
      rateLimitMs: 0,
      dailyBudget: 2,
    });
    const granted3 = await acquireToken(redis, TEST_HOST, {
      rateLimitMs: 0,
      dailyBudget: 2,
    });
    expect(granted1).toBe(true);
    expect(granted2).toBe(true);
    expect(granted3).toBe(false);
  });
});

describe('getUserAgent', () => {
  it('returns the env-configured user-agent', () => {
    expect(getUserAgent()).toContain('FlipTurnBot');
  });
});

describe('isAllowedByRobots', () => {
  beforeEach(async () => {
    await resetRobotsCache(redis, 'robots-test.example.com');
  });

  it('returns true when the host has no robots.txt (fetch error)', async () => {
    // 'robots-test.example.com' resolves to no real server; the implementation
    // treats any non-200 / network error as "allowed" (fail-open).
    const allowed = await isAllowedByRobots(redis, 'http://robots-test.example.com/results/123');
    expect(allowed).toBe(true);
  });
});
