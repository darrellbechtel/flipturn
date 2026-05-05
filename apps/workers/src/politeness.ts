import type { Redis } from 'ioredis';

export interface TokenBucketOptions {
  /** Minimum interval between token grants in ms. */
  readonly rateLimitMs: number;
  /** Maximum tokens granted per host per UTC day. Optional; if unset, unlimited. */
  readonly dailyBudget?: number | undefined;
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
  const wait = Math.max(0, last + options.rateLimitMs - now);
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
