# Flip Turn MVP — Workers Infrastructure Plan (Plan 2 of 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Plan series:** This is plan 2 of 6 derived from [`docs/superpowers/specs/2026-05-04-01-flipturn-mvp-design.md`](../specs/2026-05-04-01-flipturn-mvp-design.md). Updated split (was 5 plans; the spike's parser-shape uncertainty made splitting workers worthwhile):

- ✅ Plan 1 — Foundation (monorepo + db + shared) — landed
- **Plan 2 — Spike + Worker infrastructure (this plan)**
- Plan 3 — Real parser + integration (post-spike, depends on this plan's findings)
- Plan 4 — API (Hono + magic-link auth + endpoints)
- Plan 5 — Mobile (Expo + auth + onboarding + screens)
- Plan 6 — Hosting + closed-beta launch

**Goal:** Stand up `apps/workers` as a runnable BullMQ-driven scrape pipeline with all the spike-independent plumbing (politeness, raw archive, reconciler, PB recompute, scheduler, observability), backed by a **stub parser** that returns hardcoded `SwimRecord[]`. After this plan, `pnpm dev:workers` runs a worker process that can fetch a URL politely, archive the raw response, "parse" it (stub), reconcile to DB, and recompute PBs — end-to-end. Plan 3 swaps in the real parser.

**Architecture:** New `apps/workers` workspace package supervised eventually by pm2 (Plan 6). BullMQ on the dev Redis (port `56379`). Per-host Redis-backed token bucket. Idempotent reconciler against `@flipturn/db`. Pino structured logs to stdout. Optional Sentry DSN (no-op if unset). Heartbeat key in Redis with 60s TTL. Stub parser keyed by a `fixtureName` field on the job payload.

**Tech Stack:** TypeScript 5.6+, pnpm 9, Node 22 (LTS), BullMQ 5.x, ioredis 5.x, pino 9.x, `@sentry/node` 8.x, `undici` (fetch via Node), `cheerio` 1.x (added now so the real parser in Plan 3 doesn't have a setup task), Vitest 2.x.

**Recommended execution:** Use `superpowers:subagent-driven-development` with `model: "opus"` per the project's preference (see `~/.claude/projects/-Users-darrell-Documents-ai-projects-flipturn/memory/feedback_use_opus_agents.md`).

---

## File map (created by this plan)

```
flipturn/
├── apps/
│   └── workers/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vitest.config.ts
│       ├── README.md
│       ├── src/
│       │   ├── index.ts              # process entrypoint
│       │   ├── env.ts                # zod-validated env
│       │   ├── logger.ts             # pino factory
│       │   ├── sentry.ts             # init (no-op if no DSN)
│       │   ├── redis.ts              # ioredis singleton
│       │   ├── queue.ts              # BullMQ queue + job type
│       │   ├── politeness.ts         # token bucket + user-agent + robots.txt cache
│       │   ├── archive.ts            # raw artifact disk store
│       │   ├── fetch.ts              # combines politeness + archive
│       │   ├── parser/
│       │   │   ├── types.ts          # SwimRecord, AthleteSnapshot interfaces
│       │   │   └── stub.ts           # stub parser keyed by fixtureName
│       │   ├── reconcile.ts          # SwimRecord[] -> DB upsert
│       │   ├── personalBest.ts       # PB recompute
│       │   ├── worker.ts             # ties fetch -> parse -> reconcile -> PB
│       │   ├── scheduler.ts          # daily cron enqueuer
│       │   └── heartbeat.ts          # Redis heartbeat key
│       ├── tests/
│       │   ├── politeness.test.ts    # unit
│       │   ├── archive.test.ts       # unit (uses tmp dir)
│       │   ├── stub.test.ts          # unit
│       │   ├── reconcile.test.ts     # integration (real DB)
│       │   ├── personalBest.test.ts  # integration (real DB)
│       │   └── pipeline.integration.test.ts  # end-to-end
│       └── fixtures/
│           └── README.md             # populated by spike (Task 2)
└── docs/
    └── adr/
        └── 0002-snc-data-source.md   # written by spike (Task 2)
```

The `data/raw/` directory (gitignored, created at runtime by the archive module) is not committed.

---

## Task 1: apps/workers scaffolding

**Files:**

- Create: `apps/workers/package.json`
- Create: `apps/workers/tsconfig.json`
- Create: `apps/workers/vitest.config.ts`
- Create: `apps/workers/README.md`
- Create: `apps/workers/src/index.ts` (placeholder)

- [ ] **Step 1.1: Create `apps/workers/package.json`**

```json
{
  "name": "@flipturn/workers",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@flipturn/db": "workspace:*",
    "@flipturn/shared": "workspace:*",
    "@sentry/node": "^8.34.0",
    "bullmq": "^5.20.0",
    "cheerio": "^1.0.0",
    "ioredis": "^5.4.1",
    "pino": "^9.5.0",
    "pino-pretty": "^11.3.0",
    "undici": "^6.20.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.7.0",
    "tsx": "^4.19.1",
    "typescript": "^5.6.3",
    "vitest": "^2.1.2"
  }
}
```

- [ ] **Step 1.2: Create `apps/workers/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules", "tests", "fixtures"]
}
```

- [ ] **Step 1.3: Create `apps/workers/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    testTimeout: 30_000,
  },
});
```

- [ ] **Step 1.4: Create placeholder `apps/workers/src/index.ts`**

```ts
// Worker process entrypoint. Wired up in Task 15.
console.log('flipturn workers — not yet implemented');
```

- [ ] **Step 1.5: Create `apps/workers/README.md`**

````markdown
# @flipturn/workers

BullMQ-driven scrape pipeline for the Flip Turn MVP. Fetches athlete history from
public sources (Tier 4: results.swimming.ca), archives raw responses, parses to
normalized records, reconciles into Postgres, and recomputes per-athlete PBs.

## Local development

Requires the dev infra (Postgres + Redis) to be running:

```bash
pnpm dev:up
```

Then from the repo root:

```bash
pnpm --filter @flipturn/workers dev
```

## Architecture

See [`docs/superpowers/specs/2026-05-04-01-flipturn-mvp-design.md`](../../docs/superpowers/specs/2026-05-04-01-flipturn-mvp-design.md) §6 for the full worker design.

The pipeline is structured fetch-shape-agnostic so the spike's outcome (HTML vs.
JSON vs. Playwright) only affects the parser layer.

## Modules

- `env.ts` — zod-validated env vars
- `redis.ts` — ioredis singleton
- `queue.ts` — BullMQ queue + job type
- `politeness.ts` — Redis-backed token bucket, user-agent header, robots.txt cache
- `archive.ts` — raw artifact disk store under `data/raw/`
- `fetch.ts` — combines politeness + archive
- `parser/` — normalized record types + parser implementations
- `reconcile.ts` — idempotent DB upsert
- `personalBest.ts` — PB recompute
- `worker.ts` — pipeline: fetch → parse → reconcile → PB recompute
- `scheduler.ts` — daily cron enqueuer
- `heartbeat.ts` — Redis liveness key
````

- [ ] **Step 1.6: Update root `package.json` with worker scripts**

Read the current root `package.json`. In the `"scripts"` block, add three entries (preserving existing scripts):

```json
"workers:dev": "pnpm --filter @flipturn/workers dev",
"workers:start": "pnpm --filter @flipturn/workers start",
"workers:test": "pnpm --filter @flipturn/workers test"
```

Place them after the existing `dev:logs` script.

- [ ] **Step 1.7: Install package dependencies**

Run: `pnpm install`
Expected: pnpm picks up the new workspace package and installs all dependencies; lockfile updates.

- [ ] **Step 1.8: Verify the package is recognized**

Run: `pnpm ls --filter @flipturn/workers --depth -1`
Expected: shows `@flipturn/workers@0.0.0` at `apps/workers`.

- [ ] **Step 1.9: Smoke-test the placeholder**

Run: `pnpm workers:start`
Expected: prints `flipturn workers — not yet implemented` and exits 0.

- [ ] **Step 1.10: Verify formatters and linters**

Run: `pnpm format:check` and `pnpm lint`
Expected: both exit 0.

- [ ] **Step 1.11: Commit**

```bash
git add apps/workers package.json pnpm-lock.yaml
git commit -m "feat(workers): scaffold @flipturn/workers package"
```

---

## Task 2: Spike — investigate results.swimming.ca + write ADR 0002

This is research, not pure implementation. Deliverables: raw response fixtures + an ADR documenting what's available + a recommendation on the fetch approach.

**Files:**

- Create: `apps/workers/fixtures/snc-athlete-sample.html` (or `.json`, depending on what the source serves)
- Create: `apps/workers/fixtures/snc-meet-sample.html` (or `.json`)
- Create: `apps/workers/fixtures/README.md` (explaining where the fixtures came from)
- Create: `docs/adr/0002-snc-data-source.md`

- [ ] **Step 2.1: Investigate `results.swimming.ca` URL structure**

Open a browser (or use `curl`) and explore:

- Homepage: `https://www.swimming.ca/results/` (or wherever the canonical archive lives — verify)
- Sample athlete profile page (use any real swimmer's name search to find the URL pattern)
- Sample meet results page

Document:

- Base URL structure (athletes vs meets vs events)
- Whether pages are server-rendered HTML, JSON-via-API, or SPA (look at `view-source` and Network tab)
- Whether there's a `robots.txt` (`https://<host>/robots.txt`) and what it says
- Any obvious rate-limit headers (`X-RateLimit-*`, `Retry-After`)
- Any login wall, geo-block, or captcha

- [ ] **Step 2.2: Capture sample raw responses**

Use `curl` (or a browser "Save Page As") to grab two fixtures:

```bash
mkdir -p apps/workers/fixtures
curl -A "FlipTurnBot/0.1 (+https://flipturn.app/bot; contact@flipturn.app)" \
  -o apps/workers/fixtures/snc-athlete-sample.html \
  "<actual athlete URL>"
curl -A "FlipTurnBot/0.1 (+https://flipturn.app/bot; contact@flipturn.app)" \
  -o apps/workers/fixtures/snc-meet-sample.html \
  "<actual meet URL>"
```

Pick a non-sensitive athlete (e.g. a publicly-known retired Canadian Olympian) to avoid using a beta tester's child as a test fixture. The actual file extension depends on the response (`.html`, `.json`, etc.) — name it according to what the server returned.

If the source requires JS rendering and `curl` returns a near-empty shell, capture the rendered DOM via the browser's "Save Page As → Web Page, Complete" instead.

- [ ] **Step 2.3: Hand-extract expected data from each fixture**

For the athlete fixture, write `apps/workers/fixtures/snc-athlete-sample.expected.json` listing every swim visible on the page:

```json
{
  "athlete": {
    "sncId": "<the SNC ID from the URL or page>",
    "primaryName": "<full name>",
    "gender": "M|F|X",
    "homeClub": "<club name>"
  },
  "swims": [
    {
      "meetName": "<meet name>",
      "meetExternalId": "<SNC meet id from link>",
      "course": "SCM|LCM|SCY",
      "distanceM": 100,
      "stroke": "FR",
      "round": "PRELIM|FINAL|TIMED_FINAL",
      "ageBand": "<as displayed, or null>",
      "gender": "M|F|X",
      "timeCentiseconds": 5732,
      "place": 1,
      "splits": [3120, 3392],
      "status": "OFFICIAL|DQ|NS|DNF|WITHDRAWN",
      "swamAt": "2026-04-01T00:00:00.000Z"
    }
    // ... every visible swim
  ]
}
```

This becomes the parser's golden test in Plan 3.

For the meet fixture, write `apps/workers/fixtures/snc-meet-sample.expected.json` with the meet header + a list of events.

- [ ] **Step 2.4: Create `apps/workers/fixtures/README.md`**

```markdown
# Fixtures

Captured samples from `results.swimming.ca` for testing the parser (Plan 3).

| File                             | Source URL       | Captured   | Notes                  |
| -------------------------------- | ---------------- | ---------- | ---------------------- |
| snc-athlete-sample.html          | <full URL>       | YYYY-MM-DD | Public retired athlete |
| snc-athlete-sample.expected.json | (hand-extracted) | —          | Golden parser output   |
| snc-meet-sample.html             | <full URL>       | YYYY-MM-DD |                        |
| snc-meet-sample.expected.json    | (hand-extracted) | —          |                        |

Re-capture only when the source's HTML structure changes (low frequency).
Do NOT capture beta-user data here — fixtures must be public/non-sensitive.
```

- [ ] **Step 2.5: Write `docs/adr/0002-snc-data-source.md`**

Use this template; fill in based on what the spike found:

```markdown
# ADR 0002 — SNC data source: format, ethics, and fetch approach

**Status:** Accepted
**Date:** <YYYY-MM-DD>
**Deciders:** Darrell Bechtel
**Spec link:** [`docs/superpowers/specs/2026-05-04-flipturn-mvp-design.md`](../superpowers/specs/2026-05-04-flipturn-mvp-design.md)

## Context

Plan 2 (workers) needs to fetch athlete and meet data from `results.swimming.ca`,
the Tier-4 canonical archive of Swimming Canada-sanctioned meet results. The
exact data format determines the parser approach (cheerio for HTML vs `JSON.parse`
vs Playwright for JS-rendered SPAs) and constrains the rest of the worker design.

## Findings (from spike)

- **Base URL:** <e.g. `https://www.swimming.ca/results/`>
- **Athlete URL pattern:** <e.g. `/swimmers/<id>`>
- **Meet URL pattern:** <e.g. `/meets/<id>`>
- **Format:** <one of: server-rendered HTML / SPA requiring JS / JSON API / mix>
- **Rendering:** <e.g. "fully server-rendered, cheerio sufficient">
- **robots.txt:** <pasted excerpt; explicitly note Disallow paths>
- **Rate-limit headers observed:** <none / Retry-After / etc.>
- **Auth wall:** <none / login required>
- **Other:** <captchas, geo-blocks, anti-scraping signals>

## Decision

**Fetch approach:** <cheerio-on-static-HTML | undici JSON fetch | Playwright headless>

**Reasons:**

- <e.g. "responses are fully server-rendered HTML; no JS execution needed">
- <e.g. "low complexity; cheerio is the smallest viable dependency">

**Politeness defaults (per design spec §6.3):**

- User-Agent: `FlipTurnBot/0.1 (+https://flipturn.app/bot; contact@flipturn.app)`
- Rate limit: 1 req / 5s per host
- Daily per-host budget: 500 req/day
- Honor robots.txt; cache for 24h
- Use If-Modified-Since / ETag where supported

## Alternatives considered

- **Playwright headless browser** — needed if/when JS rendering is required.
  Adds ~10× per-fetch cost (Chromium + DOM construction) and a heavy dependency.
  Deferred unless the spike forced it.
- **Bulk meet-list traversal** — instead of per-athlete fetches, walk every meet
  in a date range and ingest all results. Bandwidth scales with meets not users.
  Rejected for MVP: closed beta is 10–20 athletes, per-athlete fetch is simpler.
- **SwimCloud as a fallback** — already excluded by the design spec's anti-goals
  (one-off identity lookups OK; bulk scraping is not).

## Consequences

- Plan 3 (parser) will be implementable as a pure function
  `(rawResponse: string) => SwimRecord[]` since no live JS execution is needed.
- Worker fetch loop can use `undici`'s `fetch` (Node native) — no browser process.
- If the source ever moves to a JS-rendered SPA, this ADR is superseded by 0003
  and the parser is rewritten against Playwright.

## Risks (carried forward)

- Source may change HTML structure without notice → parser breakage. Mitigation:
  fixture-based golden tests catch regressions in Plan 3; raw archive lets us
  replay against new parser versions without re-scraping.
- Source may add rate limits or anti-scraping → fetch loop respects 429 / Retry-After
  and falls back to manual import path (Plan 6+).
```

Fill in the angle-bracketed placeholders with what the spike actually showed.

- [ ] **Step 2.6: STOP-GATE**

Re-read the ADR you just wrote.

**If the decision is `Playwright headless`** OR the source has hard anti-scraping
(captchas, login wall, aggressive rate limits): **stop and escalate to the user.**
The MVP scope assumes lightweight static-content fetching. Playwright in MVP is a
significant scope expansion that warrants a re-scoping conversation. Report
DONE_WITH_CONCERNS and pause this plan until the user decides how to proceed.

**If the decision is `cheerio-on-static-HTML` or `JSON fetch`:** continue.

- [ ] **Step 2.7: Commit**

```bash
git add apps/workers/fixtures/ docs/adr/0002-snc-data-source.md
git commit -m "spike(snc): capture fixtures and document data source (adr 0002)"
```

---

## Task 3: Env validation, logger, Sentry init

**Files:**

- Create: `apps/workers/src/env.ts`
- Create: `apps/workers/src/logger.ts`
- Create: `apps/workers/src/sentry.ts`
- Modify: `.env.example` (add new vars)

- [ ] **Step 3.1: Create `apps/workers/src/env.ts`**

```ts
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  // Optional. If unset, Sentry is a no-op.
  SENTRY_DSN: z.string().url().optional(),
  // Optional. Defaults to "info"; lower (debug/trace) in dev.
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  // Politeness defaults — overridable for testing.
  SCRAPE_USER_AGENT: z
    .string()
    .default('FlipTurnBot/0.1 (+https://flipturn.app/bot; contact@flipturn.app)'),
  SCRAPE_RATE_LIMIT_MS: z.coerce.number().int().positive().default(5000),
  SCRAPE_DAILY_HOST_BUDGET: z.coerce.number().int().positive().default(500),
  // Path under repo root for raw artifact archive.
  ARCHIVE_DIR: z.string().default('./data/raw'),
});

