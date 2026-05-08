import type { Redis } from 'ioredis';
import { request } from 'undici';
import { getEnv } from './env.js';
import { getLogger } from './logger.js';
import {
  sampleInterRequestDelayMs,
  sampleReadPauseMs,
  type Rng,
} from './scheduler/window.js';

export interface TokenBucketOptions {
  /**
   * Minimum interval between token grants in ms — acts as a *floor* under
   * the sampled inter-request delay. The actual per-request wait is
   * `max(rateLimitMs, sampleInterRequestDelayMs() + sampleReadPauseMs())`,
   * so callers supplying a high floor still work, while the default path
   * gets the 1500–4000 ms sampled cadence with an occasional read pause.
   */
  readonly rateLimitMs: number;
  /** Maximum tokens granted per host per UTC day. Optional; if unset, unlimited. */
  readonly dailyBudget?: number | undefined;
  /**
   * Optional injectable RNG for deterministic tests. Defaults to Math.random
   * inside the sampler helpers. Production callers should leave unset.
   */
  readonly rng?: Rng | undefined;
}

/**
 * Compute the wait (ms) the caller should sleep before the next request to
 * `host`. Combines the configured `rateLimitMs` floor with a sampled
 * inter-request delay (and an occasional short read pause) so the cadence
 * looks human-paced rather than metronomic. Exposed for tests; production
 * code should call {@link acquireToken} which handles the actual sleeping.
 */
export function computeSleepBetweenRequestsMs(
  rateLimitMs: number,
  rng?: Rng,
): number {
  const sampled = sampleInterRequestDelayMs(rng) + sampleReadPauseMs(rng);
  return Math.max(rateLimitMs, sampled);
}

const lastTouchKey = (host: string) => `politeness:last:${host}`;
const dailyCountKey = (host: string) => {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  return `politeness:count:${host}:${day}`;
};

/**
 * Acquire a politeness token for the given host. Blocks (via setTimeout)
 * until rateLimitMs has elapsed since the last grant for that host.
 * Returns false if the daily budget is exhausted.
 */
export async function acquireToken(
  redis: Redis,
  host: string,
  options: TokenBucketOptions,
): Promise<boolean> {
  if (typeof options.dailyBudget === 'number') {
    const countKey = dailyCountKey(host);
    const count = await redis.incr(countKey);
    if (count === 1) {
      // first incr today → set a 25h TTL so the key auto-cleans.
      await redis.expire(countKey, 90_000);
    }
    if (count > options.dailyBudget) {
      // Roll back: don't double-charge if we were going to block.
      await redis.decr(countKey);
      return false;
    }
  }

  const lastKey = lastTouchKey(host);
  const lastStr = await redis.get(lastKey);
  const last = lastStr ? parseInt(lastStr, 10) : 0;
  const now = Date.now();
  // Sample a fresh per-request delay so the cadence isn't metronomic. The
  // configured `rateLimitMs` acts as a floor — callers passing a higher
  // value (e.g. via 429 backoff) still get at least that wait.
  const delay = computeSleepBetweenRequestsMs(options.rateLimitMs, options.rng);
  const wait = Math.max(0, last + delay - now);
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  await redis.set(lastKey, Date.now().toString(), 'EX', 60 * 60); // 1h TTL
  return true;
}

/** Test helper. */
export async function resetTokenBucket(redis: Redis, host: string): Promise<void> {
  await redis.del(lastTouchKey(host));
  const day = new Date().toISOString().slice(0, 10);
  await redis.del(`politeness:count:${host}:${day}`);
}

export function getUserAgent(): string {
  return getEnv().SCRAPE_USER_AGENT;
}

const robotsKey = (host: string) => `politeness:robots:${host}`;
const ROBOTS_TTL_S = 24 * 60 * 60; // 24h

interface RobotsRules {
  /** Disallow paths for our user-agent. Empty array = no restrictions. */
  readonly disallow: readonly string[];
}

/**
 * Fetch and parse robots.txt for a host. Returns "allow everything" on
 * any error (network, 404, etc.) — fail-open is acceptable here because
 * scraping etiquette is one consideration among several (see also rate
 * limiting and source attribution).
 */
async function fetchRobots(hostUrl: URL): Promise<RobotsRules> {
  const robotsUrl = `${hostUrl.protocol}//${hostUrl.host}/robots.txt`;
  try {
    const { statusCode, body } = await request(robotsUrl, {
      method: 'GET',
      headers: { 'user-agent': getUserAgent() },
    });
    if (statusCode !== 200) {
      return { disallow: [] };
    }
    const text = await body.text();
    return parseRobots(text);
  } catch (err) {
    getLogger().warn({ err, robotsUrl }, 'robots.txt fetch failed; allowing all');
    return { disallow: [] };
  }
}

/** Minimal robots.txt parser — supports User-agent and Disallow. */
function parseRobots(text: string): RobotsRules {
  const lines = text.split(/\r?\n/);
  const disallow: string[] = [];
  let currentApplies = false;
  for (const raw of lines) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const [keyRaw, ...rest] = line.split(':');
    if (!keyRaw || rest.length === 0) continue;
    const key = keyRaw.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      // Apply if matches our UA token or wildcard.
      currentApplies = value === '*' || getUserAgent().toLowerCase().includes(value.toLowerCase());
    } else if (key === 'disallow' && currentApplies && value) {
      disallow.push(value);
    }
  }
  return { disallow };
}

export async function isAllowedByRobots(redis: Redis, fullUrl: string): Promise<boolean> {
  const url = new URL(fullUrl);
  const cacheKey = robotsKey(url.host);
  const cached = await redis.get(cacheKey);
  let rules: RobotsRules;
  if (cached) {
    rules = JSON.parse(cached) as RobotsRules;
  } else {
    rules = await fetchRobots(url);
    await redis.set(cacheKey, JSON.stringify(rules), 'EX', ROBOTS_TTL_S);
  }
  return !rules.disallow.some((path) => url.pathname.startsWith(path));
}

/** Test helper. */
export async function resetRobotsCache(redis: Redis, host: string): Promise<void> {
  await redis.del(robotsKey(host));
}

/**
 * Push the host's "last touched" key forward by `delayMs`. The next
 * `acquireToken` call for this host will block until that delay passes.
 * Used to honor 429 / Retry-After server signals.
 */
export async function applyBackoff(redis: Redis, host: string, delayMs: number): Promise<void> {
  const futureWindow = Date.now() + delayMs;
  // 1h TTL matches the existing key TTL.
  await redis.set(`politeness:last:${host}`, futureWindow.toString(), 'EX', 60 * 60);
}
