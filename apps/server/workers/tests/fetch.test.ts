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

describe('politeFetch headers (ADR 0007 lock-in)', () => {
  // Same robots/budget priming as the 429 suite — politeFetch hits robots.txt
  // and the token bucket before the GET we want to inspect.
  async function primeHost(host: string): Promise<void> {
    await resetRobotsCache(redis, host);
    await redis.set(`politeness:robots:${host}`, JSON.stringify({ disallow: [] }), 'EX', 60);
    await resetTokenBucket(redis, host);
  }

  it('sends browser User-Agent, From, Accept, Accept-Language on every request', async () => {
    vi.resetModules();
    const captured: Record<string, string>[] = [];
    const mockRequest = vi.fn(async (_url: string, init?: { headers?: Record<string, string> }) => {
      captured.push({ ...(init?.headers ?? {}) });
      return {
        statusCode: 200,
        headers: { 'content-type': 'text/html' },
        body: { text: async () => '<html></html>' },
      };
    });
    vi.doMock('undici', () => ({ request: mockRequest }));

    await primeHost('headers-host.example.com');

    const fetchMod = await import('../src/fetch.js');
    const {
      politeFetch,
      CRAWLER_USER_AGENT,
      CRAWLER_FROM,
      CRAWLER_ACCEPT,
      CRAWLER_ACCEPT_LANGUAGE,
    } = fetchMod;

    await politeFetch({
      url: 'http://headers-host.example.com/swimmer/5567334/',
      sncId: '5567334',
    });

    // Find the headers from the actual swimmer GET (skip any robots.txt fetch
    // that may have slipped through, though primeHost should have prevented it).
    const swimmerCall = captured.find((h) => h['user-agent'] || h['User-Agent']);
    expect(swimmerCall).toBeDefined();
    const h = swimmerCall as Record<string, string>;

    expect(h['User-Agent'] ?? h['user-agent']).toBe(CRAWLER_USER_AGENT);
    expect(h['From'] ?? h['from']).toBe(CRAWLER_FROM);
    expect(h['Accept'] ?? h['accept']).toBe(CRAWLER_ACCEPT);
    expect(h['Accept-Language'] ?? h['accept-language']).toBe(CRAWLER_ACCEPT_LANGUAGE);

    vi.doUnmock('undici');
  });

  it('From: header MUST be present on every fetch (ADR 0007 transparency invariant)', async () => {
    vi.resetModules();
    const captured: Record<string, string>[] = [];
    const mockRequest = vi.fn(async (_url: string, init?: { headers?: Record<string, string> }) => {
      captured.push({ ...(init?.headers ?? {}) });
      return {
        statusCode: 200,
        headers: { 'content-type': 'text/html' },
        body: { text: async () => '<html></html>' },
      };
    });
    vi.doMock('undici', () => ({ request: mockRequest }));

    // Per-call hosts so each request gets a clean token bucket — the rate
    // limiter would otherwise reject the second call as "daily budget
    // exhausted" only if hits were big enough; safer to use distinct hosts.
    const hosts = ['from-host-1.example.com', 'from-host-2.example.com', 'from-host-3.example.com'];
    for (const host of hosts) {
      await primeHost(host);
    }

    const { politeFetch, CRAWLER_FROM } = await import('../src/fetch.js');

    await politeFetch({ url: `http://${hosts[0]}/swimmer/1/`, sncId: '1' });
    await politeFetch({ url: `http://${hosts[1]}/swimmer/2/`, sncId: '2' });
    await politeFetch({ url: `http://${hosts[2]}/?s=Felix`, sncId: 'SEARCH' });

    // Filter out any robots.txt fetches; we only want the swimmer/search GETs.
    const swimmerCalls = captured.filter((h) => h['user-agent'] || h['User-Agent']);
    expect(swimmerCalls.length).toBe(3);
    for (const h of swimmerCalls) {
      expect(h['From'] ?? h['from']).toBe(CRAWLER_FROM);
    }

    vi.doUnmock('undici');
  });
});