export type WorkerEnv = z.infer<typeof EnvSchema>;

let _env: WorkerEnv | undefined;

export function getEnv(): WorkerEnv {
  if (!_env) {
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
      // eslint-disable-next-line no-console
      console.error('Invalid worker env:', parsed.error.flatten().fieldErrors);
      process.exit(1);
    }
    _env = parsed.data;
  }
  return _env;
}
```

- [ ] **Step 3.2: Create `apps/workers/src/logger.ts`**

```ts
import { pino, type Logger } from 'pino';
import { getEnv } from './env.js';

let _logger: Logger | undefined;

export function getLogger(): Logger {
  if (!_logger) {
    const env = getEnv();
    _logger = pino({
      level: env.LOG_LEVEL,
      base: { service: 'flipturn-workers' },
      transport:
        env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    });
  }
  return _logger;
}
```

- [ ] **Step 3.3: Create `apps/workers/src/sentry.ts`**

```ts
import * as Sentry from '@sentry/node';
import { getEnv } from './env.js';
import { getLogger } from './logger.js';

let _initialized = false;

export function initSentry(): void {
  if (_initialized) return;
  const env = getEnv();
  if (!env.SENTRY_DSN) {
    getLogger().info('SENTRY_DSN not set — Sentry disabled');
    _initialized = true;
    return;
  }
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: 0.1,
  });
  getLogger().info('Sentry initialized');
  _initialized = true;
}

export { Sentry };
```

- [ ] **Step 3.4: Update `.env.example`**

Read the current `.env.example`. Append these lines (preserving the existing content):

```
# Workers (apps/workers)
SENTRY_DSN=                          # optional; leave blank to disable Sentry
LOG_LEVEL=debug                      # one of: fatal/error/warn/info/debug/trace
SCRAPE_USER_AGENT="FlipTurnBot/0.1 (+https://flipturn.app/bot; contact@flipturn.app)"
SCRAPE_RATE_LIMIT_MS=5000
SCRAPE_DAILY_HOST_BUDGET=500
ARCHIVE_DIR=./data/raw
```

Then `cp .env.example .env` if you want the new defaults locally.

- [ ] **Step 3.5: Update placeholder index.ts**

Replace `apps/workers/src/index.ts` with:

```ts
import { getEnv } from './env.js';
import { getLogger } from './logger.js';
import { initSentry } from './sentry.js';

async function main() {
  const env = getEnv();
  initSentry();
  const log = getLogger();
  log.info({ nodeEnv: env.NODE_ENV }, 'flipturn workers boot — env validated');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal:', err);
  process.exit(1);
});
```

- [ ] **Step 3.6: Smoke-test**

From the repo root (with `.env` in place):

Run: `pnpm workers:start`
Expected: a single pino log line in pretty format showing `service: 'flipturn-workers'`, `nodeEnv: 'development'`, message `flipturn workers boot — env validated`. Process exits 0.

- [ ] **Step 3.7: Typecheck**

Run: `pnpm --filter @flipturn/workers typecheck`
Expected: exit 0.

- [ ] **Step 3.8: Commit**

```bash
git add apps/workers/src/env.ts apps/workers/src/logger.ts apps/workers/src/sentry.ts apps/workers/src/index.ts .env.example
git commit -m "feat(workers): add env validation, pino logger, sentry init"
```

---

## Task 4: Redis client + BullMQ queue

**Files:**

- Create: `apps/workers/src/redis.ts`
- Create: `apps/workers/src/queue.ts`

- [ ] **Step 4.1: Create `apps/workers/src/redis.ts`**

```ts
import { Redis, type RedisOptions } from 'ioredis';
import { getEnv } from './env.js';
import { getLogger } from './logger.js';

