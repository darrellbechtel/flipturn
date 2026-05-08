/**
 * Priority warmer job processor.
 *
 * For one club name, fetch the SNC site-search page, then walk each numeric
 * swimmer result, parse its profile, and upsert an `Athlete` row keyed by
 * `sncId`. New rows are written with `source = CRAWLED`. Existing rows are
 * updated in place; a `USER_ONBOARDED` row only flips to `CRAWLED` when the
 * crawled `primaryName` matches the existing row's `primaryName` exactly —
 * this guards against accidentally clobbering a user-curated identity if the
 * SNC search routes us to an unrelated swimmer with the same sncId.
 *
 * The job is fully DI-driven (`prisma`, `fetch`) so it's testable without
 * Redis, BullMQ, or undici. The `FetchFn` shape deliberately exposes only
 * `url`, `status`, `body` — that's the minimum the warmer needs and matches
 * the test fixtures. Production wiring uses a thin adapter over `politeFetch`.
 *
 * Failure modes:
 * - The site-search page returning non-200 throws (the run cannot proceed).
 * - An individual swimmer profile returning non-200 is skipped silently — the
 *   next scheduled run will retry. This stops a transient 503 on one profile
 *   from poisoning the entire warmer run.
 * - An empty result set is NOT an error; the parser legitimately returns []
 *   when SNC's search has nothing to show.
 * - `parseSearchResults` / `parseSwimmerProfile` exceptions propagate (they're
 *   the parser-mismatch signal).
 */
import type { PrismaClient, AthleteSource, Gender } from '@flipturn/db';
import { parseSearchResults } from '../parser/searchResults.js';
import { parseSwimmerProfile } from '../parser/swimmerPage.js';

/**
 * Minimal fetch contract used by job processors. Production code wires this
 * to `politeFetch` via a small adapter; tests pass a `vi.fn` directly.
 */
export type FetchFn = (req: { url: string }) => Promise<{ status: number; body: string }>;

/**
 * Thrown when a parser asserts that the page shape it expected is no longer
 * there (e.g. SNC redesigns the search results). Callers should treat this
 * as a hard failure that needs human attention — not a transient retry.
 *
 * Lives here for now; will move to `clubDirectoryCrawl.ts` when that job
 * processor lands and both jobs share the same import.
 */
export class ParserMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParserMismatchError';
  }
}

export interface RunPriorityWarmerResult {
  /** Always 1 for the per-club entrypoint; reserved for future fan-out. */
  readonly searched: number;
  /** Number of numeric `/swimmer/<id>/` results returned by the search. */
  readonly discovered: number;
  /** Number of athletes successfully created or updated this run. */
  readonly upserted: number;
}

export async function runPriorityWarmer(deps: {
  prisma: PrismaClient;
  fetch: FetchFn;
  clubName: string;
}): Promise<RunPriorityWarmerResult> {
  const { prisma, fetch, clubName } = deps;

  const searchUrl = `https://www.swimming.ca/?s=${encodeURIComponent(clubName)}`;
  const searchRes = await fetch({ url: searchUrl });
  if (searchRes.status !== 200) {
    throw new Error(`search fetch failed: ${searchRes.status}`);
  }

  // Parser exceptions propagate as ParserMismatchError-equivalent — the parser
  // currently throws plain Error from cheerio. An empty array is a legitimate
  // "no results" signal, not a parser failure.
  const searchRows = parseSearchResults(searchRes.body);
  if (searchRows.length === 0) {
    return { searched: 1, discovered: 0, upserted: 0 };
  }

  const now = new Date();
  let upserted = 0;

  for (const row of searchRows) {
    const swimmerRes = await fetch({ url: row.profileUrl });
    if (swimmerRes.status !== 200) {
      // Skip individual failures; the next scheduled run will retry.
      continue;
    }

    const profile = parseSwimmerProfile(swimmerRes.body);
    if (!profile.primaryName) continue;

    // Resolve clubId by case-insensitive match of the profile's club name
    // against the Club table. Best-effort: `null` when there's no match.
    let clubId: string | null = null;
    if (profile.clubName) {
      const club = await prisma.club.findFirst({
        where: { name: { contains: profile.clubName, mode: 'insensitive' } },
        select: { id: true },
      });
      clubId = club?.id ?? null;
    }

    const existing = await prisma.athlete.findUnique({ where: { sncId: row.sncId } });
    if (!existing) {
      await prisma.athlete.create({
        data: {
          sncId: row.sncId,
          primaryName: profile.primaryName,
          alternateNames: [],
          dobYear: profile.dobYear ?? null,
          // Prisma rejects `gender: null` for an optional enum; use undefined
          // when the parser didn't return one so the field is just omitted.
          ...(profile.gender ? { gender: profile.gender as Gender } : {}),
          homeClub: profile.clubName ?? null,
          clubId,
          source: 'CRAWLED' satisfies AthleteSource,
          lastIndexedAt: now,
        },
      });
    } else {
      const existingTyped = existing as {
        source: AthleteSource;
        primaryName: string;
        clubId: string | null;
        homeClub: string | null;
        gender: Gender | null;
        dobYear: number | null;
      };

      // Source-flip rule: only USER_ONBOARDED rows whose name matches what
      // the crawler just parsed get re-classified as CRAWLED. This keeps a
      // user-onboarded identity intact if the search ever routes us to a
      // different swimmer with the same sncId, and is a one-way transition
      // (CRAWLED rows never flip back, so we omit `source` entirely on
      // already-crawled updates).
      const shouldFlipToCrawled =
        existingTyped.source === 'USER_ONBOARDED' &&
        existingTyped.primaryName === profile.primaryName;

      await prisma.athlete.update({
        where: { sncId: row.sncId },
        data: {
          primaryName: profile.primaryName,
          dobYear: profile.dobYear ?? existingTyped.dobYear,
          // Only overwrite gender when we have a fresh value; leave the
          // existing one untouched otherwise.
          ...(profile.gender ? { gender: profile.gender as Gender } : {}),
          homeClub: profile.clubName ?? existingTyped.homeClub,
          clubId: clubId ?? existingTyped.clubId,
          lastIndexedAt: now,
          ...(shouldFlipToCrawled ? { source: 'CRAWLED' as AthleteSource } : {}),
        },
      });
    }
    upserted++;
  }

  // Best-effort `Club.lastCrawledAt` update. We use the raw input clubName
  // (not the parsed profile.clubName) because this run is keyed on the
  // intent ("warm club X") regardless of which swimmers it found.
  const matchedClub = await prisma.club.findFirst({
    where: { name: { contains: clubName, mode: 'insensitive' } },
    select: { id: true },
  });
  if (matchedClub) {
    await prisma.club.update({
      where: { id: matchedClub.id },
      data: { lastCrawledAt: now },
    });
  }

  return { searched: 1, discovered: searchRows.length, upserted };
}
