/**
 * Remote search fallback — calls SNC's WordPress site-search and persists
 * "stub" Athlete rows for any sncId we haven't seen before.
 *
 * Used by the athlete-search service when local results are sparse: the API
 * fans out to swimming.ca, parses the result list, and inserts a minimal
 * Athlete row per new hit (just `sncId` + `primaryName`). The full profile is
 * filled in later by the existing scrape pipeline.
 *
 * DI-driven for testability — callers pass a `fetch` adapter matching the
 * `FetchFn` shape used by the priority-warmer job (`{ url } -> { status,
 * body }`). Production wiring uses a thin adapter over `politeFetch` (see
 * `apps/server/workers/src/worker.ts` `politeFetchAdapter`).
 *
 * Failure mode is "degrade silently": any thrown error or non-200 returns
 * `{ stubsCreated: 0, sncIds: [] }` so the search endpoint can still serve
 * whatever local results exist instead of erroring.
 */
import type { PrismaClient, AthleteSource } from '@flipturn/db';
import { parseSearchResults } from '@flipturn/workers/parser/searchResults';
import type { FetchFn } from '@flipturn/workers/jobs/priorityWarmer';

export interface SearchRemoteResult {
  readonly stubsCreated: number;
  readonly sncIds: string[];
}

export async function searchRemoteAndPersistStubs(deps: {
  prisma: PrismaClient;
  fetch: FetchFn;
  q: string;
}): Promise<SearchRemoteResult> {
  const { prisma, fetch, q } = deps;
  const url = `https://www.swimming.ca/?s=${encodeURIComponent(q)}`;

  let body: string;
  try {
    const res = await fetch({ url });
    if (res.status !== 200) return { stubsCreated: 0, sncIds: [] };
    body = res.body;
  } catch {
    // FetchBlockedError, FetchRetryError, network errors — degrade gracefully.
    return { stubsCreated: 0, sncIds: [] };
  }

  let rows: ReturnType<typeof parseSearchResults>;
  try {
    rows = parseSearchResults(body);
  } catch {
    // Parser-mismatch (SNC redesigned the page). Don't propagate — the local
    // results we already have are still valid.
    return { stubsCreated: 0, sncIds: [] };
  }

  let stubsCreated = 0;
  for (const r of rows) {
    const existing = await prisma.athlete.findUnique({ where: { sncId: r.sncId } });
    if (existing) continue;
    await prisma.athlete.create({
      data: {
        sncId: r.sncId,
        primaryName: r.displayName,
        alternateNames: [],
        // TODO(v2 Task 15): switch to `REMOTE_DISCOVERY` once the enum lands.
        // Until then `CRAWLED` is the closest existing classifier — these
        // rows came from the SNC search page, so they're crawler-sourced
        // even though the warmer job didn't fill the full profile yet.
        source: 'CRAWLED' satisfies AthleteSource,
      },
    });
    stubsCreated++;
  }

  return { stubsCreated, sncIds: rows.map((r) => r.sncId) };
}