let _client: Redis | undefined;

const COMMON_OPTIONS: RedisOptions = {
  // BullMQ requires this for blocking commands.
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: false,
};

export function getRedis(): Redis {
  if (!_client) {
    const env = getEnv();
    _client = new Redis(env.REDIS_URL, COMMON_OPTIONS);
    _client.on('error', (err) => {
      getLogger().error({ err }, 'redis error');
    });
    _client.on('connect', () => {
      getLogger().debug('redis connected');
    });
  }
  return _client;
}

export async function disconnectRedis(): Promise<void> {
  if (_client) {
    await _client.quit();
    _client = undefined;
  }
}
```

- [ ] **Step 4.2: Create `apps/workers/src/queue.ts`**

```ts
import { Queue, type JobsOptions } from 'bullmq';
import { getRedis } from './redis.js';

export const SCRAPE_ATHLETE_QUEUE = 'scrape-athlete';

export interface ScrapeAthleteJob {
  /** Internal Athlete.id (cuid). */
  readonly athleteId: string;
  /** SNC athlete ID (e.g. used to construct the source URL). */
  readonly sncId: string;
  /**
   * If set, parser uses the named fixture instead of fetching live.
   * Used in Plan 2's stub parser; ignored in Plan 3+.
   */
  readonly fixtureName?: string;
}

let _queue: Queue<ScrapeAthleteJob> | undefined;

export function getScrapeAthleteQueue(): Queue<ScrapeAthleteJob> {
  if (!_queue) {
    _queue = new Queue<ScrapeAthleteJob>(SCRAPE_ATHLETE_QUEUE, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 1000 },
      },
    });
  }
  return _queue;
}

export async function enqueueScrapeAthlete(
  job: ScrapeAthleteJob,
  options?: JobsOptions,
): Promise<string> {
  const queue = getScrapeAthleteQueue();
  const added = await queue.add('scrape', job, options);
  return added.id ?? '<no-id>';
}
```

- [ ] **Step 4.3: Smoke-test queue connectivity**

Update `apps/workers/src/index.ts` temporarily (you'll wire the worker properly in Task 12):

```ts
import { getEnv } from './env.js';
import { getLogger } from './logger.js';
import { initSentry } from './sentry.js';
import { enqueueScrapeAthlete } from './queue.js';
import { disconnectRedis } from './redis.js';

async function main() {
  const env = getEnv();
  initSentry();
  const log = getLogger();
  log.info({ nodeEnv: env.NODE_ENV }, 'flipturn workers boot');

  const id = await enqueueScrapeAthlete({
    athleteId: 'smoke-test',
    sncId: 'SNC-SMOKE',
    fixtureName: 'snc-athlete-sample',
  });
  log.info({ jobId: id }, 'enqueued smoke-test job');

  await disconnectRedis();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal:', err);
  process.exit(1);
});
```

Run: `pnpm dev:up` (if not already) then `pnpm workers:start`
Expected: two log lines, the second showing `jobId: '<some id>'`. Process exits 0.

Verify via Redis: `docker exec flipturn-redis redis-cli LLEN bull:scrape-athlete:wait`
Expected: shows a count ≥ 1 (the smoke-test job is sitting in the queue with no worker to consume it yet — that's fine).

- [ ] **Step 4.4: Drain the smoke-test job**

Run: `docker exec flipturn-redis redis-cli DEL bull:scrape-athlete:wait bull:scrape-athlete:meta bull:scrape-athlete:id`
Expected: returns the count of keys deleted. This cleans up the smoke-test job so it doesn't replay.

- [ ] **Step 4.5: Revert the smoke-test code**

Revert `apps/workers/src/index.ts` to its Task 3 state (just env + logger + sentry boot — no enqueue):

```ts
import { getEnv } from './env.js';
import { getLogger } from './logger.js';
import { initSentry } from './sentry.js';

async function main() {
  const env = getEnv();
  initSentry();
  const log = getLogger();
  log.info({ nodeEnv: env.NODE_ENV }, 'flipturn workers boot — env validated');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal:', err);
  process.exit(1);
});
```

- [ ] **Step 4.6: Typecheck**

Run: `pnpm --filter @flipturn/workers typecheck`
Expected: exit 0.

- [ ] **Step 4.7: Commit**

```bash
git add apps/workers/src/redis.ts apps/workers/src/queue.ts apps/workers/src/index.ts
git commit -m "feat(workers): add ioredis client and bullmq scrape-athlete queue"
```

---

## Task 5: Politeness — Redis-backed token bucket (TDD)

**Files:**

- Create: `apps/workers/tests/politeness.test.ts`
- Create: `apps/workers/src/politeness.ts` (token bucket portion only; user-agent + robots.txt come in Task 6)

- [ ] **Step 5.1: Write the failing tests**

Create `apps/workers/tests/politeness.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { Redis } from 'ioredis';
import { acquireToken, resetTokenBucket } from '../src/politeness.js';

const TEST_REDIS_URL = 'redis://localhost:56379';
const TEST_HOST = 'test.example.com';

const redis = new Redis(TEST_REDIS_URL, { maxRetriesPerRequest: null });

describe('acquireToken', () => {
  beforeEach(async () => {
    await resetTokenBucket(redis, TEST_HOST);
  });

  afterAll(async () => {
    await resetTokenBucket(redis, TEST_HOST);
    await redis.quit();
  });

  it('grants the first token immediately', async () => {
    const start = Date.now();
    const granted = await acquireToken(redis, TEST_HOST, { rateLimitMs: 100 });
    const elapsed = Date.now() - start;
    expect(granted).toBe(true);
    expect(elapsed).toBeLessThan(50);
  });

  it('blocks the second token until rateLimitMs has passed', async () => {
    await acquireToken(redis, TEST_HOST, { rateLimitMs: 100 });
    const start = Date.now();
    await acquireToken(redis, TEST_HOST, { rateLimitMs: 100 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(95);
    expect(elapsed).toBeLessThan(250);
  });

  it('isolates buckets by host', async () => {
    await acquireToken(redis, TEST_HOST, { rateLimitMs: 1000 });
    const start = Date.now();
    await acquireToken(redis, 'other.example.com', { rateLimitMs: 1000 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50);
    await resetTokenBucket(redis, 'other.example.com');
  });

  it('returns false when host budget is exhausted', async () => {
    const granted1 = await acquireToken(redis, TEST_HOST, {
      rateLimitMs: 0,
      dailyBudget: 2,
    });
    const granted2 = await acquireToken(redis, TEST_HOST, {
      rateLimitMs: 0,
      dailyBudget: 2,
    });
    const granted3 = await acquireToken(redis, TEST_HOST, {
      rateLimitMs: 0,
      dailyBudget: 2,
    });
    expect(granted1).toBe(true);
    expect(granted2).toBe(true);
    expect(granted3).toBe(false);
  });
});
```

- [ ] **Step 5.2: Run tests to verify they fail**

Run: `pnpm --filter @flipturn/workers test`
Expected: tests fail with module-not-found for `../src/politeness.js`.

- [ ] **Step 5.3: Implement `apps/workers/src/politeness.ts`**

```ts
import type { Redis } from 'ioredis';

export interface TokenBucketOptions {
  /** Minimum interval between token grants in ms. */
  readonly rateLimitMs: number;
  /** Maximum tokens granted per host per UTC day. Optional; if unset, unlimited. */
  readonly dailyBudget?: number;
}

const lastTouchKey = (host: string) => `politeness:last:${host}`;
const dailyCountKey = (host: string) => {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  return `politeness:count:${host}:${day}`;
};

/**
 * Acquire a politeness token for the given host. Blocks (via setTimeout)
 * until rateLimitMs has elapsed since the last grant for that host.
 * Returns false if the daily budget is exhausted.
 */
export async function acquireToken(
  redis: Redis,
  host: string,
  options: TokenBucketOptions,
): Promise<boolean> {
  if (typeof options.dailyBudget === 'number') {
    const countKey = dailyCountKey(host);
    const count = await redis.incr(countKey);
    if (count === 1) {
      // first incr today → set a 25h TTL so the key auto-cleans.
      await redis.expire(countKey, 90_000);
    }
    if (count > options.dailyBudget) {
      // Roll back: don't double-charge if we were going to block.
      await redis.decr(countKey);
      return false;
    }
  }

  const lastKey = lastTouchKey(host);
  const lastStr = await redis.get(lastKey);
  const last = lastStr ? parseInt(lastStr, 10) : 0;
  const now = Date.now();
  const wait = Math.max(0, last + options.rateLimitMs - now);
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  await redis.set(lastKey, Date.now().toString(), 'EX', 60 * 60); // 1h TTL
  return true;
}

/** Test helper. */
export async function resetTokenBucket(redis: Redis, host: string): Promise<void> {
  await redis.del(lastTouchKey(host));
  const day = new Date().toISOString().slice(0, 10);
  await redis.del(`politeness:count:${host}:${day}`);
}
```

- [ ] **Step 5.4: Run tests to verify they pass**

Run: `pnpm --filter @flipturn/workers test`
Expected: 4 tests pass in `politeness.test.ts`.

- [ ] **Step 5.5: Verify formatters**

Run: `pnpm format:check` and `pnpm --filter @flipturn/workers typecheck`
Expected: both exit 0.

- [ ] **Step 5.6: Commit**

```bash
git add apps/workers/src/politeness.ts apps/workers/tests/politeness.test.ts
git commit -m "feat(workers): redis-backed token bucket with daily host budget"
```

---

## Task 6: Politeness — robots.txt cache + user-agent

**Files:**

- Modify: `apps/workers/src/politeness.ts` (extend with robots.txt + user-agent helper)
- Modify: `apps/workers/tests/politeness.test.ts` (add tests for the new helpers)

- [ ] **Step 6.1: Add tests for `isAllowedByRobots`**

Append to `apps/workers/tests/politeness.test.ts` (inside the same file, new `describe` blocks):

```ts
import { isAllowedByRobots, getUserAgent, resetRobotsCache } from '../src/politeness.js';

describe('getUserAgent', () => {
  it('returns the env-configured user-agent', () => {
    expect(getUserAgent()).toContain('FlipTurnBot');
  });
});

describe('isAllowedByRobots', () => {
  beforeEach(async () => {
    await resetRobotsCache(redis, 'robots-test.example.com');
  });

  it('returns true when the host has no robots.txt (404)', async () => {
    // 'robots-test.example.com' resolves to no real server; the implementation
    // treats any non-200 / network error as "allowed".
    const allowed = await isAllowedByRobots(redis, 'http://robots-test.example.com/results/123');
    expect(allowed).toBe(true);
  });
});
```

The `robots-test.example.com` test relies on the implementation defaulting to "allowed" on fetch failure. Real-source robots.txt parsing is verified manually in the spike's findings (ADR 0002).

- [ ] **Step 6.2: Run — tests should fail (new helpers don't exist yet)**

Run: `pnpm --filter @flipturn/workers test`
Expected: token-bucket tests still pass; new tests fail with import errors.

- [ ] **Step 6.3: Extend `apps/workers/src/politeness.ts`**

Append (do NOT replace — keep the existing token-bucket code):

```ts
import { request } from 'undici';
import { getEnv } from './env.js';
import { getLogger } from './logger.js';

export function getUserAgent(): string {
  return getEnv().SCRAPE_USER_AGENT;
}

const robotsKey = (host: string) => `politeness:robots:${host}`;
const ROBOTS_TTL_S = 24 * 60 * 60; // 24h

interface RobotsRules {
  /** Disallow paths for our user-agent. Empty array = no restrictions. */
  readonly disallow: readonly string[];
}

/**
 * Fetch and parse robots.txt for a host. Returns "allow everything" on
 * any error (network, 404, etc.) — fail-open is acceptable here because
 * scraping etiquette is one consideration among several (see also rate
 * limiting and source attribution).
 */
async function fetchRobots(hostUrl: URL): Promise<RobotsRules> {
  const robotsUrl = `${hostUrl.protocol}//${hostUrl.host}/robots.txt`;
  try {
    const { statusCode, body } = await request(robotsUrl, {
      method: 'GET',
      headers: { 'user-agent': getUserAgent() },
    });
    if (statusCode !== 200) {
      return { disallow: [] };
    }
    const text = await body.text();
    return parseRobots(text);
  } catch (err) {
    getLogger().warn({ err, robotsUrl }, 'robots.txt fetch failed; allowing all');
    return { disallow: [] };
  }
}

/** Minimal robots.txt parser — supports User-agent and Disallow. */
function parseRobots(text: string): RobotsRules {
  const lines = text.split(/\r?\n/);
  const disallow: string[] = [];
  let currentApplies = false;
  for (const raw of lines) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const [keyRaw, ...rest] = line.split(':');
    if (!keyRaw || rest.length === 0) continue;
    const key = keyRaw.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      // Apply if matches our UA token or wildcard.
      currentApplies = value === '*' || getUserAgent().toLowerCase().includes(value.toLowerCase());
    } else if (key === 'disallow' && currentApplies && value) {
      disallow.push(value);
    }
  }
  return { disallow };
}

export async function isAllowedByRobots(redis: Redis, fullUrl: string): Promise<boolean> {
  const url = new URL(fullUrl);
  const cacheKey = robotsKey(url.host);
  const cached = await redis.get(cacheKey);
  let rules: RobotsRules;
  if (cached) {
    rules = JSON.parse(cached) as RobotsRules;
  } else {
    rules = await fetchRobots(url);
    await redis.set(cacheKey, JSON.stringify(rules), 'EX', ROBOTS_TTL_S);
  }
  return !rules.disallow.some((path) => url.pathname.startsWith(path));
}

/** Test helper. */
export async function resetRobotsCache(redis: Redis, host: string): Promise<void> {
  await redis.del(robotsKey(host));
}
```

- [ ] **Step 6.4: Run tests — verify all pass**

Run: `pnpm --filter @flipturn/workers test`
Expected: all 5+ politeness tests pass.

- [ ] **Step 6.5: Typecheck + format**

Run: `pnpm --filter @flipturn/workers typecheck` and `pnpm format:check`
Expected: both exit 0.

- [ ] **Step 6.6: Commit**

```bash
git add apps/workers/src/politeness.ts apps/workers/tests/politeness.test.ts
git commit -m "feat(workers): add robots.txt cache and user-agent helper"
```

---

## Task 7: Raw artifact archive (TDD)

**Files:**

- Create: `apps/workers/tests/archive.test.ts`
- Create: `apps/workers/src/archive.ts`

The archive writes the raw response body to disk for replay/audit. Path:
`<ARCHIVE_DIR>/<host>/<sncId>/<ISO8601>.<ext>`. Gitignored at the repo root.

- [ ] **Step 7.1: Write the failing tests**

Create `apps/workers/tests/archive.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archiveResponse, listArchivedFor } from '../src/archive.js';

