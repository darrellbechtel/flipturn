/**
 * Athlete search service — two-stage (local first, remote fallback).
 *
 *  1. Run a single raw SQL query against the local Athlete index combining:
 *     - tsvector full-text match on the generated `searchVector` column
 *       (uses the `Athlete_searchVector_idx` GIN index)
 *     - trigram similarity on `primaryName` (uses `Athlete_primaryName_trgm_idx`)
 *     - exact-match boost (case + accent-insensitive)
 *     - LEFT JOIN to Club for name/province enrichment
 *     - EXISTS subqueries for `hasFlipturnProfile` and `alreadyLinkedToMe`
 *
 *  2. If we found at least `MIN_LOCAL_HITS` (=3) results, return them.
 *
 *  3. Otherwise, fan out to swimming.ca via `searchRemoteAndPersistStubs` —
 *     this inserts stub Athlete rows for any sncId we hadn't seen — and
 *     re-run the local query. This widens coverage without making the user
 *     wait for full profile scrapes; the priority warmer / scrape pipeline
 *     fills in the details later.
 *
 * CRITICAL: every place that filters or scores by name uses `f_unaccent($1)`
 * (the IMMUTABLE wrapper from migration 20260508143805_athlete_search_index)
 * — NOT the bare STABLE `unaccent($1)`. The `searchVector` generated column
 * uses `f_unaccent`, so any query against it must too, or the planner won't
 * pick the GIN index.
 */
import { Prisma, type PrismaClient } from '@flipturn/db';
import type { AthleteSearchResult } from '@flipturn/shared';
import type { FetchFn } from '@flipturn/workers/jobs/priorityWarmer';
import { searchRemoteAndPersistStubs } from './searchProxy.js';

/**
 * Minimum number of local hits to short-circuit the remote fallback. Below
 * this, we expand the index by hitting swimming.ca and re-querying.
 */
const MIN_LOCAL_HITS = 3;

export interface SearchAthletesArgs {
  readonly q: string;
  readonly clubId?: string | undefined;
  readonly province?: string | undefined;
  readonly limit: number;
  readonly userId: string;
}

export interface SearchAthletesResult {
  readonly results: AthleteSearchResult[];
  readonly total: number;
  /** True when the remote fallback was attempted on this request. */
  readonly usedRemoteFallback: boolean;
  /** Number of new stub rows the remote fallback inserted. */
  readonly stubsCreated: number;
}

interface RawRow {
  sncId: string;
  primaryName: string;
  alternateNames: string[];
  dobYear: number | null;
  gender: string | null;
  clubId: string | null;
  clubName: string | null;
  clubProvince: string | null;
  hasFlipturnProfile: boolean;
  alreadyLinkedToMe: boolean;
  rank: number;
}

export async function searchAthletes(deps: {
  prisma: PrismaClient;
  fetch?: FetchFn;
  args: SearchAthletesArgs;
}): Promise<SearchAthletesResult> {
  const { prisma, fetch, args } = deps;

  const localFirst = await runLocalSearch(prisma, args);
  if (localFirst.length >= MIN_LOCAL_HITS) {
    return {
      results: localFirst.map(toResult),
      total: localFirst.length,
      usedRemoteFallback: false,
      stubsCreated: 0,
    };
  }

  // Remote fallback. If no fetcher was injected (e.g. unit-only callers),
  // we just return what we have.
  if (!fetch) {
    return {
      results: localFirst.map(toResult),
      total: localFirst.length,
      usedRemoteFallback: false,
      stubsCreated: 0,
    };
  }

  const remote = await searchRemoteAndPersistStubs({
    prisma,
    fetch,
    q: args.q,
  });

  // Re-run the local query — newly-persisted stubs are now visible (their
  // searchVector was populated by the GENERATED column on insert).
  const merged = await runLocalSearch(prisma, args);

  return {
    results: merged.map(toResult),
    total: merged.length,
    usedRemoteFallback: true,
    stubsCreated: remote.stubsCreated,
  };
}

async function runLocalSearch(
  prisma: PrismaClient,
  args: SearchAthletesArgs,
): Promise<RawRow[]> {
  const { q, clubId, province, limit, userId } = args;

  // We pass clubId / province as `text` parameters and use `IS NULL`-guarded
  // OR clauses so a single SQL form handles all four filter combinations
  // without dynamic string assembly. The `::text` casts are required for
  // Postgres to bind the typed-null parameters.
  const rows = await prisma.$queryRaw<RawRow[]>(Prisma.sql`
    SELECT
      a."sncId",
      a."primaryName",
      a."alternateNames",
      a."dobYear",
      a."gender"::text AS gender,
      c."id" AS "clubId",
      c."name" AS "clubName",
      c."province" AS "clubProvince",
      EXISTS (
        SELECT 1 FROM "UserAthlete" ua WHERE ua."athleteId" = a."id"
      ) AS "hasFlipturnProfile",
      EXISTS (
        SELECT 1 FROM "UserAthlete" ua
        WHERE ua."athleteId" = a."id" AND ua."userId" = ${userId}
      ) AS "alreadyLinkedToMe",
      GREATEST(
        CASE
          WHEN f_unaccent(lower(a."primaryName")) = f_unaccent(lower(${q}))
          THEN 1.0
          ELSE 0
        END,
        ts_rank(a."searchVector", plainto_tsquery('simple', f_unaccent(${q}))),
        similarity(a."primaryName", ${q})
      ) AS rank
    FROM "Athlete" a
    LEFT JOIN "Club" c ON c."id" = a."clubId"
    WHERE
      (
        a."searchVector" @@ plainto_tsquery('simple', f_unaccent(${q}))
        OR similarity(a."primaryName", ${q}) > 0.3
      )
      AND (${clubId ?? null}::text IS NULL OR a."clubId" = ${clubId ?? null})
      AND (${province ?? null}::text IS NULL OR c."province" = ${province ?? null})
    ORDER BY rank DESC, a."primaryName" ASC
    LIMIT ${limit}
  `);

  return rows;
}

function toResult(row: RawRow): AthleteSearchResult {
  const gender =
    row.gender === 'M' || row.gender === 'F' || row.gender === 'X' ? row.gender : null;
  return {
    sncId: row.sncId,
    displayName: row.primaryName,
    alternateNames: row.alternateNames,
    dobYear: row.dobYear,
    gender,
    club: row.clubId
      ? {
          id: row.clubId,
          name: row.clubName ?? '',
          province: row.clubProvince,
        }
      : null,
    hasFlipturnProfile: row.hasFlipturnProfile,
    alreadyLinkedToMe: row.alreadyLinkedToMe,
  };
}

export const __testing = { MIN_LOCAL_HITS };
