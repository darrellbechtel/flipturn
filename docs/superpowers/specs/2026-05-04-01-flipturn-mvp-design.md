# Flip Turn MVP — Design Spec

**Date:** 2026-05-04
**Status:** Approved (brainstorm complete; ready for implementation plan)
**Scope:** Closed-beta thin-slice MVP
**Owner:** Darrell Bechtel
**Parent doc:** [`PROJECT_BRIEF.md`](../../../PROJECT_BRIEF.md)

---

## 1. Goal & success criterion

Ship a closed-beta thin-slice MVP that lets a parent log in, register their kid by Swimming Canada (SNC) athlete ID, and see the kid's swim history plus per-event/course personal-best progression — pulled and kept fresh from `results.swimming.ca`.

**Success criterion (MVP):** 10–20 hand-recruited swim parents install the app, complete onboarding, and open it at least once a week for four consecutive weeks.

The brief's monetization criterion (50 paying parents at CA$8/mo within 6 months) belongs to a later milestone; MVP is unpaid validation of the wedge.

## 2. Non-goals (deferred to follow-up specs)

Each item below gets its own brainstorm and design spec when its time comes:

- Push notifications (PB alerts, Expo push tokens, BullMQ-driven dispatch)
- Time-standard tracking (AAA / Provincial / National progress bars)
- Multi-meet split analysis
- Identity resolution / probabilistic athlete matcher
- SDIF parser (`packages/sdif-parser`) + Tier 3 host-club `.hy3` ingestion
- Tier 1 live results (TouchPadLive, SwimPhone, Swimnerd Live)
- AI features (Anthropic SDK race recaps, etc.)
- Classical ML / Python sidecar
- Family dashboard view (multi-athlete side-by-side)
- Monetization (Stripe subscriptions + paywall)
- App Store / Play Store launch

Architectural choices below are made _with_ these futures in mind so we don't have to retrofit when they arrive.

## 3. High-level architecture

```
┌─────────────────────┐         ┌──────────────────────────────────────┐
│  apps/mobile (Expo) │ ──HTTPS─▶│  Cloudflare Tunnel ─▶ Mac Mini M4    │
│  iOS + Android      │          │  ┌────────────────────────────────┐ │
│  TestFlight / Expo  │◀──────── │  │ pm2 supervises:                │ │
│  internal links     │  JSON    │  │  • apps/api (Hono)             │ │
└─────────────────────┘          │  │  • apps/workers (BullMQ)       │ │
                                 │  │ docker compose:                │ │
                                 │  │  • postgres                    │ │
                                 │  │  • redis                       │ │
                                 │  └────────────────────────────────┘ │
                                 │           │                          │
                                 │           ▼ scheduled daily          │
                                 │       results.swimming.ca            │
                                 └──────────────────────────────────────┘
```

**Process model on the Mac Mini:**

| Process        | Source         | Role                                                       |
| -------------- | -------------- | ---------------------------------------------------------- |
| `postgres`     | docker compose | Primary datastore                                          |
| `redis`        | docker compose | BullMQ backing + token-bucket rate limiter + session cache |
| `apps/api`     | pm2            | Hono HTTP server behind Cloudflare Tunnel                  |
| `apps/workers` | pm2            | BullMQ worker process running scrape jobs                  |

**Public ingress:** Cloudflare Tunnel (free, stable, no NAT/dynamic-DNS work). Documented in `docs/adr/0001-mvp-hosting.md`.

## 4. Monorepo layout

pnpm workspace:

```
flipturn/
├── apps/
│   ├── api/          # Hono + magic-link auth + REST endpoints
│   ├── mobile/       # Expo (TypeScript, expo-router)
│   └── workers/      # BullMQ workers; canonical-archive scrape job
├── packages/
│   ├── db/           # Prisma schema, migrations, generated client
│   └── shared/       # zod schemas, time formatting, eventKey, constants
├── docs/
│   ├── adr/                       # Architecture Decision Records
│   └── superpowers/specs/         # Design specs (this doc lives here)
├── PROJECT_BRIEF.md
├── README.md
├── pnpm-workspace.yaml
├── package.json
└── tsconfig.base.json
```

