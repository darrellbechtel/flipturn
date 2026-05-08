# Athlete Search Index — v2 Pivot

**Date:** 2026-05-08
**Status:** Approved — supersedes §5–§7 of [`2026-05-08-01-athlete-search-index-design.md`](./2026-05-08-01-athlete-search-index-design.md)
**Trigger:** Implementation discovery during Task 4 of the original plan revealed that the assumed data sources don't exist.

---

## What changed and why

The original spec assumed two URL surfaces:
- `findaclub.swimming.ca/` returning HTML with SNC club codes
- `results.swimming.ca/clubs/<id>/` returning per-club rosters

Reality (verified during Task 4 implementation):
- `findaclub.swimming.ca/` is a SPA shell. The actual club list lives in a JSONP feed at `https://www.swimming.ca/club-list.php?preview=true&callback=load_clubs` containing **415 clubs** with names + addresses but **no SNC club codes**.
- `results.swimming.ca/clubs/<anything>/` returns 404. The URL pattern simply doesn't exist.
- `swimming.ca/wp-json/wp/v2/swimmer` is a clean WP REST endpoint, **but it only contains 435 curated National Team / Para Bio swimmers** — not the ~50k Canadian age-group swimmers we actually need.
- `swimming.ca/swimmer/<numeric-id>/` (e.g. `5567334` = Felix Bechtel) is a public, rich HTML profile for *every* registered swimmer — but there is no public endpoint that enumerates these IDs.
- `swimrankings.net` is Cloudflare-walled to direct fetches.

### The viable enumeration surface

`https://www.swimming.ca/?s=<query>` (the WordPress site search) returns HTML with linked `/swimmer/<id>/` results for any registered swimmer, including age-groupers. This is the only public enumeration mechanism we've found that covers the long tail.

## Revised architecture

Two ingest paths replace the original "directory + per-club roster" pipeline:

```
                                                Postgres
                                                 Athlete
                                                ↑       ↑
                                                │       │
                       ┌────────────────────────┘       └──────────────────┐
                       │                                                   │
              ┌────────────────────┐                              ┌────────────────────┐
              │ priority-warmer    │ nightly, jittered            │ on-demand ingest    │
              │ (apps/server/      │ ───────────► swimming.ca/?s= │ (existing           │
              │  workers, BullMQ)  │              site search     │  athlete-detail-     │
              └────────────────────┘    parses linked /swimmer/   │  scrape job)        │
                       │                <id>/, fetches each       └────────────────────┘
                       │                page → Athlete row                   ↑
                       │                                                     │
                       │                                              user picks a result
                       │                                                     │
                       └──── seeds club-warrior swimmers       ┌────────────────────┐
                              ahead of beta users         ◀───│ search-proxy        │
                                                              │ /v1/athletes/search │
                                                              │ (apps/server/api)   │
                                                              └────────────────────┘
                                                                    │       ↑
                                                                    │       │
                                                          ┌─────────┴──┐    │
                                                          │ Postgres   │    │
                                                          │ first      │    │
                                                          │ (cached    │    │
                                                          │ matches)   │    │
                                                          └────────────┘    │
                                                                    │       │
                                                                    │  miss │
                                                                    └──────►│
                                                                  swimming.ca/?s=
                                                                   live fallback
```

### Path 1 — Search-proxy with on-demand ingest (read path)

`GET /v1/athletes/search?q=<name>` resolves in two stages:

1. **Local-first** — query the existing tsvector + pg_trgm index on `Athlete`. If we have ≥ 1 match, return them immediately.
2. **Live fallback** (only when local returns 0 high-confidence matches) — fetch `https://www.swimming.ca/?s=<query>` server-side, parse linked `/swimmer/<id>/` URLs, and return as search results. Each returned item is also persisted to `Athlete` as a stub (sncId + name only, `source = REMOTE_DISCOVERY`, `lastIndexedAt = null`) so subsequent searches are local-fast.

When the user *selects* a result (i.e. proceeds to onboard), the existing `athlete-detail-scrape` job fetches the full `/swimmer/<id>/` page and back-fills club, dobYear, gender, swims, PBs.

### Path 2 — Background warmer for priority clubs (write path)

Nightly job, scheduled inside the same 16:00–22:30 ET window with the same jitter from §5.2 of the original spec. For each priority club name (Club Warriors, Region of Waterloo, Guelph Gryphon, plus the WOSA-region P2 list), the warmer:

