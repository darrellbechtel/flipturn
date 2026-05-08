/**
 * Club directory crawl job processor.
 *
 * Fetches the Swimming Canada "Find a Club" JSONP feed, parses it via
 * `parseClubDirectory`, and upserts every Club row by id. Existing Club rows
 * keep their `lastCrawledAt` (the warmer maintains that field separately) —
 * this job only refreshes the directory-derived metadata (name, province,
 * city, rosterUrl, shortName).
 *
 * Fully DI-driven (`prisma`, `fetch`) so it's testable without Redis or
 * undici. The `FetchFn` shape mirrors `priorityWarmer.ts` for consistency.
 *
 * Failure modes:
 * - Non-200 from the directory URL throws (BullMQ will retry per the queue's
 *   exponential-backoff config).
 * - An empty parse result is NOT an error — the SPA shell may legitimately
 *   not have inlined the JSONP, in which case we return zero upserts.
 */
import type { PrismaClient } from '@flipturn/db';
import { parseClubDirectory } from '../parser/clubDirectory.js';
import type { FetchFn } from './priorityWarmer.js';

const CLUB_DIRECTORY_URL = 'https://findaclub.swimming.ca/';

export interface RunClubDirectoryCrawlResult {
  /** Number of clubs the parser returned. */
  readonly parsed: number;
  /** Number of Club rows upserted. */
  readonly upserted: number;
}

export async function runClubDirectoryCrawl(deps: {
  prisma: PrismaClient;
  fetch: FetchFn;
}): Promise<RunClubDirectoryCrawlResult> {
  const { prisma, fetch } = deps;

  const res = await fetch({ url: CLUB_DIRECTORY_URL });
  if (res.status !== 200) {
    throw new Error(`club directory fetch failed: ${res.status}`);
  }

  const clubs = parseClubDirectory(res.body);
  if (clubs.length === 0) {
    return { parsed: 0, upserted: 0 };
  }

  let upserted = 0;
  for (const club of clubs) {
    await prisma.club.upsert({
      where: { id: club.id },
      create: {
        id: club.id,
        name: club.name,
        ...(club.shortName !== undefined ? { shortName: club.shortName } : {}),
        ...(club.province !== undefined ? { province: club.province } : {}),
        ...(club.city !== undefined ? { city: club.city } : {}),
        ...(club.rosterUrl !== undefined ? { rosterUrl: club.rosterUrl } : {}),
      },
      update: {
        name: club.name,
        ...(club.shortName !== undefined ? { shortName: club.shortName } : {}),
        ...(club.province !== undefined ? { province: club.province } : {}),
        ...(club.city !== undefined ? { city: club.city } : {}),
        ...(club.rosterUrl !== undefined ? { rosterUrl: club.rosterUrl } : {}),
      },
    });
    upserted++;
  }

  return { parsed: clubs.length, upserted };
}