let tmp: string;

describe('archiveResponse', () => {
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'flipturn-archive-'));
  });

  afterAll(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it('writes the body under <baseDir>/<host>/<sncId>/<ISO>.<ext>', async () => {
    const path = await archiveResponse({
      baseDir: tmp,
      host: 'results.swimming.ca',
      sncId: 'SNC-1',
      body: '<html>hello</html>',
      contentType: 'text/html',
    });

    expect(path.startsWith(tmp)).toBe(true);
    expect(path).toContain('results.swimming.ca');
    expect(path).toContain('SNC-1');
    expect(path).toMatch(/\.html$/);

    const contents = await readFile(path, 'utf8');
    expect(contents).toBe('<html>hello</html>');
  });

  it('chooses the extension from content-type', async () => {
    const html = await archiveResponse({
      baseDir: tmp,
      host: 'h',
      sncId: 's1',
      body: '<x/>',
      contentType: 'text/html; charset=utf-8',
    });
    const json = await archiveResponse({
      baseDir: tmp,
      host: 'h',
      sncId: 's2',
      body: '{}',
      contentType: 'application/json',
    });
    const fallback = await archiveResponse({
      baseDir: tmp,
      host: 'h',
      sncId: 's3',
      body: 'plain',
      contentType: 'application/x-unknown',
    });
    expect(html).toMatch(/\.html$/);
    expect(json).toMatch(/\.json$/);
    expect(fallback).toMatch(/\.bin$/);
  });

  it('listArchivedFor returns archived files for an athlete', async () => {
    await archiveResponse({
      baseDir: tmp,
      host: 'h',
      sncId: 'S-listed',
      body: 'a',
      contentType: 'text/html',
    });
    await new Promise((r) => setTimeout(r, 5));
    await archiveResponse({
      baseDir: tmp,
      host: 'h',
      sncId: 'S-listed',
      body: 'b',
      contentType: 'text/html',
    });
    const files = await listArchivedFor(tmp, 'h', 'S-listed');
    expect(files).toHaveLength(2);
    expect(files[0]).toMatch(/\.html$/);
  });

  it('does not write to a path outside baseDir', async () => {
    await expect(
      archiveResponse({
        baseDir: tmp,
        host: '../escape',
        sncId: 'x',
        body: 'a',
        contentType: 'text/html',
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 7.2: Run — verify failure**

Run: `pnpm --filter @flipturn/workers test`
Expected: archive tests fail with module-not-found.

- [ ] **Step 7.3: Implement `apps/workers/src/archive.ts`**

```ts
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export interface ArchiveRequest {
  readonly baseDir: string;
  readonly host: string;
  readonly sncId: string;
  readonly body: string;
  readonly contentType: string;
}

const EXT_BY_TYPE: Record<string, string> = {
  'text/html': 'html',
  'application/xhtml+xml': 'html',
  'application/json': 'json',
  'text/json': 'json',
  'text/plain': 'txt',
  'application/xml': 'xml',
  'text/xml': 'xml',
};

function extFor(contentType: string): string {
  const base = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return EXT_BY_TYPE[base] ?? 'bin';
}

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

function assertSafeSegment(name: string, label: string): void {
  if (!SAFE_SEGMENT.test(name)) {
    throw new Error(
      `archive: ${label} must match ${SAFE_SEGMENT.source}, got ${JSON.stringify(name)}`,
    );
  }
}

export async function archiveResponse(req: ArchiveRequest): Promise<string> {
  assertSafeSegment(req.host, 'host');
  assertSafeSegment(req.sncId, 'sncId');

  const ext = extFor(req.contentType);
  const dir = resolve(req.baseDir, req.host, req.sncId);
  // Defensive: confirm we didn't escape baseDir via a malicious resolved path.
  if (!dir.startsWith(resolve(req.baseDir))) {
    throw new Error(`archive: refusing to write outside baseDir`);
  }
  await mkdir(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${stamp}.${ext}`;
  const path = join(dir, filename);
  await writeFile(path, req.body, 'utf8');
  return path;
}

export async function listArchivedFor(
  baseDir: string,
  host: string,
  sncId: string,
): Promise<string[]> {
  const dir = resolve(baseDir, host, sncId);
  try {
    const entries = await readdir(dir);
    return entries.sort().map((e) => join(dir, e));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}
```

- [ ] **Step 7.4: Run — verify pass**

Run: `pnpm --filter @flipturn/workers test`
Expected: 4 archive tests pass.

- [ ] **Step 7.5: Typecheck + format**

Run: `pnpm --filter @flipturn/workers typecheck` and `pnpm format:check`
Expected: both exit 0.

- [ ] **Step 7.6: Commit**

```bash
git add apps/workers/src/archive.ts apps/workers/tests/archive.test.ts
git commit -m "feat(workers): raw artifact disk archive with path safety"
```

---

## Task 8: Fetcher — politeness + archive integration

**Files:**

- Create: `apps/workers/src/fetch.ts`

This module composes the politeness gates and the archive. No new tests added — it's covered by the end-to-end pipeline test in Task 14.

- [ ] **Step 8.1: Implement `apps/workers/src/fetch.ts`**

```ts
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
    host: url.host,
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
```

- [ ] **Step 8.2: Typecheck**

Run: `pnpm --filter @flipturn/workers typecheck`
Expected: exit 0.

- [ ] **Step 8.3: Format check + lint**

Run: `pnpm format:check` and `pnpm lint`
Expected: both exit 0.

- [ ] **Step 8.4: Commit**

```bash
git add apps/workers/src/fetch.ts
git commit -m "feat(workers): polite fetch combining rate limit, robots, archive"
```

---

## Task 9: Stub parser

**Files:**

- Create: `apps/workers/src/parser/types.ts`
- Create: `apps/workers/src/parser/stub.ts`
- Create: `apps/workers/tests/stub.test.ts`

The stub parser is keyed by `fixtureName` (set on the job payload). It returns a hardcoded `AthleteSnapshot` regardless of the input body. Plan 3 swaps this for the real parser.

- [ ] **Step 9.1: Create `apps/workers/src/parser/types.ts`**

```ts
import type { Stroke, Course, Gender, Round, SwimStatus } from '@flipturn/shared';

export interface SwimRecord {
  readonly meetExternalId: string;
  readonly meetName: string;
  readonly meetStartDate: Date;
  readonly meetEndDate: Date;
  readonly course: Course;
  readonly distanceM: number;
  readonly stroke: Stroke;
  readonly round: Round;
  readonly gender: Gender;
  readonly ageBand: string | null;
  readonly timeCentiseconds: number;
  readonly splits: readonly number[];
  readonly place: number | null;
  readonly status: SwimStatus;
  readonly swamAt: Date;
}

export interface AthleteSnapshot {
  readonly sncId: string;
  readonly primaryName: string;
  readonly gender: Gender | null;
  readonly homeClub: string | null;
  readonly swims: readonly SwimRecord[];
}
```

- [ ] **Step 9.2: Write the stub-parser tests**

Create `apps/workers/tests/stub.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseStub } from '../src/parser/stub.js';

describe('parseStub', () => {
  it('returns the demo-sarah snapshot for fixtureName="demo-sarah"', () => {
    const snap = parseStub({ fixtureName: 'demo-sarah', sncId: 'unused', body: '' });
    expect(snap.sncId).toBe('DEMO-SARAH-001');
    expect(snap.primaryName).toBe('Sarah Demo');
    expect(snap.swims.length).toBeGreaterThan(0);
  });

  it('returns the demo-benji snapshot for fixtureName="demo-benji"', () => {
    const snap = parseStub({ fixtureName: 'demo-benji', sncId: 'unused', body: '' });
    expect(snap.sncId).toBe('DEMO-BENJI-002');
  });

  it('throws on unknown fixture', () => {
    expect(() => parseStub({ fixtureName: 'no-such-fixture', sncId: 'x', body: '' })).toThrow();
  });

  it('uses the sncId override if fixtureName not provided', () => {
    const snap = parseStub({ sncId: 'CUSTOM-1', body: '<html/>' });
    expect(snap.sncId).toBe('CUSTOM-1');
    expect(snap.swims).toHaveLength(0);
  });
});
```

- [ ] **Step 9.3: Run — verify failure**

Run: `pnpm --filter @flipturn/workers test`
Expected: `stub.test.ts` fails with module-not-found.

- [ ] **Step 9.4: Implement `apps/workers/src/parser/stub.ts`**

```ts
import type { AthleteSnapshot, SwimRecord } from './types.js';

export interface StubParseInput {
  readonly fixtureName?: string;
  readonly sncId: string;
  readonly body: string;
}

const DEMO_SARAH: AthleteSnapshot = {
  sncId: 'DEMO-SARAH-001',
  primaryName: 'Sarah Demo',
  gender: 'F',
  homeClub: 'Waterloo Region Aquatics',
  swims: [
    {
      meetExternalId: 'DEMO-MEET-001',
      meetName: 'Demo Spring Open 2026',
      meetStartDate: new Date('2026-04-01'),
      meetEndDate: new Date('2026-04-03'),
      course: 'LCM',
      distanceM: 100,
      stroke: 'FR',
      round: 'TIMED_FINAL',
      gender: 'F',
      ageBand: '13-14',
      timeCentiseconds: 5732,
      splits: [3120, 2612],
      place: 3,
      status: 'OFFICIAL',
      swamAt: new Date('2026-04-01T10:00:00Z'),
    },
    {
      meetExternalId: 'DEMO-MEET-001',
      meetName: 'Demo Spring Open 2026',
      meetStartDate: new Date('2026-04-01'),
      meetEndDate: new Date('2026-04-03'),
      course: 'LCM',
      distanceM: 200,
      stroke: 'FR',
      round: 'TIMED_FINAL',
      gender: 'F',
      ageBand: '13-14',
      timeCentiseconds: 12345,
      splits: [3010, 3120, 3110, 3105],
      place: 4,
      status: 'OFFICIAL',
      swamAt: new Date('2026-04-02T10:00:00Z'),
    },
  ] satisfies SwimRecord[],
};

const DEMO_BENJI: AthleteSnapshot = {
  sncId: 'DEMO-BENJI-002',
  primaryName: 'Benji Demo',
  gender: 'M',
  homeClub: 'Waterloo Region Aquatics',
  swims: [
    {
      meetExternalId: 'DEMO-MEET-001',
      meetName: 'Demo Spring Open 2026',
      meetStartDate: new Date('2026-04-01'),
      meetEndDate: new Date('2026-04-03'),
      course: 'LCM',
      distanceM: 50,
      stroke: 'FR',
      round: 'TIMED_FINAL',
      gender: 'M',
      ageBand: '11-12',
      timeCentiseconds: 3145,
      splits: [],
      place: 2,
      status: 'OFFICIAL',
      swamAt: new Date('2026-04-01T11:00:00Z'),
    },
  ] satisfies SwimRecord[],
};

const FIXTURES: Record<string, AthleteSnapshot> = {
  'demo-sarah': DEMO_SARAH,
  'demo-benji': DEMO_BENJI,
};

export function parseStub(input: StubParseInput): AthleteSnapshot {
  if (input.fixtureName) {
    const snap = FIXTURES[input.fixtureName];
    if (!snap) {
      throw new Error(`parseStub: unknown fixture "${input.fixtureName}"`);
    }
    return snap;
  }
  // No fixture: synthesize an empty snapshot using the provided sncId.
  return {
    sncId: input.sncId,
    primaryName: 'Unknown',
    gender: null,
    homeClub: null,
    swims: [],
  };
}
```

- [ ] **Step 9.5: Run — verify pass**

Run: `pnpm --filter @flipturn/workers test`
Expected: 4 stub tests pass.

- [ ] **Step 9.6: Typecheck**

Run: `pnpm --filter @flipturn/workers typecheck`
Expected: exit 0.

- [ ] **Step 9.7: Commit**

```bash
git add apps/workers/src/parser/types.ts apps/workers/src/parser/stub.ts apps/workers/tests/stub.test.ts
git commit -m "feat(workers): stub parser with two demo athlete snapshots"
```

---

## Task 10: Reconciler (TDD, real DB)

**Files:**

- Create: `apps/workers/tests/reconcile.test.ts`
- Create: `apps/workers/src/reconcile.ts`

The reconciler takes an `AthleteSnapshot` and idempotently upserts the athlete + meets + events + swims into Postgres. PB recompute is separate (Task 11).

- [ ] **Step 10.1: Write the failing tests**

Create `apps/workers/tests/reconcile.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { reconcile } from '../src/reconcile.js';
import { parseStub } from '../src/parser/stub.js';

const TEST_DB = `flipturn_reconcile_test_${Date.now()}`;
const TEST_URL = `postgresql://flipturn:flipturn_dev@localhost:55432/${TEST_DB}?schema=public`;

let prisma: PrismaClient;

describe('reconcile', () => {
  beforeAll(() => {
    execSync(
      `docker exec flipturn-postgres psql -U flipturn -d flipturn -c "CREATE DATABASE ${TEST_DB};"`,
      { stdio: 'pipe' },
    );
    execSync('pnpm --filter @flipturn/db exec prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: TEST_URL },
      stdio: 'pipe',
    });
    prisma = new PrismaClient({ datasources: { db: { url: TEST_URL } } });
  });

  beforeEach(async () => {
    await prisma.swim.deleteMany();
    await prisma.event.deleteMany();
    await prisma.meet.deleteMany();
    await prisma.athlete.deleteMany();
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
    execSync(
      `docker exec flipturn-postgres psql -U flipturn -d flipturn -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${TEST_DB}';"`,
      { stdio: 'pipe' },
    );
    execSync(
      `docker exec flipturn-postgres psql -U flipturn -d flipturn -c "DROP DATABASE ${TEST_DB};"`,
      { stdio: 'pipe' },
    );
  });

  it('inserts athlete, meet, events, and swims from a fresh snapshot', async () => {
    const snap = parseStub({ fixtureName: 'demo-sarah', sncId: 'x', body: '' });
    await reconcile(prisma, snap);

    const athlete = await prisma.athlete.findUnique({ where: { sncId: 'DEMO-SARAH-001' } });
    expect(athlete).not.toBeNull();
    const meets = await prisma.meet.findMany();
    expect(meets).toHaveLength(1);
    const swims = await prisma.swim.findMany({ where: { athleteId: athlete!.id } });
    expect(swims).toHaveLength(2);
  });

  it('is idempotent — re-applying the same snapshot makes no new rows', async () => {
    const snap = parseStub({ fixtureName: 'demo-sarah', sncId: 'x', body: '' });
    await reconcile(prisma, snap);
    const before = {
      athletes: await prisma.athlete.count(),
      meets: await prisma.meet.count(),
      events: await prisma.event.count(),
      swims: await prisma.swim.count(),
    };
    await reconcile(prisma, snap);
    const after = {
      athletes: await prisma.athlete.count(),
      meets: await prisma.meet.count(),
      events: await prisma.event.count(),
      swims: await prisma.swim.count(),
    };
    expect(after).toEqual(before);
  });

  it('updates athlete metadata if the snapshot changes it', async () => {
    const first = parseStub({ fixtureName: 'demo-sarah', sncId: 'x', body: '' });
    await reconcile(prisma, first);

    const updated = { ...first, homeClub: 'New Club' };
    await reconcile(prisma, updated);

    const athlete = await prisma.athlete.findUnique({ where: { sncId: 'DEMO-SARAH-001' } });
    expect(athlete?.homeClub).toBe('New Club');
  });

  it('sets lastScrapedAt to a recent timestamp', async () => {
    const before = new Date();
    const snap = parseStub({ fixtureName: 'demo-sarah', sncId: 'x', body: '' });
    await reconcile(prisma, snap);
    const athlete = await prisma.athlete.findUnique({ where: { sncId: 'DEMO-SARAH-001' } });
    expect(athlete?.lastScrapedAt).not.toBeNull();
    expect(athlete!.lastScrapedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 100);
  });

  it('writes the eventKey on every swim', async () => {
    const snap = parseStub({ fixtureName: 'demo-sarah', sncId: 'x', body: '' });
    await reconcile(prisma, snap);
    const swims = await prisma.swim.findMany();
    for (const swim of swims) {
      expect(swim.eventKey).toMatch(/^\d+_(FR|BK|BR|FL|IM)_(SCM|LCM|SCY)$/);
    }
  });
});
```

- [ ] **Step 10.2: Run — verify failure**

Run: `pnpm --filter @flipturn/workers test`
Expected: `reconcile.test.ts` fails with module-not-found.

- [ ] **Step 10.3: Implement `apps/workers/src/reconcile.ts`**

```ts
import type { PrismaClient } from '@prisma/client';
import { buildEventKey } from '@flipturn/shared';
import type { AthleteSnapshot, SwimRecord } from './parser/types.js';
import { getLogger } from './logger.js';

export async function reconcile(
  prisma: PrismaClient,
  snapshot: AthleteSnapshot,
): Promise<{ athleteId: string; swimsTouched: number }> {
  const log = getLogger();

  return prisma.$transaction(async (tx) => {
    const athlete = await tx.athlete.upsert({
      where: { sncId: snapshot.sncId },
      update: {
        primaryName: snapshot.primaryName,
        gender: snapshot.gender ?? null,
        homeClub: snapshot.homeClub ?? null,
        lastScrapedAt: new Date(),
      },
      create: {
        sncId: snapshot.sncId,
        primaryName: snapshot.primaryName,
        gender: snapshot.gender ?? null,
        homeClub: snapshot.homeClub ?? null,
        lastScrapedAt: new Date(),
      },
    });

    let swimsTouched = 0;

    for (const record of snapshot.swims) {
      const meet = await tx.meet.upsert({
        where: { externalId: record.meetExternalId },
        update: {
          name: record.meetName,
          startDate: record.meetStartDate,
          endDate: record.meetEndDate,
          course: record.course,
        },
        create: {
          externalId: record.meetExternalId,
          name: record.meetName,
          course: record.course,
          startDate: record.meetStartDate,
          endDate: record.meetEndDate,
        },
      });

      const event = await tx.event.upsert({
        where: {
          meetId_distanceM_stroke_gender_ageBand_round: {
            meetId: meet.id,
            distanceM: record.distanceM,
            stroke: record.stroke,
            gender: record.gender,
            ageBand: record.ageBand ?? null,
            round: record.round,
          },
        },
        update: {},
        create: {
          meetId: meet.id,
          distanceM: record.distanceM,
          stroke: record.stroke,
          gender: record.gender,
          ageBand: record.ageBand ?? null,
          round: record.round,
        },
      });

      const eventKey = buildEventKey({
        distanceM: record.distanceM,
        stroke: record.stroke,
        course: record.course,
      });

      await tx.swim.upsert({
        where: {
          athleteId_meetId_eventId: {
            athleteId: athlete.id,
            meetId: meet.id,
            eventId: event.id,
          },
        },
        update: {
          timeCentiseconds: record.timeCentiseconds,
          splits: [...record.splits],
          place: record.place ?? null,
          status: record.status,
          eventKey,
          scrapedAt: new Date(),
        },
        create: {
          athleteId: athlete.id,
          meetId: meet.id,
          eventId: event.id,
          timeCentiseconds: record.timeCentiseconds,
          splits: [...record.splits],
          place: record.place ?? null,
          status: record.status,
          eventKey,
          dataSource: 'results.swimming.ca',
        },
      });

      swimsTouched++;
    }

    log.info({ athleteId: athlete.id, sncId: snapshot.sncId, swimsTouched }, 'reconcile complete');

    return { athleteId: athlete.id, swimsTouched };
  });
}
```

- [ ] **Step 10.4: Run — verify pass**

Run: `pnpm --filter @flipturn/workers test`
Expected: 5 reconcile tests pass.

- [ ] **Step 10.5: Typecheck**

Run: `pnpm --filter @flipturn/workers typecheck`
Expected: exit 0.

- [ ] **Step 10.6: Commit**

```bash
git add apps/workers/src/reconcile.ts apps/workers/tests/reconcile.test.ts
git commit -m "feat(workers): idempotent reconciler with athlete/meet/event/swim upsert"
```

---

## Task 11: PersonalBest recompute (TDD, real DB)

**Files:**

- Create: `apps/workers/tests/personalBest.test.ts`
- Create: `apps/workers/src/personalBest.ts`

PB recompute runs after `reconcile` completes. For each `eventKey` the snapshot touched, find the best `OFFICIAL` swim and upsert the corresponding `PersonalBest` row.

- [ ] **Step 11.1: Write the failing tests**

Create `apps/workers/tests/personalBest.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { reconcile } from '../src/reconcile.js';
import { recomputePersonalBests } from '../src/personalBest.js';
import { parseStub } from '../src/parser/stub.js';

const TEST_DB = `flipturn_pb_test_${Date.now()}`;
const TEST_URL = `postgresql://flipturn:flipturn_dev@localhost:55432/${TEST_DB}?schema=public`;
let prisma: PrismaClient;

describe('recomputePersonalBests', () => {
  beforeAll(() => {
    execSync(
      `docker exec flipturn-postgres psql -U flipturn -d flipturn -c "CREATE DATABASE ${TEST_DB};"`,
      { stdio: 'pipe' },
    );
    execSync('pnpm --filter @flipturn/db exec prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: TEST_URL },
      stdio: 'pipe',
    });
    prisma = new PrismaClient({ datasources: { db: { url: TEST_URL } } });
  });

  beforeEach(async () => {
    await prisma.personalBest.deleteMany();
    await prisma.swim.deleteMany();
    await prisma.event.deleteMany();
    await prisma.meet.deleteMany();
    await prisma.athlete.deleteMany();
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
    execSync(
      `docker exec flipturn-postgres psql -U flipturn -d flipturn -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${TEST_DB}';"`,
      { stdio: 'pipe' },
    );
    execSync(
      `docker exec flipturn-postgres psql -U flipturn -d flipturn -c "DROP DATABASE ${TEST_DB};"`,
      { stdio: 'pipe' },
    );
  });

  it('creates a PB for every (athlete, eventKey) with at least one OFFICIAL swim', async () => {
    const snap = parseStub({ fixtureName: 'demo-sarah', sncId: 'x', body: '' });
    const { athleteId } = await reconcile(prisma, snap);
    await recomputePersonalBests(prisma, athleteId);

    const pbs = await prisma.personalBest.findMany({ where: { athleteId } });
    // demo-sarah has 2 swims: 100 FR LCM and 200 FR LCM → 2 distinct eventKeys
    expect(pbs).toHaveLength(2);
    const eventKeys = pbs.map((p) => p.eventKey).sort();
    expect(eventKeys).toEqual(['100_FR_LCM', '200_FR_LCM']);
  });

  it('PB points to the fastest OFFICIAL swim and ignores DQ', async () => {
    const snap = parseStub({ fixtureName: 'demo-sarah', sncId: 'x', body: '' });
    const { athleteId } = await reconcile(prisma, snap);

    // mark one swim as DQ — it should be ignored from PB calc
    await prisma.swim.updateMany({
      where: { athleteId, eventKey: '100_FR_LCM' },
      data: { status: 'DQ' },
    });

    await recomputePersonalBests(prisma, athleteId);

    const pb100 = await prisma.personalBest.findUnique({
      where: { athleteId_eventKey: { athleteId, eventKey: '100_FR_LCM' } },
    });
    expect(pb100).toBeNull();
  });

  it('updates the PB swimId when a faster swim arrives', async () => {
    const snap = parseStub({ fixtureName: 'demo-sarah', sncId: 'x', body: '' });
    const { athleteId } = await reconcile(prisma, snap);
    await recomputePersonalBests(prisma, athleteId);

    const pbBefore = await prisma.personalBest.findUnique({
      where: { athleteId_eventKey: { athleteId, eventKey: '100_FR_LCM' } },
    });

    // Replace the 100 FR swim with a faster one
    await prisma.swim.updateMany({
      where: { athleteId, eventKey: '100_FR_LCM' },
      data: { timeCentiseconds: 5000 },
    });
    await recomputePersonalBests(prisma, athleteId);

    const pbAfter = await prisma.personalBest.findUnique({
      where: { athleteId_eventKey: { athleteId, eventKey: '100_FR_LCM' } },
    });
    expect(pbAfter?.timeCentiseconds).toBe(5000);
    expect(pbAfter?.swimId).toBe(pbBefore?.swimId);
  });

  it('is idempotent', async () => {
    const snap = parseStub({ fixtureName: 'demo-sarah', sncId: 'x', body: '' });
    const { athleteId } = await reconcile(prisma, snap);
    await recomputePersonalBests(prisma, athleteId);
    const first = await prisma.personalBest.findMany({ where: { athleteId } });
    await recomputePersonalBests(prisma, athleteId);
    const second = await prisma.personalBest.findMany({ where: { athleteId } });
    expect(second).toEqual(first);
  });
});
```

- [ ] **Step 11.2: Run — verify failure**

Run: `pnpm --filter @flipturn/workers test`
Expected: `personalBest.test.ts` fails with module-not-found.

- [ ] **Step 11.3: Implement `apps/workers/src/personalBest.ts`**

```ts
import type { PrismaClient } from '@prisma/client';
import { getLogger } from './logger.js';

/**
 * Recompute every PersonalBest row for the given athlete.
 *
 * For each distinct eventKey the athlete has at least one OFFICIAL swim in,
 * find the fastest swim and upsert the corresponding PersonalBest row. PBs
 * for eventKeys with no remaining OFFICIAL swims are deleted (e.g. when a
 * swim was reclassified as DQ).
 */
export async function recomputePersonalBests(
  prisma: PrismaClient,
  athleteId: string,
): Promise<{ created: number; deleted: number }> {
  const log = getLogger();

  return prisma.$transaction(async (tx) => {
    // Find the fastest OFFICIAL swim per eventKey for this athlete.
    const swims = await tx.swim.findMany({
      where: { athleteId, status: 'OFFICIAL', isCurrent: true },
      orderBy: [{ eventKey: 'asc' }, { timeCentiseconds: 'asc' }],
    });

    const fastestByEventKey = new Map<
      string,
      { id: string; timeCentiseconds: number; swamAt: Date }
    >();
    for (const swim of swims) {
      if (!fastestByEventKey.has(swim.eventKey)) {
        fastestByEventKey.set(swim.eventKey, {
          id: swim.id,
          timeCentiseconds: swim.timeCentiseconds,
          swamAt: swim.scrapedAt, // best-effort proxy for "achievedAt"; refined when meet startDate is in scope
        });
      }
    }

    // Look up each best swim's meet startDate to use as achievedAt.
    const swimIds = [...fastestByEventKey.values()].map((s) => s.id);
    const swimDetails = await tx.swim.findMany({
      where: { id: { in: swimIds } },
      include: { meet: { select: { startDate: true } } },
    });
    const swamAtById = new Map(swimDetails.map((s) => [s.id, s.meet.startDate]));

    let created = 0;
    for (const [eventKey, best] of fastestByEventKey.entries()) {
      await tx.personalBest.upsert({
        where: { athleteId_eventKey: { athleteId, eventKey } },
        update: {
          swimId: best.id,
          timeCentiseconds: best.timeCentiseconds,
          achievedAt: swamAtById.get(best.id) ?? best.swamAt,
        },
        create: {
          athleteId,
          eventKey,
          swimId: best.id,
          timeCentiseconds: best.timeCentiseconds,
          achievedAt: swamAtById.get(best.id) ?? best.swamAt,
        },
      });
      created++;
    }

    // Delete PBs whose eventKey no longer has any OFFICIAL swim
    const orphan = await tx.personalBest.deleteMany({
      where: {
        athleteId,
        eventKey: { notIn: [...fastestByEventKey.keys()] },
      },
    });

    log.info(
      { athleteId, upsertCount: created, deletedCount: orphan.count },
      'PB recompute complete',
    );

    return { created, deleted: orphan.count };
  });
}
```

- [ ] **Step 11.4: Run — verify pass**

Run: `pnpm --filter @flipturn/workers test`
Expected: 4 PB tests pass.

- [ ] **Step 11.5: Typecheck**

Run: `pnpm --filter @flipturn/workers typecheck`
Expected: exit 0.

- [ ] **Step 11.6: Commit**

```bash
git add apps/workers/src/personalBest.ts apps/workers/tests/personalBest.test.ts
git commit -m "feat(workers): personal best recompute with DQ handling"
```

---

## Task 12: Worker pipeline + heartbeat

**Files:**

- Create: `apps/workers/src/heartbeat.ts`
- Create: `apps/workers/src/worker.ts`

This task wires fetch → parse (stub) → reconcile → recompute together as the BullMQ job processor, and starts a heartbeat key.

- [ ] **Step 12.1: Create `apps/workers/src/heartbeat.ts`**

```ts
import { getRedis } from './redis.js';
import { getLogger } from './logger.js';

const HEARTBEAT_KEY = 'workers:heartbeat';
const TTL_SECONDS = 90; // beat every 60s, alert if older than 90s

let _interval: NodeJS.Timeout | undefined;

export function startHeartbeat(): void {
  if (_interval) return;
  const tick = async () => {
    try {
      await getRedis().set(HEARTBEAT_KEY, Date.now().toString(), 'EX', TTL_SECONDS);
    } catch (err) {
      getLogger().error({ err }, 'heartbeat write failed');
    }
  };
  void tick();
  _interval = setInterval(tick, 60_000);
}

export function stopHeartbeat(): void {
  if (_interval) {
    clearInterval(_interval);
    _interval = undefined;
  }
}
```

- [ ] **Step 12.2: Create `apps/workers/src/worker.ts`**

```ts
import { Worker, type Job } from 'bullmq';
import { getPrisma } from '@flipturn/db';
import { SCRAPE_ATHLETE_QUEUE, type ScrapeAthleteJob } from './queue.js';
import { getRedis } from './redis.js';
import { getLogger } from './logger.js';
import { politeFetch, FetchBlockedError } from './fetch.js';
import { parseStub } from './parser/stub.js';
import { reconcile } from './reconcile.js';
import { recomputePersonalBests } from './personalBest.js';

export function startScrapeWorker(): Worker<ScrapeAthleteJob> {
  const log = getLogger();

  const worker = new Worker<ScrapeAthleteJob>(
    SCRAPE_ATHLETE_QUEUE,
    async (job: Job<ScrapeAthleteJob>) => {
      const { athleteId, sncId, fixtureName } = job.data;
      log.info({ jobId: job.id, athleteId, sncId, fixtureName }, 'job started');

      // In Plan 2, fixtureName branches us into the stub parser without fetching.
      // Plan 3 flips this to: real URL → real fetch → real parser.
      let body = '';
      if (!fixtureName) {
        const url = buildSourceUrl(sncId);
        try {
          const result = await politeFetch({ url, sncId });
          body = result.body;
        } catch (err) {
          if (err instanceof FetchBlockedError) {
            log.warn({ jobId: job.id, err: err.message }, 'fetch blocked; skipping');
            return { skipped: true as const };
          }
          throw err;
        }
      }

      const snapshot = parseStub({ fixtureName, sncId, body });

      const prisma = getPrisma();
      const { athleteId: dbAthleteId } = await reconcile(prisma, snapshot);
      await recomputePersonalBests(prisma, dbAthleteId);

      log.info({ jobId: job.id, dbAthleteId }, 'job complete');
      return { dbAthleteId, swims: snapshot.swims.length };
    },
    {
      connection: getRedis(),
      concurrency: 1, // Plan 2 keeps it serial; Plan 3 may bump
    },
  );

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'job failed');
  });

  worker.on('completed', (job) => {
    log.debug({ jobId: job.id }, 'job completed');
  });

  return worker;
}

