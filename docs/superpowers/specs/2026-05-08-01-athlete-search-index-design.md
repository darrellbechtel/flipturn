# Athlete Search Index — Design Spec

**Date:** 2026-05-08
**Status:** Approved (brainstorm complete; ready for implementation plan)
**Scope:** Internal index of every Canadian competitive swimmer, with a name/club search API consumed by mobile onboarding
**Owner:** Darrell Bechtel
**Parent doc:** [`2026-05-04-01-flipturn-mvp-design.md`](./2026-05-04-01-flipturn-mvp-design.md)

---

## 1. Goal & success criterion

Let a parent onboard their swimmer by **typing the swimmer's name** instead of pasting an SNC athlete ID. Today onboarding requires a 7-digit `sncId` the user almost never has memorized — the wedge collapses at step one for new users.

This spec covers building an internal index of every registered Canadian swimmer (sourced from public Swimming Canada pages) and a search API that returns enough fields to disambiguate. The existing `athlete-detail-scrape` worker continues to handle full profile/PB ingestion the moment a user picks a result.

**Success criterion:** A first-time user can find their swimmer in ≤ 3 attempts using only the swimmer's name (with optional club filter), without ever needing the SNC ID. Median search latency < 200 ms p95.

## 2. Non-goals (deferred)

- International swimmers (FINA / non-SNC). Canada-only for v1.
- Pre-fetching swims/PBs for every indexed athlete. Onboard flow already does this on demand.
- Public (unauthenticated) search. Requires session like every other endpoint.
- Athlete identity-resolution / merging across data sources. The existing matcher non-goal in the parent spec still stands.
- Unsubscribe-from-index UX. Takedown is handled via Plan 6 Task 14's privacy/takedown page (a manual delete is acceptable for v1 volume).
- Auto-complete-as-you-type wired to the API. UI debounces and calls the same endpoint; the endpoint itself is just request/response.

## 3. High-level architecture

```
                                  evening cron (jittered)
                                          │
                                          ▼
┌──────────────────┐    enqueue   ┌────────────────────┐    HTTP   ┌──────────────────────┐
│  cron scheduler  │ ───────────▶ │  BullMQ queues     │ ────────▶ │ results.swimming.ca  │
│ apps/server/     │              │  • club-directory  │ politeFetch│  + findaclub.swim... │
│   workers        │              │  • club-roster     │           └──────────────────────┘
└──────────────────┘              └────────────────────┘
                                          │
                                          ▼ upsert
                                  ┌────────────────────┐
                                  │  Postgres          │
                                  │  • Club            │
                                  │  • Athlete (idx)   │
                                  └────────────────────┘
                                          ▲
                                          │ pg_trgm fuzzy match
┌──────────────────┐  GET /v1/athletes/search?q=...
│ apps/client/     │ ────────────▶ ┌────────────────────┐
│   mobile         │               │ apps/server/api    │
│ onboarding screen│               │ (Hono)             │
└──────────────────┘ ◀──────────── └────────────────────┘
                       results
```

No new processes. No new infra. The crawler is two BullMQ jobs running inside the existing `apps/server/workers` process; the search endpoint is a route in the existing `apps/server/api`. Reuses `politeFetch()`, Sentry, session middleware, and Prisma — all present today.

## 4. Data model (Prisma deltas)

### 4.1 New: `Club`

```prisma
model Club {
  id            String   @id              // SNC club ID, e.g. "ON-CW"
  name          String
  shortName     String?                   // "Club Warriors"
  province      String?                   // "ON"
  city          String?
  rosterUrl     String?                   // canonical roster page
  lastCrawledAt DateTime?
  crawlPriority Int      @default(0)      // higher = crawled sooner; see §5.7
  athletes      Athlete[]
  memberships   ClubMembership[]
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([province])
  @@index([name])
  @@index([crawlPriority, lastCrawledAt])  // composite for the scheduler's main query
}
```

### 4.2 Existing `Athlete` — additions

```prisma
model Athlete {
  // ... existing fields unchanged ...

  clubId         String?      // FK; nullable because athlete may exist before we've crawled their club
  club           Club?        @relation(fields: [clubId], references: [id])
  dobYear        Int?         // public pages expose year-only; full DOB stays in `dob` if/when we get it
  source         AthleteSource @default(USER_ONBOARDED)
  lastIndexedAt  DateTime?

  searchVector   Unsupported("tsvector")? @default(dbgenerated("to_tsvector('simple', unaccent(coalesce(\"primaryName\", '') || ' ' || coalesce(array_to_string(\"alternateNames\", ' '), '')))")) @ignore

  @@index([clubId])
  @@index([dobYear])
  @@index([searchVector], type: Gin)
}

enum AthleteSource {
  USER_ONBOARDED   // came in via /v1/athletes/onboard before the index existed
  CRAWLED          // discovered by club-roster-crawl
}
```