1. Hits `swimming.ca/?s=<club name>` (and one or two variants like `?s=<short name>`) to get linked swimmer URLs.
2. Optionally fetches each `/swimmer/<id>/` page and parses the full profile, upserting into `Athlete` with `source = CRAWLED` and `lastIndexedAt = now()`.

This pre-populates Felix's club and the meet-trial cohort so beta users get instant local search hits. Coverage outside priority clubs grows organically through Path 1's discovery side-effect.

### What dies

- `club-roster-crawl` (no per-club URL).
- `Club.crawlPriority` (no per-club fan-out — priority is now a hardcoded list of name strings on the warmer side).
- The "cycle every ~30 days" model (we're not crawling all 1500 Canadian clubs anymore).

### What survives unchanged

- The migration's Athlete additions, `pg_trgm` + `unaccent`, `tsvector` + GIN index (Task 1, already shipped).
- The window + jitter helpers (Task 2, already shipped).
- The sampled politeness delay in `politeFetch` (Task 3, already shipped).
- The JSONP `parseClubDirectory` parser + 415-club fixture (Task 4, already shipped). Used for one purpose: **normalizing the free-text club string from a swimmer page to a `Club.id`** so search results can include a stable club reference.

## New parser surface

Two parsers replace the original `parseClubRoster`:

- `parseSearchResults(html: string): { sncId: string; displayName: string; profileSlug: string }[]` — parses `swimming.ca/?s=<query>` result HTML, extracting linked `/swimmer/<id>/` URLs and the visible swimmer names. Per the live capture earlier in this work session, the search returns mixed result types; we filter to results whose href matches `^/swimmer/(\d+)/$` (numeric IDs only, skipping the curated WP-CPT slug pages).

- `parseSwimmerPage(html: string): ParsedSwimmer` — parses `/swimmer/<numeric-id>/` HTML to extract the structured data (club name, dobYear/age, gender, plus optionally swims/PBs). The page contains an embedded `print_r`-style data dump in the rendered HTML (verified during the pivot probe), making this tractable. **This may overlap with the existing `parseAthletePage`** — the implementer should compare and either extend that function or factor out a shared helper.

## Search service shape (revised)

Endpoint and response shape from §6 of the original spec are unchanged. The internal flow becomes:

```typescript
async function searchAthletes(args: { ... }): Promise<AthleteSearchResponse> {
  const local = await searchLocal(args);                        // tsvector + pg_trgm, as in v1
  if (local.results.length >= MIN_LOCAL_HITS) return local;     // MIN_LOCAL_HITS = 3 for v1

  const remote = await searchRemoteAndPersistStubs(args);       // hits swimming.ca/?s=, persists stubs
  return mergeAndRank(local, remote);                           // dedupe by sncId
}
```

`searchRemoteAndPersistStubs` honours the same `politeFetch` delay budget; rate-limit headers from Swimming Canada (we already saw 429s during probing) are respected via the existing exponential backoff.

## Beta seed (revised)

The "BETA_SEED" list from §5.7 of the original spec moves out of the `Club` table and into the warmer's hardcoded input. The list is the same names; the priority concept just becomes "this list runs every night, the rest don't run at all."

If/when we re-add per-PSO crawlers (Swim Ontario, etc.), priority comes back as a real concept.

## Migration follow-up

The `Club.crawlPriority` column from Task 1 becomes dead weight. A follow-up migration drops it. Not load-bearing for v1; can be deferred.

## Acceptance for v1

A first-time user types "Felix Bechtel". The endpoint returns sncId `5567334` either from local cache (after the priority warmer runs) or from the live-fallback proxy. Latency budget: < 1 s for local hits, < 5 s for live fallback (gated by Swimming Canada's response time + our politeness delay).

## Open questions

- **Does `swimming.ca/?s=<query>` paginate?** Probing showed 2 hits for "Felix Bechtel" — fits in one page. For broader queries (e.g. "Smith"), we may need to follow `&paged=N`. To be confirmed when implementing the search parser.
- **Does the WP search index every age-group swimmer?** Felix is in it (confirmed). Whether the long tail is too is a known unknown — coverage gaps surface only through user reports during beta.
- **Throttling.** We hit 429 within ~6 sequential probes during this pivot work. The sampled 1500–4000ms delay should keep us safely under the threshold, but the warmer should batch conservatively (one priority club per active day at most).
