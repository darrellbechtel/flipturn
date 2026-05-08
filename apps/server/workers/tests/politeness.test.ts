import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { Redis } from 'ioredis';
import {
  acquireToken,
  computeSleepBetweenRequestsMs,
  resetTokenBucket,
} from '../src/politeness.js';
import { isAllowedByRobots, getUserAgent, resetRobotsCache } from '../src/politeness.js';

const TEST_REDIS_URL = 'redis://localhost:56379';
const TEST_HOST = 'test.example.com';

const redis = new Redis(TEST_REDIS_URL, { maxRetriesPerRequest: null });

afterAll(async () => {
  await redis.quit();
});

// RNG that returns 0 every call → sampleInterRequestDelayMs=1500,
// sampleReadPauseMs=1 (since 0 < 0.2 → 1 + floor(0 * 800) = 1). Total = 1501.
// Constant RNG: both internal calls in sampleReadPauseMs return 0 (the 0 < 0.2
// check passes, then 1 + floor(0*800) = 1).
// We pass this through `options.rng` so the timing-sensitive tests below stay
// deterministic even though the real path samples each delay.
const ZERO_RNG = () => 0;
// RNG that returns 0.5 → sampleInterRequestDelayMs=1500+floor(0.5*2501)=2750,
// sampleReadPauseMs=0 (0.5 >= 0.2). Total = 2750. Used to assert the floor
// behavior — caller's rateLimitMs only wins when it's higher than this.
const HALF_RNG = () => 0.5;

describe('acquireToken', () => {
  beforeEach(async () => {
    await resetTokenBucket(redis, TEST_HOST);
  });

  afterAll(async () => {
    await resetTokenBucket(redis, TEST_HOST);
  });

  it('grants the first token immediately', async () => {
    const start = Date.now();
    const granted = await acquireToken(redis, TEST_HOST, {
      rateLimitMs: 100,
      rng: ZERO_RNG,
    });
    const elapsed = Date.now() - start;
    expect(granted).toBe(true);
    // First call has no prior `last`, so `wait = max(0, 0 + delay - now)` = 0
    // regardless of how big `delay` is. 200ms tolerates Redis RTT.
    expect(elapsed).toBeLessThan(200);
  });

  it('blocks the second token until the sampled delay has passed', async () => {
    // ZERO_RNG → sampled total = 1501ms, dominates the 100ms floor.
    await acquireToken(redis, TEST_HOST, { rateLimitMs: 100, rng: ZERO_RNG });
    const start = Date.now();
    await acquireToken(redis, TEST_HOST, { rateLimitMs: 100, rng: ZERO_RNG });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(1490);
    expect(elapsed).toBeLessThan(1700);
  });

  it('honors a configured rateLimitMs floor above the sampled range', async () => {
    // HALF_RNG sample = 2750ms. With fake timers we can use a tiny floor that
    // still wins (e.g. 3000 > 2750) and assert the actual sleep duration via
    // a setTimeout spy, avoiding the multi-second wall-clock wait in CI.
    const observed: number[] = [];
    const realSetTimeout = global.setTimeout;
    const setSpy = vi
      .spyOn(global, 'setTimeout')
      .mockImplementation(((fn: (...args: unknown[]) => void, ms?: number) => {
        if (typeof ms === 'number' && ms >= 1000) {
          observed.push(ms);
          // Politeness sleep — don't actually wait, just resolve.
          return realSetTimeout(fn, 0);
        }
        return realSetTimeout(fn, ms ?? 0);
      }) as unknown as typeof setTimeout);
    try {
      await acquireToken(redis, TEST_HOST, { rateLimitMs: 3000, rng: HALF_RNG });
      await acquireToken(redis, TEST_HOST, { rateLimitMs: 3000, rng: HALF_RNG });
    } finally {
      setSpy.mockRestore();
    }
    // Second acquire's sleep is computed as `last + delay - now`, where a
    // few ms of redis RTT passes between the two calls — so the observed
    // sleep is slightly less than the floor (3000ms). The HALF_RNG sample
    // would yield 2750ms; observing > 2900ms proves the 3000ms floor won.
    expect(observed.length).toBeGreaterThanOrEqual(1);
    const sleep = Math.max(...observed);
    expect(sleep).toBeGreaterThan(2900);
    expect(sleep).toBeLessThanOrEqual(3000);
  });

  it('isolates buckets by host', async () => {
    await acquireToken(redis, TEST_HOST, {
      rateLimitMs: 1000,
      rng: ZERO_RNG,
    });
    const start = Date.now();
    // First call on a fresh host — wait should be ~0 (no prior touch).
    await acquireToken(redis, 'other.example.com', {
      rateLimitMs: 1000,
      rng: ZERO_RNG,
    });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(200);
    await resetTokenBucket(redis, 'other.example.com');
  });

  it('returns false when host budget is exhausted', async () => {
    // ZERO_RNG keeps each blocking second-call wait bounded (~1.5s) so the
    // test stays under the default vitest timeout.
    const granted1 = await acquireToken(redis, TEST_HOST, {
      rateLimitMs: 0,
      dailyBudget: 2,
      rng: ZERO_RNG,
    });
    const granted2 = await acquireToken(redis, TEST_HOST, {
      rateLimitMs: 0,
      dailyBudget: 2,
      rng: ZERO_RNG,
    });
    const granted3 = await acquireToken(redis, TEST_HOST, {
      rateLimitMs: 0,
      dailyBudget: 2,
      rng: ZERO_RNG,
    });
    expect(granted1).toBe(true);
    expect(granted2).toBe(true);
    expect(granted3).toBe(false);
  });
});

