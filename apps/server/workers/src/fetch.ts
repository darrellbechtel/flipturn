import { request } from 'undici';
import { getEnv } from './env.js';
import { getLogger } from './logger.js';
import { getRedis } from './redis.js';
import { acquireToken, applyBackoff, isAllowedByRobots, getUserAgent } from './politeness.js';
import { archiveResponse } from './archive.js';

export interface FetchRequest {
  readonly url: string;
  readonly sncId: string;
}

export interface FetchResult {
  readonly statusCode: number;
  readonly body: string;
  readonly contentType: string;
  readonly archivedAt: string;
  readonly fetchedAt: Date;
}

export class FetchBlockedError extends Error {
  constructor(reason: string) {
    super(`fetch blocked: ${reason}`);
    this.name = 'FetchBlockedError';
  }
}

/**
 * Thrown when the server signaled "try again later" (HTTP 429 with
 * Retry-After). The politeness layer has been told to back off; BullMQ
 * will retry the job using its existing exponential-backoff config.
 */
export class FetchRetryError extends Error {
  constructor(
    public readonly retryAfterMs: number,
    public readonly url: string,
  ) {
    super(`fetch 429: ${url} retry-after=${retryAfterMs}ms`);
    this.name = 'FetchRetryError';
  }
}

const MIN_BACKOFF_MS = 60_000; // ADR 0002: minimum 60s back-off on 429
const MAX_BACKOFF_MS = 24 * 60 * 60_000;

export async function politeFetch(req: FetchRequest): Promise<FetchResult> {
  const env = getEnv();
  const log = getLogger();
  const redis = getRedis();
  const url = new URL(req.url);

  const allowed = await isAllowedByRobots(redis, req.url);
  if (!allowed) {
    throw new FetchBlockedError(`disallowed by robots.txt: ${req.url}`);
  }

  const granted = await acquireToken(redis, url.host, {
    rateLimitMs: env.SCRAPE_RATE_LIMIT_MS,
    dailyBudget: env.SCRAPE_DAILY_HOST_BUDGET,
  });
  if (!granted) {
    throw new FetchBlockedError(`daily budget exhausted for ${url.host}`);
  }

  log.debug({ url: req.url }, 'fetching');
  const fetchedAt = new Date();
  const { statusCode, headers, body } = await request(req.url, {
    method: 'GET',
    headers: {
      'user-agent': getUserAgent(),
      accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
    },
  });

  if (statusCode === 429) {
    await body.text().catch(() => undefined);
    const retryAfterMs = parseRetryAfter(headers['retry-after']);
    await applyBackoff(redis, url.host, retryAfterMs);
    log.warn({ url: req.url, retryAfterMs }, '429 received; politeness backoff applied');
    throw new FetchRetryError(retryAfterMs, req.url);
  }

  const text = await body.text();
  const contentType = pickContentType(headers['content-type']);

  const archivedAt = await archiveResponse({
    baseDir: env.ARCHIVE_DIR,
    host: url.hostname,
    sncId: req.sncId,
    body: text,
    contentType,
  });

  log.info({ url: req.url, statusCode, archivedAt, bytes: text.length }, 'fetched and archived');

  return { statusCode, body: text, contentType, archivedAt, fetchedAt };
}

function pickContentType(header: string | string[] | undefined): string {
  if (!header) return 'application/octet-stream';
  return Array.isArray(header) ? (header[0] ?? 'application/octet-stream') : header;
}

/**
 * Parse a Retry-After header. RFC 7231 allows either an integer number of
 * seconds or an HTTP-date. We clamp to [MIN_BACKOFF_MS, MAX_BACKOFF_MS]
 * to bound bad/missing data.
 */
function parseRetryAfter(header: string | string[] | undefined): number {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return MIN_BACKOFF_MS;

  const seconds = Number.parseInt(raw, 10);
  if (Number.isFinite(seconds) && `${seconds}` === raw.trim()) {
    return clamp(seconds * 1000);
  }

  const ts = Date.parse(raw);
  if (Number.isFinite(ts)) {
    return clamp(ts - Date.now());
  }

  return MIN_BACKOFF_MS;
}

function clamp(ms: number): number {
  return Math.max(MIN_BACKOFF_MS, Math.min(MAX_BACKOFF_MS, ms));
}
