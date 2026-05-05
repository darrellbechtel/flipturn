import type { Context, Next } from 'hono';
import type { Redis } from 'ioredis';
import { ApiError } from './error.js';

export interface RateLimitOptions {
  /** Logical bucket name; combined with the request identity. */
  readonly bucket: string;
  /** Window length in seconds. */
  readonly windowSec: number;
  /** Max requests per window. */
  readonly limit: number;
  /** Identity extractor. Default: IP from cf-connecting-ip / x-forwarded-for. */
  readonly identify?: (c: Context) => string;
}

function defaultIdentify(c: Context): string {
  // Cloudflare Tunnel injects cf-connecting-ip; fall back to the first
  // x-forwarded-for hop, then to a stable sentinel so unconfigured environments
  // (tests, local) still rate-limit by *something* rather than by undefined.
  return (
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

export function rateLimit(redis: Redis, options: RateLimitOptions) {
  const identify = options.identify ?? defaultIdentify;
  return async (c: Context, next: Next): Promise<Response | void> => {
    const id = identify(c);
    const key = `rl:${options.bucket}:${id}`;
    // INCR + EXPIRE pattern: atomic bump, set TTL only on first hit. This is a
    // fixed-window counter (resets on first hit after expiry) — not a true
    // sliding window, but adequate for the closed beta's threat model
    // (slow-down email-bomb / token-spam, not adversarial DDoS).
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, options.windowSec);
    }
    if (count > options.limit) {
      throw new ApiError(429, 'Too many requests', 'rate_limited');
    }
    await next();
  };
}