/**
 * Build the source URL for an SNC athlete. Plan 3 fills this in based on
 * ADR 0002's findings; here it's a placeholder that's only reached if a
 * real (non-fixture) job is enqueued. Plan 3's first step replaces this.
 */
function buildSourceUrl(sncId: string): string {
  return `https://results.swimming.ca/swimmers/${encodeURIComponent(sncId)}`;
}
```

- [ ] **Step 12.3: Wire entrypoint to start the worker**

Replace `apps/workers/src/index.ts`:

```ts
import { getEnv } from './env.js';
import { getLogger } from './logger.js';
import { initSentry } from './sentry.js';
import { startScrapeWorker } from './worker.js';
import { startHeartbeat, stopHeartbeat } from './heartbeat.js';
import { disconnectRedis } from './redis.js';

async function main() {
  getEnv();
  initSentry();
  const log = getLogger();
  log.info('flipturn workers starting');

  const worker = startScrapeWorker();
  startHeartbeat();
  log.info('worker + heartbeat running; ctrl-c to stop');

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'shutting down');
    stopHeartbeat();
    await worker.close();
    await disconnectRedis();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal:', err);
  process.exit(1);
});
```

- [ ] **Step 12.4: Smoke-test**

In one terminal: `pnpm workers:start`
Expected: log lines showing worker + heartbeat starting, then waiting.

In another terminal, enqueue a stub job by writing a tiny script `/tmp/enqueue.ts`:

```ts
import { enqueueScrapeAthlete } from '../apps/workers/src/queue.js';
import { disconnectRedis } from '../apps/workers/src/redis.js';
const id = await enqueueScrapeAthlete({
  athleteId: 'manual-1',
  sncId: 'DEMO-SARAH-001',
  fixtureName: 'demo-sarah',
});
console.log('enqueued', id);
await disconnectRedis();
```

Run: `cd apps/workers && pnpm exec tsx /tmp/enqueue.ts`
Expected: in the worker's terminal, log lines appear showing job started, reconcile complete, PB recompute complete, job complete. The worker should then idle waiting for the next job.

Stop the worker (Ctrl-C). Verify graceful shutdown logs.

Verify in DB: `docker exec flipturn-postgres psql -U flipturn -d flipturn -c "SELECT \"sncId\", \"primaryName\" FROM \"Athlete\";"` and `... FROM \"PersonalBest\";` should show Sarah's records (in addition to seed data).

