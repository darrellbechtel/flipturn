import { request } from 'undici';
import { getEnv } from './env.js';
import { getLogger } from './logger.js';
import { getRedis } from './redis.js';
import { acquireToken, isAllowedByRobots, getUserAgent } from './politeness.js';
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