**Why `packages/shared` is added vs. the brief:** the API and mobile both need to format swim times (e.g. `5732` → `"57.32"`) and build `eventKey` strings (e.g. `"100_FR_LCM"`) identically. A shared package prevents drift. Cost: low; benefit: structural.

**Why `packages/sdif-parser` is omitted from MVP:** Tier 4 (`results.swimming.ca`) does not require SDIF parsing. The parser comes back when Tier 3 host-club `.hy3` ingestion is in scope.

## 5. Data model

The schema is the heart of MVP. Designed to satisfy the brief's normalized model while keeping MVP write paths trivial. Fields tagged **(deferred-use)** are written but unused in MVP queries; they cost ~nothing and avoid migrations later.

### 5.1 Entity reference

| Model            | Purpose                            | Notes                                                                                                                                                                              |
| ---------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `User`           | Magic-link account                 | `email @unique`, timestamps; no profile data                                                                                                                                       |
| `MagicLinkToken` | Auth token                         | Stores **hash** of token (sha256), not plaintext; single-use; 15-min expiry                                                                                                        |
| `Session`        | Issued session                     | Long-lived in MVP; refresh logic deferred                                                                                                                                          |
| `Athlete`        | A swimmer                          | `sncId @unique` (mandatory in MVP); `alternateNames String[]` reserved for future matcher; `dob` storable as year-only per privacy posture                                         |
| `UserAthlete`    | Many-to-many user↔athlete          | Composite PK; `relationship` enum (default `PARENT`)                                                                                                                               |
| `ClubMembership` | Club history                       | Separate table with start/end dates so an athlete can have prior clubs                                                                                                             |
| `Meet`           | Competition                        | `externalId @unique` for SNC meet ID; `course` enum (SCM/LCM/SCY)                                                                                                                  |
| `Event`          | Race within a meet                 | `(meetId, distanceM, stroke, gender, ageBand, round)`                                                                                                                              |
| `Swim`           | One race result                    | `timeCentiseconds Int`, `splits Int[]`, denormalized `eventKey` (e.g. `"100_FR_LCM"`); **(deferred-use:** `supersedesId`, `isCurrent`, `dataSource`, `sourceUrl`, `scrapedAt`**)** |
| `PersonalBest`   | Per-athlete-per-event current best | Denormalized cache, `@@unique([athleteId, eventKey])`; recomputed by worker after each scrape                                                                                      |

### 5.2 Three load-bearing design calls

1. **`eventKey` denormalized on every swim.** Format: `<distance>_<stroke>_<course>` (e.g. `"100_FR_LCM"`). PB lookups index `(athleteId, eventKey)` directly, avoiding a 2-hop join through `Event` → `Meet`. Cost: one derived field that must be kept correct (computed in `packages/shared`). Benefit: the only hot read path on mobile is fast.

2. **`supersedesId` + `isCurrent` from day 1.** MVP only writes one source, so these fields are unused in MVP queries. When Tier 3 lands, we don't migrate — we just start writing additional `Swim` rows with `supersedesId` set and toggle `isCurrent`. Cost: 2 columns + 1 index.