- [ ] **Step 12.5: Typecheck + format**

Run: `pnpm --filter @flipturn/workers typecheck` and `pnpm format:check`
Expected: both exit 0.

- [ ] **Step 12.6: Commit**

```bash
git add apps/workers/src/heartbeat.ts apps/workers/src/worker.ts apps/workers/src/index.ts
git commit -m "feat(workers): pipeline (fetch->parse->reconcile->PB) + heartbeat"
```

---

## Task 13: Scheduler — daily cron via BullMQ repeatable jobs

**Files:**

- Create: `apps/workers/src/scheduler.ts`
- Modify: `apps/workers/src/index.ts` (call `startScheduler` at boot)

- [ ] **Step 13.1: Implement `apps/workers/src/scheduler.ts`**

```ts
import { getPrisma } from '@flipturn/db';
import { enqueueScrapeAthlete } from './queue.js';
import { getLogger } from './logger.js';

const SCHEDULER_REPEAT_KEY = 'flipturn-scheduler-tick';

/**
 * Enqueue a scrape job for every Athlete with sncId set.
 * Called by the BullMQ repeatable job (every 24h).
 */
export async function tickScheduler(): Promise<{ enqueued: number }> {
  const prisma = getPrisma();
  const log = getLogger();
  const athletes = await prisma.athlete.findMany({
    where: { sncId: { not: undefined } },
    select: { id: true, sncId: true },
  });
  for (const a of athletes) {
    await enqueueScrapeAthlete(
      { athleteId: a.id, sncId: a.sncId },
      // Spread over 5min to smear the burst.
      { delay: Math.floor(Math.random() * 5 * 60 * 1000) },
    );
  }
  log.info({ enqueued: athletes.length }, 'scheduler tick complete');
  return { enqueued: athletes.length };
}

/**
 * Register a BullMQ repeatable job that calls tickScheduler() every 24h.
 * The actual processing happens in worker.ts via a special job name.
 */
export async function startScheduler(): Promise<void> {
  const { Queue } = await import('bullmq');
  const { getRedis } = await import('./redis.js');
  const queue = new Queue('flipturn-scheduler', { connection: getRedis() });
  await queue.add(
    SCHEDULER_REPEAT_KEY,
    {},
    {
      repeat: { every: 24 * 60 * 60 * 1000 }, // 24h
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 100 },
    },
  );
  getLogger().info('scheduler registered (every 24h)');
}
```