describe('computeSleepBetweenRequestsMs', () => {
  it('produces values in the sampled range when no floor is configured', () => {
    // 256 samples with the real Math.random RNG should not all collapse to a
    // single value — this is the property the new sampling behavior gives us.
    const seen = new Set<number>();
    for (let i = 0; i < 256; i++) {
      seen.add(computeSleepBetweenRequestsMs(0));
    }
    expect(seen.size).toBeGreaterThan(1);
    // Min observed should be at least the sampler floor (1500ms).
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(1500);
  });

  it('respects a configured floor above the sampled max', () => {
    // 10_000 is well above the 4000+800=4800 sampled cap, so it must win.
    expect(computeSleepBetweenRequestsMs(10_000)).toBe(10_000);
  });
});

describe('politeness sampled delay', () => {
  it('inter-request delays are not all identical across many acquires', async () => {
    // Capture every setTimeout(ms) call inside acquireToken so we can assert
    // the sleep durations vary call-to-call. We don't actually want to wait
    // 8×~2.7s in the test, so the spy resolves the timer immediately. We
    // ignore short-duration timers (ioredis internals can schedule sub-second
    // heartbeat/retry callbacks) and only count sleeps in the politeness
    // sampler's range.
    const observed: number[] = [];
    const realSetTimeout = global.setTimeout;
    const setSpy = vi
      .spyOn(global, 'setTimeout')
      .mockImplementation(((fn: (...args: unknown[]) => void, ms?: number) => {
        if (typeof ms === 'number' && ms >= 1000 && ms <= 5000) {
          observed.push(ms);
          // Politeness sleep — don't actually wait, just resolve.
          return realSetTimeout(fn, 0);
        }
        // Anything else (ioredis heartbeats, etc.) — preserve real semantics.
        return realSetTimeout(fn, ms ?? 0);
      }) as unknown as typeof setTimeout);

    const host = 'sampled-delay-test.example.com';
    try {
      await resetTokenBucket(redis, host);
      // First call doesn't sleep (no prior touch). Subsequent calls do.
      for (let i = 0; i < 8; i++) {
        await acquireToken(redis, host, { rateLimitMs: 0 });
      }
    } finally {
      setSpy.mockRestore();
      await resetTokenBucket(redis, host);
    }

    // We expect at least a handful of sleep durations and they shouldn't all
    // be the same constant — that's the regression the sampler is supposed
    // to prevent.
    expect(observed.length).toBeGreaterThanOrEqual(3);
    const distinct = new Set(observed);
    expect(distinct.size).toBeGreaterThan(1);
    // Every observed sleep should fall within the sampler's bounds
    // (1500..4800ms = 1500..4000 inter-request + 0..800 read pause).
    for (const ms of observed) {
      expect(ms).toBeGreaterThanOrEqual(1500);
      expect(ms).toBeLessThanOrEqual(4800);
    }
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