`searchVector` is a Postgres generated column (`tsvector` over `unaccent(primaryName + alternateNames)`) with a GIN index — fast prefix and full-token search. We additionally use `pg_trgm` on `primaryName` for fuzzy match (handles typos like "Felx Bechtel"); this needs `CREATE EXTENSION pg_trgm` and `CREATE EXTENSION unaccent` in the migration.

### 4.3 `ClubMembership` — unchanged

Already in schema; gets populated by `athlete-detail-scrape` when a user actually onboards an athlete (we don't pre-fetch history during indexing).

### 4.4 `sncId` collision handling

`Athlete.sncId @unique` is already enforced. The crawl upsert is keyed on `sncId` — if a user-onboarded record already exists, the crawler updates `clubId`, `dobYear`, `lastIndexedAt`, and flips `source` to `CRAWLED` only if it was previously `USER_ONBOARDED` *and* the crawl found the same `primaryName` (sanity guard).

## 5. Ingestion pipeline

### 5.1 Three jobs, all in `apps/server/workers`

| Job                    | Cadence (see §5.2)                                       | Input        | Output                                | Politeness                                                        |
| ---------------------- | -------------------------------------------------------- | ------------ | ------------------------------------- | ----------------------------------------------------------------- |
| `club-directory-crawl` | weekly, random weekday Mon–Fri, evening window (ET)      | none         | upserts `Club` rows                   | 1.5–4 s between fetches (uniform random), retry w/ backoff        |
| `club-roster-crawl`    | per-day fan-out, randomized evening fire times (ET)      | `clubId`     | upserts `Athlete` rows for that club  | 1.5–4 s between fetches, exponential backoff on 403 / 5xx         |
| `athlete-detail-scrape`| on demand (existing)                                     | `sncId`      | swims + PBs (unchanged)               | unchanged                                                         |

### 5.2 Scheduling policy: look like a swim parent, not a bot

A weekday crawl that fires at 03:00 with metronomic 1-req/sec spacing is a textbook bot signature. We instead schedule everything inside the hours when a real swim parent would naturally be checking results, and we add jitter at three layers so two consecutive runs never look identical.

**Active window.** All scheduled crawl jobs fire only between **16:00 and 22:30 America/Toronto**. This is when parents legitimately browse `results.swimming.ca` after school pickup / dinner. Outside that window the scheduler refuses to enqueue (manual ad-hoc runs from an admin endpoint can ignore the window).

**Three layers of jitter:**

1. **Day-of-week jitter** — `club-directory-crawl` picks a weekday Mon–Fri uniformly at random each week (no Sun 03:00 stamp). Skipped if the chosen weekday is a Canadian statutory holiday (cheap lookup table; the dataset doesn't change on holidays anyway).
2. **Time-of-day jitter** — each scheduled run draws its fire time from a triangular distribution peaked at **19:30 ET** with the 16:00–22:30 window as the support. Recomputed every day; never enqueued more than 24 h in advance.
3. **Per-request jitter** — `politeFetch()` already serializes; we change its inter-request delay from a fixed 1 s to **uniform random 1500–4000 ms**, with an additional 0–800 ms "read pause" injected on roughly 1 in 5 requests (mimics a human pausing on a result). Plus an existing exponential backoff on 403/429/5xx.

**Fan-out strategy.** Each crawl day the scheduler picks ⌈ totalClubs / 30 ⌉ clubs ordered by `crawlPriority DESC, lastCrawledAt ASC NULLS FIRST` (priority first, then oldest). It **shuffles** that batch and assigns each club a per-job delay drawn from a uniform distribution across the day's active window. Result: ~1500 Canadian clubs ÷ 30 ≈ 50 club roster fetches per active day, spread organically across ~6.5 hours, ~ 1 fetch every 8 minutes — well below any rate that would look automated, and the full dataset still cycles roughly monthly. Priority clubs (§5.7) effectively jump the queue on day 1 and stay fresher than national average thereafter.

**No spike on resume.** When the scheduler skips a day (holiday, downtime, the window passes without a chance to enqueue), the next active day's batch grows by at most 50% — never doubles. Better to extend the refresh cycle than to look like a backlog drain.

**User-Agent and transparency posture** are recorded in [ADR 0007](../../adr/0007-crawler-ua-policy.md), which supersedes the original "transparent identifiable UA" stance after the WAF blocked it during smoke testing.

### 5.3 Source pages & parsers

Two new HTML parsers in `apps/server/workers/src/parsers/` mirroring the existing `parseAthletePage()`:

- `parseClubDirectory(html)` — input: `https://findaclub.swimming.ca/`. Output: `{ id, name, province, city, rosterUrl }[]`.
- `parseClubRoster(html)` — input: each club's roster page on `results.swimming.ca`. Output: `{ sncId, primaryName, alternateNames, dobYear, gender, clubId }[]`.

Both reuse the existing `politeFetch()` wrapper. Parsing is pure (testable with HTML fixtures); fetch is injected for testing.

### 5.4 Idempotency

All three jobs are idempotent: same inputs → same DB state. Re-running a job is safe and has no side effects beyond updating `lastCrawledAt` / `lastIndexedAt`. Required for the BullMQ retry semantics already in place.

### 5.5 Failure handling

- HTTP 403 / Cloudflare challenge → retry with backoff up to 5 attempts, then mark the job failed and Sentry-alert. Plan 6 Task 13 already tracks the "swimming.ca starts blocking us" concern; this work inherits whatever resolution lands there (residential proxy, scraping-as-a-service swap-in, etc.). Architecturally, swapping `politeFetch()` is the only change needed.
- Parser miss (page layout changed) → throw a typed `ParserMismatchError`; the worker fails the job, increments a Sentry tag, and a dashboard alert fires. We do not silently degrade.

### 5.6 Bootstrap order

The first time the system runs, both jobs need to fire once before the regular fan-out begins:

1. Manual one-shot of `club-directory-crawl` (admin endpoint, ignores window). Populates ~ 1500 `Club` rows with default `crawlPriority = 0`.
2. Run the **beta priority seed** (§5.7) — a small idempotent script that bumps `crawlPriority` for the trial clubs by name match (e.g. `name ILIKE 'Club Warriors%'`).
3. Manual one-shot of `club-roster-crawl` for **just the priority clubs**, so the closed-beta has a usable index on day one without waiting a month.
4. Enable the regular jittered scheduler. From here on the priority clubs are refreshed first each cycle.

### 5.7 Beta priority seed (Waterloo region → Windsor Regionals)

Goal: closed-beta users in the Waterloo area can search the swimmers they actually care about on day one, and the index is dense for **WOSA Regionals in Windsor (early June 2026 — exact date TBC at seed-script time from the meet schedule)** by the time those entries are finalized.

Two priority tiers, applied as `crawlPriority` deltas on top of the default `0`:

| Priority | crawlPriority | Clubs                                                                                                                                 | Why                                                              |
| -------- | ------------: | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **P1**   |          1000 | Club Warriors (Waterloo); Region of Waterloo Swim Club (ROW); Guelph Gryphon Aquatic Club¹                                            | Owner's home clubs — first beta swimmers + manual QA target      |
| **P2**   |           500 | Other WOSA-region clubs likely at Windsor Regionals: Windsor Aquatic Club, Sarnia Rapids, London Aquatic, Cambridge Aquatic Jets, Brantford, Burlington, Oakville Aquatic, Etobicoke Pepsi, Mississauga Aquatic, North York AC | Beta users will be entering & spectating these clubs at the trial meet |
| default  |             0 | Everyone else (national rotation)                                                                                                     | Standard refresh cadence                                          |

**Geographic spread after priorities**: once P1 + P2 are caught up, the default `lastCrawledAt ASC` ordering naturally distributes geographically (clubs are interleaved across provinces in `Club.id` and creation time, and the per-day shuffle prevents same-province batches). No additional logic needed.

¹ The exact SNC club name for "Guelph Gryphon" should be confirmed during seed-script runtime — the local clubs in Guelph include Guelph Marlin Aquatic Club (GMAC) and the U of Guelph–affiliated program. The seed script (next paragraph) prompts on ambiguity rather than guessing.

**Resolution**: club name → `Club.id` is done at seed-script runtime via `ILIKE` matching (case-insensitive partial match) against the directory we just crawled. Ambiguous matches require manual confirmation in the script (one prompt per ambiguity); we don't trust pure fuzzy match for priority-list assignment.

**Lifecycle**: priorities are persistent. After closed beta we can either decay them (e.g. P1 → 100, P2 → 50) or drop them entirely; the spec doesn't bake in a sunset because beta endpoint is itself fuzzy.

## 6. Search API

### 6.1 Endpoint

```
GET /v1/athletes/search
  ?q=<string>            # required, ≥ 2 chars after trim
  &clubId=<string>       # optional, exact
  &province=<2-char>     # optional, exact (uppercase)
  &limit=<int>           # optional, default 20, max 50

Auth:    session middleware (existing)
Rate:    50 req/min per session (Redis token bucket; reuses existing limiter)
```

### 6.2 Response

```ts
type AthleteSearchResult = {
  sncId: string;
  displayName: string;          // primaryName
  alternateNames: string[];
  dobYear: number | null;
  gender: 'M' | 'F' | 'X' | null;
  club: { id: string; name: string; province: string | null } | null;
  hasFlipturnProfile: boolean;  // true if a Flipturn user has already onboarded this athlete
  alreadyLinkedToMe: boolean;   // true if the *current* user has this athlete linked
};

type Response = { results: AthleteSearchResult[]; total: number };
```

### 6.3 Ranking

1. Exact `primaryName` match (case-insensitive, unaccented)
2. `tsvector @@ tsquery` rank from `searchVector`
3. `similarity(primaryName, q)` from `pg_trgm` (threshold 0.3)
4. Tiebreak: `clubId == filter.clubId` first, then alphabetical

`alreadyLinkedToMe` lets the mobile UI grey-out duplicates without a second round-trip.

### 6.4 Implementation note

Single Postgres query using `to_tsquery(simple, unaccent($1))` + `pg_trgm` similarity, joined to `Club`, plus a `LEFT JOIN UserAthlete ON athlete_id = $userId`. ~ 30 lines of raw SQL via `Prisma.$queryRaw` (Prisma's ORM-level FTS support is too limited for this combo). Lives in `apps/server/api/src/services/athleteSearch.ts`.

## 7. Onboarding UX change

### 7.1 API

`POST /v1/athletes/onboard` already accepts `{ sncId }`. **No change.** The mobile screen now obtains the `sncId` via search instead of asking the user to type it.

A power-user path remains: a "Have an SNC ID?" link reveals the manual-entry field for users who already know it (e.g., parents migrating data).

### 7.2 Mobile flow

```
[Onboard a swimmer]
┌───────────────────────────────────────┐
│ Swimmer name: [ Felix Bechtel______ ] │
│ Club (optional): [ Club Warriors ▼ ]  │
│                                       │
│ ┌───────────────────────────────────┐ │
│ │ Felix Bechtel  · Club Warriors    │ │ ← tap → POST /onboard
│ │ b.2014 · ON                       │ │
│ ├───────────────────────────────────┤ │
│ │ Felix Bechtel  · Etobicoke Pep    │ │   (if multiple)
│ │ b.2010 · ON                       │ │
│ └───────────────────────────────────┘ │
│                                       │
│ [ Have an SNC ID? Enter manually ]    │
└───────────────────────────────────────┘
```

Debounce 250 ms. On tap, send `sncId` to existing `/v1/athletes/onboard`, which enqueues the existing `athlete-detail-scrape` job. No mobile state machine changes beyond the search field.

## 8. Operational concerns

### 8.1 Legal / takedown

Swimming Canada publishes meet results and club rosters publicly. We mirror only data they already publish, link back to source URLs in the athlete profile (already happens via the existing scraper), and add `/legal/takedown` (covered by Plan 6 Task 14 — extending its scope to this dataset is a one-paragraph addition).

`robots.txt` for `results.swimming.ca` and `findaclub.swimming.ca` is checked at parser-test time; if they ever disallow our paths, the crawler refuses to enqueue.

### 8.2 Crawl budget

- `club-directory-crawl`: 1 page/week.
- `club-roster-crawl`: ~ 50 pages/active day, spread across the 16:00–22:30 ET window.
- `athlete-detail-scrape`: unchanged (per-onboard, plus existing periodic refresh).

Total new outbound traffic: trivial.

### 8.3 Storage

- `Club`: ~ 1500 rows × ~ 200 B ≈ 300 KB.
- `Athlete` index rows: ~ 100k rows × ~ 500 B ≈ 50 MB.
- `tsvector` GIN index: ~ 20 MB.
- `pg_trgm` GIN index on `primaryName`: ~ 10 MB.

Total: ~ 100 MB. Fits the existing Mac Mini Postgres comfortably.

### 8.4 Privacy posture

`dobYear` only — never full DOB from indexing (the existing scraper might capture full DOB from a profile if available, that path is unchanged). `gender` is what the source publishes, stored as-is. No emails, no contact info. The index does not store anything not already public on `results.swimming.ca` and `findaclub.swimming.ca`.

### 8.5 Observability

- Sentry: existing wiring covers worker errors and API errors automatically.
- Custom metric: `index.athletes.total`, `index.clubs.total`, `crawl.club_roster.duration_ms` (via Sentry tags or a simple `/v1/admin/index-stats` endpoint).
- Dashboards: a single admin page (auth-gated) showing last crawl per club + total counts is enough for v1.

## 9. Testing strategy

| Test type        | Coverage                                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| Unit (parsers)   | `parseClubDirectory` / `parseClubRoster` against checked-in HTML fixtures (golden files)                         |
| Unit (services)  | `athleteSearch` ranking against a seeded fixture DB (~ 200 athletes, 5 clubs, deliberate name collisions)        |
| Unit (scheduler) | Jitter functions: 1000 sampled fire times all land in 16:00–22:30 ET; weekday picker rejects holidays and Sat/Sun; consecutive runs differ; per-request delay distribution mean is 2.5–3.0 s with a non-zero stdev |
| Integration      | API: `GET /v1/athletes/search` with auth, rate-limit, pagination, empty results, fuzzy hit                       |
| Integration      | Worker: `club-roster-crawl` end-to-end against a fake `politeFetch` returning fixture HTML, asserting upserts    |
| E2E (manual)     | Onboarding from mobile dev build: search → pick → see profile populated within 60s                               |

Add to existing `pnpm api:test` and `pnpm workers:test`. Target: maintain the existing 143+ test count + ~ 25 new tests.

## 10. Open questions / decisions deferred

- **Sub-second autocomplete**: not a goal for v1. If onboarding adoption shows users typing fast, we can add a `/v1/athletes/search/suggest` lightweight endpoint later.
- **Swimrankings.net cross-link**: nice-to-have for international comparisons; out of scope per §2.
- **Index seeding shortcut**: we could speed up the initial bulk crawl by parallelizing; deferred until we know whether ~ 30 days of jittered evening fan-out is fast enough for v1.
- **Multi-region clubs**: a few clubs operate in multiple provinces. The model treats `province` as singular on `Club`. Acceptable trade-off; revisit only if a user reports it.

## 11. Rollout

Anchored to the **WOSA Regionals in Windsor (early June 2026, exact date TBC)** trial target — the index needs to be dense for those clubs by the time start-list entries are finalized (typically 7–10 days before the meet). Confirm the meet date against the Swim Ontario / Windsor host-club schedule during step 3 below.

1. Land schema migration + extensions (pg_trgm, unaccent) on closed-beta DB. (No-op for users.)
2. Land parsers + jobs behind a feature flag (`INDEX_CRAWL_ENABLED`). Run `club-directory-crawl` once manually; verify ~ 1500 clubs ingested.
3. **Run the beta priority seed (§5.7)**. Confirm Club Warriors, ROW, and GMAC each got `crawlPriority = 1000` and the WOSA-region P2 list got `500`. Spot-check ambiguous matches by hand.
4. Manually fire `club-roster-crawl` for **all P1 + P2 clubs** in one go (admin endpoint, bypasses the window). ~ 13 clubs × 1 page each ≈ < 1 minute of fetch. Index is now usable for the trial cohort.
5. Search Felix Bechtel by name; confirm the result links to the correct `sncId`. Search a swimmer from each P2 club; confirm hits.
6. Land `/v1/athletes/search` endpoint + tests.
7. Ship mobile onboarding swap behind a remote-config flag; keep the manual-sncId path as fallback.
8. Enable the jittered evening fan-out scheduler. Watch Sentry for parser breakage and 403s for one week, and verify in logs that fire times actually land inside 16:00–22:30 ET with non-uniform spacing.
9. Flip the mobile remote-config flag for closed-beta users once Felix and one swimmer per P2 club resolve cleanly end-to-end.
10. **Pre-Regionals freshness check** (7–10 days before the confirmed meet date): re-run `club-roster-crawl` for the WOSA P1+P2 list to catch any last-minute new registrations / club changes ahead of the meet entries.

## 12. Out-of-scope reminders

This spec deliberately does not solve identity resolution across multiple sources, time-standard tracking, or push notifications. Each gets its own brainstorm and design spec when its time comes — same as the parent MVP design.