- [ ] **Step 13.2: Add a scheduler worker in `worker.ts`**

Edit `apps/workers/src/worker.ts`. Add a second `startSchedulerWorker` export below `startScrapeWorker`:

```ts
export function startSchedulerWorker(): Worker {
  const log = getLogger();
  return new Worker(
    'flipturn-scheduler',
    async () => {
      const { tickScheduler } = await import('./scheduler.js');
      await tickScheduler();
    },
    { connection: getRedis(), concurrency: 1 },
  ).on('failed', (job, err) => log.error({ jobId: job?.id, err }, 'scheduler tick failed'));
}
```

- [ ] **Step 13.3: Wire scheduler into `index.ts`**

Edit `apps/workers/src/index.ts` to start both workers and register the schedule:

```ts
import { getEnv } from './env.js';
import { getLogger } from './logger.js';
import { initSentry } from './sentry.js';
import { startScrapeWorker, startSchedulerWorker } from './worker.js';
import { startScheduler } from './scheduler.js';
import { startHeartbeat, stopHeartbeat } from './heartbeat.js';
import { disconnectRedis } from './redis.js';

async function main() {
  getEnv();
  initSentry();
  const log = getLogger();
  log.info('flipturn workers starting');

  const scrapeWorker = startScrapeWorker();
  const schedulerWorker = startSchedulerWorker();
  await startScheduler();
  startHeartbeat();
  log.info('workers + scheduler + heartbeat running; ctrl-c to stop');

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'shutting down');
    stopHeartbeat();
    await scrapeWorker.close();
    await schedulerWorker.close();
    await disconnectRedis();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal:', err);
  process.exit(1);
});
```

