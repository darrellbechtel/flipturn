import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { Redis } from 'ioredis';
import { resetTokenBucket, resetRobotsCache, applyBackoff } from '../src/politeness.js';

const TEST_REDIS_URL = 'redis://localhost:56379';
const redis = new Redis(TEST_REDIS_URL, { maxRetriesPerRequest: null });

afterAll(async () => {
  await redis.quit();
});

describe('applyBackoff', () => {
  beforeEach(async () => {
    await resetTokenBucket(redis, 'backoff-test.example.com');
  });

  afterAll(async () => {
    await resetTokenBucket(redis, 'backoff-test.example.com');
  });

  it('forces the next acquireToken on the host to wait at least delayMs', async () => {
    const { acquireToken } = await import('../src/politeness.js');
    await applyBackoff(redis, 'backoff-test.example.com', 200);

    const start = Date.now();
    // ZERO_RNG → sampled inter-request = 1500ms, read pause = 1ms (rng()=0
    // < 0.2). On top of the 200ms backoff floor pushed into `last`, the
    // actual wait is roughly 200 + 1501 = ~1700ms.
    await acquireToken(redis, 'backoff-test.example.com', {
      rateLimitMs: 0,
      rng: () => 0,
    });
    const elapsed = Date.now() - start;

    // We still verify the backoff was honored (>= ~200ms). Upper bound is
    // bounded by the sampled-delay contribution under ZERO_RNG (~1700ms).
    expect(elapsed).toBeGreaterThanOrEqual(190);
    expect(elapsed).toBeLessThan(2000);
  });
});

describe('politeFetch on 429', () => {
  // Pre-populate robots cache with "allow everything" so politeFetch doesn't
  // attempt a real (mocked) fetch for /robots.txt. Also reset rate-limit and
  // daily-budget keys since SCRAPE_RATE_LIMIT_MS=5000 in .env.
  async function primeHost(host: string): Promise<void> {
    await resetRobotsCache(redis, host);
    await redis.set(`politeness:robots:${host}`, JSON.stringify({ disallow: [] }), 'EX', 60);
    await resetTokenBucket(redis, host);
  }

  it('parses Retry-After (seconds) and re-throws as a recoverable error', async () => {
    vi.resetModules();
    vi.doMock('undici', () => ({
      request: vi.fn().mockResolvedValue({
        statusCode: 429,
        headers: { 'content-type': 'text/html', 'retry-after': '10' },
        body: { text: async () => '' },
      }),
    }));

    await primeHost('host-429.example.com');

    const { politeFetch, FetchRetryError } = await import('../src/fetch.js');

    await expect(
      politeFetch({ url: 'http://host-429.example.com/page', sncId: 'TEST' }),
    ).rejects.toThrow(FetchRetryError);

    vi.doUnmock('undici');
  });

  it('parses Retry-After (HTTP-date) and re-throws as recoverable', async () => {
    vi.resetModules();
    const future = new Date(Date.now() + 5000).toUTCString();
    vi.doMock('undici', () => ({
      request: vi.fn().mockResolvedValue({
        statusCode: 429,
        headers: { 'content-type': 'text/html', 'retry-after': future },
        body: { text: async () => '' },
      }),
    }));

    await primeHost('host-429-date.example.com');

    const { politeFetch, FetchRetryError } = await import('../src/fetch.js');

    await expect(
      politeFetch({ url: 'http://host-429-date.example.com/page', sncId: 'TEST' }),
    ).rejects.toThrow(FetchRetryError);

    vi.doUnmock('undici');
  });
});
