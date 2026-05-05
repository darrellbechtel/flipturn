import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { Redis } from 'ioredis';
import { acquireToken, resetTokenBucket } from '../src/politeness.js';

const TEST_REDIS_URL = 'redis://localhost:56379';
const TEST_HOST = 'test.example.com';

const redis = new Redis(TEST_REDIS_URL, { maxRetriesPerRequest: null });

describe('acquireToken', () => {
  beforeEach(async () => {
    await resetTokenBucket(redis, TEST_HOST);
  });

  afterAll(async () => {
    await resetTokenBucket(redis, TEST_HOST);
    await redis.quit();
  });

  it('grants the first token immediately', async () => {
    const start = Date.now();
    const granted = await acquireToken(redis, TEST_HOST, { rateLimitMs: 100 });
    const elapsed = Date.now() - start;
    expect(granted).toBe(true);
    expect(elapsed).toBeLessThan(50);
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
    expect(elapsed).toBeLessThan(50);
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