- [ ] **Step 13.4: Smoke-test**

Run: `pnpm workers:start`
Expected: log lines showing both workers start + scheduler registers. Within ~15s the scheduler tick runs (BullMQ may run the first tick immediately depending on internal timing) and enqueues a scrape job per Athlete in the DB. The scrape worker picks them up. After all jobs complete, the worker idles.

Stop with Ctrl-C. Verify graceful shutdown.

- [ ] **Step 13.5: Typecheck + format**

Run: `pnpm --filter @flipturn/workers typecheck` and `pnpm format:check`
Expected: both exit 0.

- [ ] **Step 13.6: Commit**

```bash
git add apps/workers/src/scheduler.ts apps/workers/src/worker.ts apps/workers/src/index.ts
git commit -m "feat(workers): daily scheduler via BullMQ repeatable jobs"
```

---

## Task 14: End-to-end pipeline integration test

**Files:**

- Create: `apps/workers/tests/pipeline.integration.test.ts`

This test starts a real BullMQ worker against a transient Postgres + dev Redis, enqueues a job with `fixtureName='demo-sarah'`, and asserts the DB has the expected athlete + swims + PBs after the job completes.

- [ ] **Step 14.1: Write the test**

Create `apps/workers/tests/pipeline.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { Queue, Worker, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { reconcile } from '../src/reconcile.js';
import { recomputePersonalBests } from '../src/personalBest.js';
import { parseStub } from '../src/parser/stub.js';

const TEST_DB = `flipturn_pipeline_test_${Date.now()}`;
const TEST_URL = `postgresql://flipturn:flipturn_dev@localhost:55432/${TEST_DB}?schema=public`;
const TEST_REDIS_URL = 'redis://localhost:56379';
const QUEUE_NAME = `pipeline-test-${Date.now()}`;

let prisma: PrismaClient;
let redis: Redis;
let queue: Queue;
let worker: Worker;
let events: QueueEvents;

describe('pipeline integration', () => {
  beforeAll(async () => {
    execSync(
      `docker exec flipturn-postgres psql -U flipturn -d flipturn -c "CREATE DATABASE ${TEST_DB};"`,
      { stdio: 'pipe' },
    );
    execSync('pnpm --filter @flipturn/db exec prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: TEST_URL },
      stdio: 'pipe',
    });

    prisma = new PrismaClient({ datasources: { db: { url: TEST_URL } } });
    redis = new Redis(TEST_REDIS_URL, { maxRetriesPerRequest: null });
    queue = new Queue(QUEUE_NAME, { connection: redis });
    events = new QueueEvents(QUEUE_NAME, { connection: redis });
    await events.waitUntilReady();

    worker = new Worker(
      QUEUE_NAME,
      async (job) => {
        const { sncId, fixtureName } = job.data as {
          sncId: string;
          fixtureName?: string;
        };
        const snap = parseStub({ sncId, fixtureName, body: '' });
        const { athleteId } = await reconcile(prisma, snap);
        await recomputePersonalBests(prisma, athleteId);
        return { athleteId };
      },
      { connection: redis, concurrency: 1 },
    );
    await worker.waitUntilReady();
  });

  afterAll(async () => {
    await worker?.close();
    await events?.close();
    await queue?.close();
    await redis?.quit();
    if (prisma) await prisma.$disconnect();
    execSync(
      `docker exec flipturn-postgres psql -U flipturn -d flipturn -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${TEST_DB}';"`,
      { stdio: 'pipe' },
    );
    execSync(
      `docker exec flipturn-postgres psql -U flipturn -d flipturn -c "DROP DATABASE ${TEST_DB};"`,
      { stdio: 'pipe' },
    );
  });

  it('processes a stub job end-to-end: athlete + swims + PBs in DB', async () => {
    const job = await queue.add('scrape', {
      athleteId: 'pipeline-1',
      sncId: 'DEMO-SARAH-001',
      fixtureName: 'demo-sarah',
    });
    const result = await job.waitUntilFinished(events, 20_000);
    expect(result).toMatchObject({ athleteId: expect.any(String) });

    const athlete = await prisma.athlete.findUnique({
      where: { sncId: 'DEMO-SARAH-001' },
    });
    expect(athlete).not.toBeNull();

    const swims = await prisma.swim.findMany({
      where: { athleteId: athlete!.id },
    });
    expect(swims).toHaveLength(2);

    const pbs = await prisma.personalBest.findMany({
      where: { athleteId: athlete!.id },
    });
    expect(pbs).toHaveLength(2);
  });
});
```

- [ ] **Step 14.2: Run the integration test**

Run: `pnpm --filter @flipturn/workers test pipeline.integration`
Expected: 1 test passes within ~5 seconds.

- [ ] **Step 14.3: Run all worker tests together**

Run: `pnpm --filter @flipturn/workers test`
Expected: all tests across all suites pass (politeness, archive, stub, reconcile, personalBest, pipeline).

- [ ] **Step 14.4: Commit**

```bash
git add apps/workers/tests/pipeline.integration.test.ts
git commit -m "test(workers): end-to-end pipeline integration with stub parser"
```

---

## Task 15: README updates + final integration check

**Files:**

- Modify: root `README.md` (mention `pnpm workers:dev`)
- Modify: `apps/workers/README.md` (note the stub parser limitation)

- [ ] **Step 15.1: Update root `README.md`**

Read the current README. Append a new section after the existing Bootstrap block:

```markdown
## Workers

Run the BullMQ scrape worker locally (after `pnpm dev:up` brings up Postgres + Redis):

\`\`\`bash
pnpm workers:dev # tsx --watch (auto-reloads on src changes)
pnpm workers:start # one-shot run
pnpm workers:test # run worker tests
\`\`\`

Plan 2 ships a **stub parser** that returns hardcoded snapshots for `fixtureName="demo-sarah"` and `fixtureName="demo-benji"`. Plan 3 will replace it with the real `results.swimming.ca` parser based on ADR 0002.
```

(Use real triple-backticks in the file, not escaped.)

- [ ] **Step 15.2: Update `apps/workers/README.md`**

Append a "Current state" section at the bottom:

```markdown
## Current state (Plan 2)

This package ships the worker plumbing only:

- ✅ BullMQ + Redis client + queue
- ✅ Politeness (token bucket, robots.txt cache, user-agent)
- ✅ Raw artifact archive on disk
- ✅ Idempotent reconciler against Postgres
- ✅ PersonalBest recompute
- ✅ Daily scheduler via BullMQ repeatable jobs
- ✅ Heartbeat key in Redis
- ✅ End-to-end integration test against the stub parser
- 🟡 **Stub parser** returning hardcoded data — replaced in Plan 3

To enqueue a job manually for local testing:

\`\`\`ts
import { enqueueScrapeAthlete } from './src/queue.js';
await enqueueScrapeAthlete({
athleteId: '<some athlete id>',
sncId: 'DEMO-SARAH-001',
fixtureName: 'demo-sarah',
});
\`\`\`
```

(Use real triple-backticks.)

- [ ] **Step 15.3: Run all gates**

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm format:check
```

All four should exit 0. The full test suite at this point includes:

- `@flipturn/db`: 2 tests (migration smoke)
- `@flipturn/shared`: 29 tests (time, eventKey, schemas)
- `@flipturn/workers`: politeness (5+) + archive (4) + stub (4) + reconcile (5) + personalBest (4) + pipeline (1) = ~23 tests

Total: ~54 tests passing.

- [ ] **Step 15.4: Verify a full clean install + run still works**

```bash
rm -rf node_modules apps/*/node_modules packages/*/node_modules
pnpm install
pnpm typecheck
pnpm test
```

Expected: clean install succeeds (postinstall fires `prisma generate`); typecheck passes; all tests pass.

- [ ] **Step 15.5: Final commit**

```bash
git add README.md apps/workers/README.md
git commit -m "docs(workers): document plan 2 scope and stub parser limitation"
```

---

## Acceptance criteria for Plan 2

This plan is complete when:

- [ ] `apps/workers` package exists with all modules in the file map
- [ ] ADR 0002 is committed with the spike's findings
- [ ] Spike fixtures are committed under `apps/workers/fixtures/`
- [ ] `pnpm workers:start` boots a worker process that registers two BullMQ queues, a heartbeat, and a daily scheduler — and shuts down cleanly on SIGINT/SIGTERM
- [ ] `pnpm workers:test` passes all worker tests
- [ ] Politeness layer enforces 1 req / 5s per host and a daily budget
- [ ] Robots.txt is fetched and cached for 24h
- [ ] Raw responses are archived under `data/raw/<host>/<sncId>/<ISO>.<ext>`
- [ ] Reconciler is idempotent
- [ ] PersonalBest recompute correctly handles DQ swims and updates on faster times
- [ ] End-to-end integration test passes (stub job → DB has athlete + swims + PBs)
- [ ] All commits use conventional-commit style
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm format:check` all pass

When all checked, hand off to Plan 3 — replace the stub parser with the real one keyed on ADR 0002's findings.

## Open items deferred to Plan 3

- Real parser (`results.swimming.ca` HTML/JSON → `AthleteSnapshot`)
- Wiring the real `buildSourceUrl()` (currently a Plan 2 placeholder)
- Removing the `fixtureName` branch from `worker.ts` (Plan 3 keeps it for tests but always fetches in production paths)
- Spike-driven changes to politeness defaults (e.g. tighter rate limits if the source asks)

## Open items deferred to Plan 4+

- Triggering on-demand backfill from the API onboarding flow
- API endpoint to peek at scrape job status
- Sentry alert routing
- Production cron schedule (currently 24h; may want a cheaper "weekly catch-up" plus event-driven scrapes)