3. **`PersonalBest` as a real table, not a view.** A view would be more correct (single source of truth = `Swim` rows), but a cached table simplifies the read path and gives us a clean "PB changed" hook for notifications later. Recomputed by the scrape worker inside the same DB transaction as swim upserts. (Project preference: avoid views unless there's a measurable performance need.)

### 5.3 Idempotency

Re-scraping the same athlete must not duplicate swims. Each `Swim` is uniquely identified by `(athleteId, meetId, eventId)` — `Event` already uniquely identifies a (distance, stroke, gender, ageBand, round) within a meet (see `Event`'s own `@@unique`), so this tuple is the canonical row identity.

```prisma
// On Swim:
@@unique([athleteId, meetId, eventId])
```

The worker's reconcile step uses Prisma's `upsert` keyed on this tuple.

**Future relaxation (Tier 3 multi-source):** When we start writing multiple versions of the same swim from different sources, this constraint is dropped and replaced by a Postgres _partial unique index_ enforcing one `isCurrent=true` row per `(athleteId, meetId, eventId)`:

```sql
CREATE UNIQUE INDEX swim_current_idx
  ON "Swim" ("athleteId", "meetId", "eventId")
  WHERE "isCurrent" = true;
```

Prisma doesn't model partial unique indexes natively; this becomes a hand-written migration when the time comes. MVP doesn't need it because MVP only writes one source.

### 5.4 Schema (Prisma)

Authoritative file lives at `packages/db/prisma/schema.prisma`. The full file is reproduced in **Appendix A**.

## 6. Scraper / worker design

> **Spike outcome (post-Plan 2):** See [ADR 0002 — SNC data source](../../adr/0002-snc-data-source.md) for the full investigation, the cheerio-on-static-HTML decision, and observed Cloudflare WAF behavior. Two source hosts in scope: `www.swimming.ca/swimmer/<id>/` (athlete pages) and `results.swimming.ca/<meet_slug>/` (SPLASH meet index). Cloudflare 429s observed at ~3 req/s — the 1 req/5s default in §6.3 has 12× headroom.

### 6.1 The spike (first thing built)

Before any worker code, a small investigation:

1. Fetch `results.swimming.ca` athlete and meet pages. Capture raw responses.
2. Document what the source exposes: HTML pages? JSON endpoints? Downloadable CSV/`.hy3`? What's in `robots.txt`? Any documented rate limits?
3. Pick one real beta athlete (the founder's kid) as a fixture. Save raw artifact at `apps/workers/fixtures/snc-athlete-<id>.html` (or `.json`) and a hand-extracted `snc-athlete-<id>.expected.json`.
4. Output: `docs/adr/0002-snc-data-source.md` capturing what's available and which fetch approach is chosen (cheerio for HTML, native fetch for JSON, or — flag for re-scoping if needed — Playwright for JS-rendered pages).

The spike's outcome usually only changes the **fetch layer** — the rest of the worker architecture below is fetch-shape-agnostic. **However**, if the source requires JavaScript rendering (single-page-app architecture, dynamic content), Playwright would be needed, which adds a Chromium dependency, container/headless infrastructure, and ~10× the per-fetch resource cost. That is a real MVP-scope risk: if the spike turns up a JS-rendered source, pause and reconsider scope (e.g. defer scraping in favor of a manual-import path) rather than absorb the cost into MVP.

### 6.2 Worker architecture

```
BullMQ queue: scrape-athlete
  ┌─ producer: cron job every 24h enqueues one job per registered athlete
  └─ producer: onboarding flow enqueues immediate backfill job
       ↓
  worker (apps/workers, separate Node process, supervised by pm2):
    1. Acquire per-host token bucket (Redis): max 1 req / 5s to results.swimming.ca
    2. Fetch athlete page
    3. Archive raw response: ./data/raw/snc/{sncId}/{ISO8601}.{ext}  (local disk; in .gitignore)
    4. Parse → list of normalized SwimRecord (typed in packages/shared)
    5. Reconcile against DB (idempotent upsert keyed on the tuple in §5.3)
    6. Recompute affected PersonalBest rows (same DB transaction)
    7. Update Athlete.lastScrapedAt
```

### 6.3 Politeness (hard-coded)

- `User-Agent: FlipTurnBot/0.1 (+https://flipturn.ca/bot; contact@flipturn.ca)`
- Token bucket in Redis: 1 req / 5s per host
- Daily per-host budget cap (initial: 500 req/day) — fail closed if exceeded, alert via Sentry
- Honor `robots.txt`: fetch and cache once per day; respect Disallow paths
- `If-Modified-Since` / `ETag` if the server supports either

### 6.4 Failure handling

- BullMQ exponential backoff, max 3 retries
- After max retries: dead-letter queue + Sentry alert (no silent failures)
- Worker emits a heartbeat key in Redis every 60s; stale heartbeat triggers Sentry alert

### 6.5 What we explicitly defer

- Per-meet bulk scraping (walk meet list, ingest all athletes)
- Tier 1, 2, 3 sources
- Smart change detection (MVP does full re-scrape per athlete daily)
- S3 raw archive (local disk in MVP; S3 is v1.1)

## 7. API surface

All endpoints under `https://api.flipturn.ca/v1` (placeholder; final domain registration is an open item). Auth required on everything except `/auth/magic-link/*`, `/health`, and `/legal/*`.

```
# Auth
POST   /auth/magic-link/request   { email }                      → 202
POST   /auth/magic-link/consume   { token }                      → { sessionToken }
GET    /auth/me                                                  → { user, athletes }

# Athletes (onboarding & switching)
POST   /athletes/onboard          { sncId, relationship? }       → { athlete }
GET    /athletes                                                 → [ ...athletes ]
DELETE /user-athletes/:id                                        → 204

# Data views
GET    /athletes/:id/swims?eventKey=&limit=&cursor=             → paginated
GET    /athletes/:id/personal-bests                              → [ { eventKey, swim, achievedAt } ]
GET    /athletes/:id/progression?eventKey=                       → [ { date, timeCentiseconds, meetName } ]

# Ops
GET    /health                                                   → { db, redis }
DELETE /me                                                       → 204  (PIPEDA right-to-delete)
```

Authorization: `Authorization: Bearer <sessionToken>`. Sessions are long-lived in MVP (no expiry); rotation logic is a v1.1 concern.

Request/response shapes are defined as zod schemas in `packages/shared` and used both server-side (validation) and client-side (parsing/typing).

## 8. Mobile surface

Five screens cover MVP:

1. **Email entry** — single field, "Send me a link"
2. **Magic-link landing** — opened from the email deep link (`flipturn://auth?token=...`); consumes token, stores session in `expo-secure-store`, navigates to onboarding or home
3. **Onboarding** — SNC athlete ID input, calls `/athletes/onboard`, polls `/athletes/:id/swims` until first results land (typical ≤ 60s after backfill enqueue)
4. **Home** — athlete switcher (top), PB list grouped by stroke
5. **Event detail** — progression chart (line chart of times over time) + paginated swim history filtered by `eventKey`

Stack: Expo SDK + `expo-router` + `expo-linking` + `expo-secure-store`. Charts via `victory-native` or `react-native-svg-charts` (decide during build; both are workable).

## 9. Auth flow

```
1. Mobile: user enters email → POST /auth/magic-link/request
2. API:    generate 32 random bytes → token (plaintext) + tokenHash (sha256)
           insert MagicLinkToken { tokenHash, userId, expiresAt: now+15min }
           email user via Resend with deep link flipturn://auth?token=<plaintext>
3. User:   taps link in email → mobile opens via deep-link handler
4. Mobile: POST /auth/magic-link/consume { token }
5. API:    sha256(token) → look up MagicLinkToken row, check expiresAt + consumedAt is null
           mark consumedAt = now, issue Session row, return { sessionToken }
6. Mobile: store sessionToken in expo-secure-store
7. All subsequent requests: Authorization: Bearer <sessionToken>
```

No passwords, no recovery flow — losing access means starting over with a new magic link.

## 10. Operational concerns

### 10.1 Errors & observability

- Sentry on `apps/api`, `apps/workers`, and `apps/mobile`
- `pino` structured logging → stdout → captured by `pm2 logs`
- `/health` endpoint pings Postgres + Redis
- Worker heartbeat key in Redis with 60s TTL; staleness triggers Sentry alert

### 10.2 Testing strategy (proportional to MVP)

| Package           | Strategy                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db`     | Migrations apply cleanly against a fresh Postgres (CI script)                                                                   |
| `packages/shared` | Unit tests for `formatSwimTime`, `parseSwimTime`, `eventKey` builder                                                            |
| `apps/workers`    | Integration tests using saved spike fixtures (raw HTML/JSON → expected normalized records); high coverage because parsers break |
| `apps/api`        | Integration tests against a Dockerized Postgres (`@testcontainers/postgresql`)                                                  |
| `apps/mobile`     | Manual QA only in closed beta — no Detox/Maestro                                                                                |

### 10.3 Privacy & legal (per brief)

- PIPEDA-compliant privacy policy live before any beta user installs
- `DELETE /me` endpoint (right to deletion); deletes user, sessions, and `UserAthlete` rows. Athlete records are _not_ deleted — they're shared facts pulled from public records and may be linked by other beta users.
- DOB defaults to year-only storage; full DOB only requested if a future feature demands precision (matcher, etc. — not in MVP)
- Source attribution shown on every swim ("From results.swimming.ca, scraped <date>")
- Public takedown form at `/legal/takedown` (static page); deletion fulfilled within 7 days
- TOS + privacy URLs surfaced in mobile Settings

### 10.4 Data retention

- Raw scrape artifacts in `./data/raw/`: kept indefinitely in MVP (single Mac Mini disk; reconsider when storage approaches a GB)
- Sessions: long-lived; revoked on `DELETE /me` or manual ops
- Magic-link tokens: hard-deleted 24h after expiry via daily cron in worker

## 11. Build order & milestones

Mirrors the brief, with `packages/shared` inserted and the spike scoped explicitly:

| Step | Deliverable                                                                                           | Milestone gate                              |
| ---- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 0    | Monorepo skeleton (pnpm workspace, tsconfig, ESLint/Prettier)                                         | `pnpm install` works at root                |
| 1    | `packages/db` — Prisma schema + first migration + seed                                                | Migration applies to a fresh Postgres       |
| 2    | `packages/shared` — time format, eventKey, zod schemas                                                | Unit tests green                            |
| 3    | **Spike**: investigate `results.swimming.ca`, save fixtures, write `docs/adr/0002-snc-data-source.md` | ADR merged                                  |
| 4    | `apps/workers` — fetcher → parser → reconciler → BullMQ wiring                                        | One real athlete's history end-to-end in DB |
| 5    | `apps/api` — magic-link auth + Resend → athletes endpoints → swim/PB/progression endpoints            | Postman/curl smoke pass                     |
| 6    | `apps/mobile` — auth → onboarding → home → event detail                                               | Founder uses it for own kid daily           |
| 7    | Cloudflare Tunnel + pm2 + docker compose hardening; Sentry wired                                      | Public URL responds; outages alert          |
| 8    | Closed-beta distribution — TestFlight + Expo internal links; recruit 10–20 parents                    | First beta user onboards successfully       |

Estimated calendar: **8–12 weeks** of evening/weekend work, given Darrell's day-job + multi-agent R&D bandwidth.

## 12. Open questions (kept open, not blocking)

- Final FlipTurn domain registration — `flipturn.ca` referenced as placeholder in scrape `User-Agent`
- Email sender domain for Resend — likely a subdomain of the above
- Chart library for `apps/mobile` — `victory-native` vs `react-native-svg-charts`; decide at step 6
- Whether to bring `packages/sdif-parser` forward as an OSS release before Tier 3 ingestion is in scope (brief lists this as desirable but not v1)
- Exact Cloudflare Tunnel auth model (token-per-tunnel vs zero-trust)

## 13. ADRs to write

- `0001-mvp-hosting.md` — Mac Mini + docker compose + pm2 + Cloudflare Tunnel; alternatives considered (Fly.io free tier, Railway)
- `0002-snc-data-source.md` — outcome of the spike
- `0003-magic-link-auth.md` — auth approach decision
- `0004-pb-as-cached-table.md` — why a denormalized table beat a view (links project preference)

---

## Appendix A — Full Prisma schema

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── Auth ────────────────────────────────────────────────────────────────

model User {
  id         String           @id @default(cuid())
  email      String           @unique
  createdAt  DateTime         @default(now())
  updatedAt  DateTime         @updatedAt
  magicLinks MagicLinkToken[]
  sessions   Session[]
  athletes   UserAthlete[]
}

model MagicLinkToken {
  id         String    @id @default(cuid())
  userId     String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash  String    @unique
  expiresAt  DateTime
  consumedAt DateTime?
  createdAt  DateTime  @default(now())

  @@index([userId])
  @@index([expiresAt])
}

model Session {
  id           String    @id @default(cuid())
  userId       String
  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash    String    @unique
  createdAt    DateTime  @default(now())
  lastUsedAt   DateTime  @default(now())
  revokedAt    DateTime?

  @@index([userId])
}

// ─── People ──────────────────────────────────────────────────────────────

model Athlete {
  id             String           @id @default(cuid())
  sncId          String           @unique
  primaryName    String
  alternateNames String[]
  dob            DateTime?
  gender         Gender?
  homeClub       String?
  clubHistory    ClubMembership[]
  swims          Swim[]
  personalBests  PersonalBest[]
  users          UserAthlete[]
  lastScrapedAt  DateTime?
  createdAt      DateTime         @default(now())
  updatedAt      DateTime         @updatedAt
}

model UserAthlete {
  userId       String
  athleteId    String
  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  athlete      Athlete      @relation(fields: [athleteId], references: [id], onDelete: Cascade)
  relationship Relationship @default(PARENT)
  addedAt      DateTime     @default(now())

  @@id([userId, athleteId])
  @@index([athleteId])
}

model ClubMembership {
  id        String    @id @default(cuid())
  athleteId String
  athlete   Athlete   @relation(fields: [athleteId], references: [id], onDelete: Cascade)
  clubName  String
  clubCode  String?
  startDate DateTime?
  endDate   DateTime?

  @@index([athleteId])
}

enum Relationship {
  PARENT
  GUARDIAN
  SELF
  OTHER
}

enum Gender {
  M
  F
  X
}

// ─── Competition ────────────────────────────────────────────────────────

model Meet {
  id           String   @id @default(cuid())
  externalId   String   @unique
  name         String
  sanctionBody String?
  course       Course
  location     String?
  startDate    DateTime
  endDate      DateTime
  sourceUrl    String?
  events       Event[]
  swims        Swim[]
  createdAt    DateTime @default(now())
}

enum Course {
  SCM
  LCM
  SCY
}

model Event {
  id        String  @id @default(cuid())
  meetId    String
  meet      Meet    @relation(fields: [meetId], references: [id], onDelete: Cascade)
  distanceM Int
  stroke    Stroke
  gender    Gender
  ageBand   String?
  round     Round
  swims     Swim[]

  @@unique([meetId, distanceM, stroke, gender, ageBand, round])
  @@index([meetId])
}

enum Stroke {
  FR
  BK
  BR
  FL
  IM
}

enum Round {
  PRELIM
  SEMI
  FINAL
  TIMED_FINAL
}

// ─── Results ────────────────────────────────────────────────────────────

model Swim {
  id               String     @id @default(cuid())
  athleteId        String
  athlete          Athlete    @relation(fields: [athleteId], references: [id], onDelete: Cascade)
  meetId           String
  meet             Meet       @relation(fields: [meetId], references: [id], onDelete: Cascade)
  eventId          String
  event            Event      @relation(fields: [eventId], references: [id], onDelete: Cascade)

  // primary fields
  timeCentiseconds Int
  splits           Int[]
  place            Int?
  status           SwimStatus @default(OFFICIAL)

  // denormalized for fast PB lookup
  eventKey         String

  // source provenance — used now
  dataSource       String
  sourceUrl        String?
  scrapedAt        DateTime   @default(now())

  // versioning — wired but unused in MVP queries
  supersedesId     String?
  supersedes       Swim?      @relation("SwimVersion", fields: [supersedesId], references: [id])
  supersededBy     Swim[]     @relation("SwimVersion")
  isCurrent        Boolean    @default(true)

  // idempotency for re-scrapes; relaxed to a partial unique index on isCurrent=true
  // when Tier 3 multi-source ingestion arrives (see §5.3).
  @@unique([athleteId, meetId, eventId])
  @@index([athleteId, eventKey])
  @@index([meetId])
}

enum SwimStatus {
  OFFICIAL
  DQ
  NS
  DNF
  WITHDRAWN
}

model PersonalBest {
  id               String   @id @default(cuid())
  athleteId        String
  athlete          Athlete  @relation(fields: [athleteId], references: [id], onDelete: Cascade)
  eventKey         String
  swimId           String
  swim             Swim     @relation(fields: [swimId], references: [id])
  timeCentiseconds Int
  achievedAt       DateTime
  updatedAt        DateTime @updatedAt

  @@unique([athleteId, eventKey])
  @@index([eventKey])
}
```

---

## Appendix B — `eventKey` format

Canonical string format: `<distanceM>_<strokeAbbrev>_<courseAbbrev>`

Examples: `"50_FR_LCM"`, `"100_BK_SCM"`, `"400_IM_SCY"`, `"1500_FR_LCM"`.

Stroke abbreviations match the `Stroke` enum (`FR`, `BK`, `BR`, `FL`, `IM`).
Course abbreviations match the `Course` enum (`SCM`, `LCM`, `SCY`).

Builder lives in `packages/shared/src/eventKey.ts`. The builder is the only function authorized to generate this string; consumers must not concatenate it inline.
