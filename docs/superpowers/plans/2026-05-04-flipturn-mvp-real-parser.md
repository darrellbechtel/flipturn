# Flip Turn MVP — Real Parser + Integration Plan (Plan 3 of 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Plan series:** This is plan 3 of 6 derived from [`docs/superpowers/specs/2026-05-04-flipturn-mvp-design.md`](../specs/2026-05-04-flipturn-mvp-design.md).

- ✅ Plan 1 — Foundation (monorepo + db + shared) — landed
- ✅ Plan 2 — Spike + Worker infrastructure with stub parser — landed
- **Plan 3 — Real parser + integration (this plan)**
- Plan 4 — API (Hono + magic-link auth + endpoints)
- Plan 5 — Mobile (Expo + auth + onboarding + screens)
- Plan 6 — Hosting + closed-beta launch

**Goal:** Swap Plan 2's stub parser for real cheerio implementations against the captured SNC fixtures (Ryan Cochrane athlete page + 2026 Speedo Canadian Open meet page). After this plan, `pnpm workers:start` ingests live `www.swimming.ca` athlete pages end-to-end with no stub code anywhere. Also addresses the four important follow-ups from Plan 2's final code review.

**Architecture:** New `apps/workers/src/parser/athletePage.ts` (cheerio) and `parser/meetPage.ts` (cheerio), driven by golden tests against `apps/workers/fixtures/snc-athlete-sample.html` and `snc-meet-sample.html`. Worker dispatches by URL pattern: athlete URLs → `parseAthletePage`, meet URLs → `parseMeetIndex`. `politeFetch` learns to honor `Retry-After` on 429s (per ADR 0002). The `dataSource` field is parameterized on each `AthleteSnapshot` so `Swim.dataSource` reflects the real origin host. Plan 2's stub parser is **deleted**.

**Tech Stack:** Same as Plan 2, plus `cheerio@^1.0.0` (already added in Plan 2's `package.json`). No new top-level deps.

**Recommended execution:** Use `superpowers:subagent-driven-development` with `model: "opus"` per the project's preference (see `~/.claude/projects/-Users-darrell-Documents-ai-projects-flipturn/memory/feedback_use_opus_agents.md`).

---

## Context the implementer needs

### Spike findings to honor (ADR 0002)

- Two hosts in scope:
  - `https://www.swimming.ca/swimmer/<numeric_id>/` — server-rendered athlete profile, single big swims table.
  - `https://results.swimming.ca/<meet_slug>/` — server-rendered SPLASH Meet Manager 11 index, meet header + per-event PDF links.
- **Cloudflare WAF triggers 429 with `retry-after: 10` at ~3 req/s.** Our 1 req/5s default has 12× headroom but `politeFetch` must still observe `Retry-After`.
- Athlete page does **not** include athlete gender — derive from per-swim event headers (e.g. "Girls 100 Freestyle" implies F).
- Meet date format on SPLASH is unusual: `"9- - 11-4-2026"` → start `2026-04-09`, end `2026-04-11`. Helper required.
- Time format on athlete page is `M:SS.cc` or `SS.cc` — already handled by `parseSwimTime` in `@flipturn/shared`.
- Some swim rows have **no SNC meet ID** (SwimRankings can't link). Synthesize a stable `meetExternalId` for these via a hash of `(meetName, startDate)` so the reconciler's `Meet.externalId @unique` upsert works.

### Plan 2 review follow-ups in scope for Plan 3

| Issue                                            | Source           | Task       |
| ------------------------------------------------ | ---------------- | ---------- |
| `politeFetch` doesn't honor `Retry-After` on 429 | Final review gap | Task 1     |
| `dataSource: 'results.swimming.ca'` hardcoded    | M-7              | Task 6     |
| `worker.ts buildSourceUrl` placeholder           | M-8              | Task 5 + 7 |
| Redundant query in `recomputePersonalBests`      | I-1              | Task 9     |
| Missing scheduler unit test                      | I-3              | Task 9     |
| Stub parser dead-end (delete after Plan 3)       | M-4, M-6         | Task 7     |

### Out of scope for Plan 3 (deferred again)

- Politeness token-bucket race condition under concurrency > 1 (I-5) — only matters when we bump `concurrency` past 1; Plan 6 (hosting/scaling) revisits.
- `pnpm workers:dev/start` switching to Node `--env-file` (M-3) — minor DX; defer to Plan 6.
- Live smoke against `www.swimming.ca` — covered as a final optional step here, but not blocking. The integration test against the captured fixture is the main acceptance gate.

---

## File map (created/modified by this plan)

```
apps/workers/
├── src/
│   ├── fetch.ts                       (MODIFY: 429/Retry-After handling)
│   ├── politeness.ts                  (MODIFY: expose acquireToken with explicit wait override; new applyBackoff helper)
│   ├── queue.ts                       (MODIFY: drop fixtureName field from ScrapeAthleteJob)
│   ├── reconcile.ts                   (MODIFY: dataSource from snapshot; collapse PB-call dependence)
│   ├── personalBest.ts                (MODIFY: collapse redundant query)
│   ├── scheduler.ts                   (MODIFY: scheduler tested in Task 9)
│   ├── url.ts                         (CREATE: buildAthleteUrl, buildMeetUrl, classifyUrl)
│   ├── worker.ts                      (REWRITE: real fetcher + parser; no fixture branch)
│   ├── parser/
│   │   ├── types.ts                   (MODIFY: add MeetSnapshot, dataSource on AthleteSnapshot)
│   │   ├── stub.ts                    (DELETE)
│   │   ├── helpers.ts                 (CREATE: parseSplashDateRange, deriveGender, hashMeetExternalId)
│   │   ├── athletePage.ts             (CREATE: parseAthletePage cheerio impl)
│   │   └── meetPage.ts                (CREATE: parseMeetIndex cheerio impl)
│   └── index.ts                       (no change — wiring is in worker.ts/scheduler.ts)
├── tests/
│   ├── fetch.test.ts                  (CREATE: 429/Retry-After unit test)
│   ├── stub.test.ts                   (DELETE)
│   ├── helpers.test.ts                (CREATE: parser helper TDD)
│   ├── athletePage.test.ts            (CREATE: parser TDD against fixture)
│   ├── meetPage.test.ts               (CREATE: parser TDD against fixture)
│   ├── url.test.ts                    (CREATE: URL builder TDD)
│   ├── scheduler.test.ts              (CREATE: tickScheduler unit test)
│   ├── reconcile.test.ts              (MODIFY: replace stub usage with real parser)
│   ├── personalBest.test.ts           (MODIFY: replace stub usage with real parser)
│   └── pipeline.integration.test.ts   (REWRITE: real parser against fixture, mocked fetch)
└── fixtures/                          (unchanged from Plan 2)

docs/adr/0003-parser-architecture.md   (CREATE: dispatch by URL, retry semantics, gender derivation)
```

---

## Task 1: 429 / Retry-After handling in `politeFetch` (TDD)

**Files:**

- Create: `apps/workers/tests/fetch.test.ts`
- Modify: `apps/workers/src/fetch.ts`
- Modify: `apps/workers/src/politeness.ts` (add `applyBackoff` helper)

**Why this task is first:** Once we point `politeFetch` at the live source, a 429 without backoff would compound the rate-limit violation. ADR 0002 explicitly mandates `Retry-After` handling. Implementing it before any non-fixture fetch is non-negotiable.

### Step 1.1: Add a `applyBackoff` helper to `politeness.ts`

Append to `apps/workers/src/politeness.ts`:

```ts
/**
 * Push the host's "last touched" key forward by `delayMs`. The next
 * `acquireToken` call for this host will block until that delay passes.
 * Used to honor 429 / Retry-After server signals.
 */
export async function applyBackoff(redis: Redis, host: string, delayMs: number): Promise<void> {
  const futureWindow = Date.now() + delayMs;
  // 1h TTL matches the existing key TTL.
  await redis.set(`politeness:last:${host}`, futureWindow.toString(), 'EX', 60 * 60);
}
```

The `applyBackoff` writes a _future_ timestamp into the same key the token-bucket reads; on the next `acquireToken` the wait calculation becomes `(future + rateLimitMs) - now > 0` and naturally blocks.

### Step 1.2: Write the failing tests

Create `apps/workers/tests/fetch.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { Redis } from 'ioredis';
import { resetTokenBucket, resetRobotsCache, applyBackoff } from '../src/politeness.js';

const TEST_REDIS_URL = 'redis://localhost:56379';
const redis = new Redis(TEST_REDIS_URL, { maxRetriesPerRequest: null });

describe('applyBackoff', () => {
  beforeEach(async () => {
    await resetTokenBucket(redis, 'backoff-test.example.com');
  });

  afterAll(async () => {
    await resetTokenBucket(redis, 'backoff-test.example.com');
    await redis.quit();
  });

  it('forces the next acquireToken on the host to wait at least delayMs', async () => {
    const { acquireToken } = await import('../src/politeness.js');
    await applyBackoff(redis, 'backoff-test.example.com', 200);

    const start = Date.now();
    await acquireToken(redis, 'backoff-test.example.com', { rateLimitMs: 0 });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(190);
    expect(elapsed).toBeLessThan(400);
  });
});

describe('politeFetch on 429', () => {
  it('parses Retry-After (seconds) and re-throws as a recoverable error', async () => {
    // Mock undici.request to return 429 with a Retry-After: 10 header.
    vi.resetModules();
    vi.doMock('undici', () => ({
      request: vi.fn().mockResolvedValue({
        statusCode: 429,
        headers: { 'content-type': 'text/html', 'retry-after': '10' },
        body: { text: async () => '' },
      }),
    }));

    // Re-import politeFetch with the mocked undici in place.
    const { politeFetch, FetchRetryError } = await import('../src/fetch.js');

    await resetRobotsCache(redis, 'host-429.example.com');

    await expect(
      politeFetch({ url: 'http://host-429.example.com/page', sncId: 'TEST' }),
    ).rejects.toThrow(FetchRetryError);

    vi.doUnmock('undici');
  });

  it('parses Retry-After (HTTP-date) and re-throws as recoverable', async () => {
    vi.resetModules();
    const future = new Date(Date.now() + 5000).toUTCString();
    vi.doMock('undici', () => ({
      request: vi.fn().mockResolvedValue({
        statusCode: 429,
        headers: { 'content-type': 'text/html', 'retry-after': future },
        body: { text: async () => '' },
      }),
    }));

    const { politeFetch, FetchRetryError } = await import('../src/fetch.js');

    await resetRobotsCache(redis, 'host-429-date.example.com');

    await expect(
      politeFetch({ url: 'http://host-429-date.example.com/page', sncId: 'TEST' }),
    ).rejects.toThrow(FetchRetryError);

    vi.doUnmock('undici');
  });
});
```

### Step 1.3: Run — verify failure

Run: `pnpm --filter @flipturn/workers test`
Expected: `fetch.test.ts` and `applyBackoff` tests fail. Existing tests still pass.

### Step 1.4: Implement `applyBackoff` in `politeness.ts`

(Already written in Step 1.1 — paste it now into the file. Run the file's existing eslint/prettier passes after.)

### Step 1.5: Add `FetchRetryError` and 429 handling in `fetch.ts`

Replace `apps/workers/src/fetch.ts` (read the current state first to avoid deleting unrelated code):

```ts
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
    // Drain the body so the connection can be reused.
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

  // integer seconds
  const seconds = Number.parseInt(raw, 10);
  if (Number.isFinite(seconds) && `${seconds}` === raw.trim()) {
    return clamp(seconds * 1000);
  }

  // HTTP-date
  const ts = Date.parse(raw);
  if (Number.isFinite(ts)) {
    return clamp(ts - Date.now());
  }

  return MIN_BACKOFF_MS;
}

function clamp(ms: number): number {
  return Math.max(MIN_BACKOFF_MS, Math.min(MAX_BACKOFF_MS, ms));
}
```

### Step 1.6: Run — verify pass

Run: `pnpm --filter @flipturn/workers test`
Expected: 26 tests pass total (24 from Plan 2 + 2 new in fetch.test.ts + 1 applyBackoff test). If `applyBackoff` test fails because the wait was 0 (no rate limit), confirm `acquireToken`'s wait formula reads the future timestamp. The fix may be needed in `acquireToken` if it uses `Math.max(0, last + rateLimitMs - now)` and the `last` value is in the future — that already works correctly (`future + 0 - now` is positive, so it waits). No change needed to `acquireToken`.

### Step 1.7: Typecheck + format

Run: `pnpm --filter @flipturn/workers typecheck` — exit 0
Run: `pnpm format:check` — exit 0

### Step 1.8: Commit

```bash
git add apps/workers/src/fetch.ts apps/workers/src/politeness.ts apps/workers/tests/fetch.test.ts
git commit -m "feat(workers): honor Retry-After on 429 with politeness backoff"
```

---

## Task 2: Parser helpers (date range, gender derivation, meet ID hash)

**Files:**

- Create: `apps/workers/src/parser/helpers.ts`
- Create: `apps/workers/tests/helpers.test.ts`

The parsers in Tasks 3-4 will need three SNC-specific helpers:

1. `parseSplashDateRange("9- - 11-4-2026")` → `{ startDate: 2026-04-09, endDate: 2026-04-11 }`
2. `deriveGenderFromEventHeader("Girls 100 Freestyle")` → `'F'`
3. `hashMeetExternalId({ meetName, startDate })` → stable string for synthesized IDs

### Step 2.1: Write the failing tests

Create `apps/workers/tests/helpers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  parseSplashDateRange,
  deriveGenderFromEventHeader,
  hashMeetExternalId,
} from '../src/parser/helpers.js';

describe('parseSplashDateRange', () => {
  it('parses the canonical SPLASH range format', () => {
    expect(parseSplashDateRange('9- - 11-4-2026')).toEqual({
      startDate: new Date(Date.UTC(2026, 3, 9)),
      endDate: new Date(Date.UTC(2026, 3, 11)),
    });
  });

  it('parses single-day events', () => {
    expect(parseSplashDateRange('15-3-2025')).toEqual({
      startDate: new Date(Date.UTC(2025, 2, 15)),
      endDate: new Date(Date.UTC(2025, 2, 15)),
    });
  });

  it('parses ranges with two-digit months', () => {
    expect(parseSplashDateRange('1- - 3-12-2024')).toEqual({
      startDate: new Date(Date.UTC(2024, 11, 1)),
      endDate: new Date(Date.UTC(2024, 11, 3)),
    });
  });

  it('throws on unrecognized formats', () => {
    expect(() => parseSplashDateRange('')).toThrow();
    expect(() => parseSplashDateRange('April 9 2026')).toThrow();
    expect(() => parseSplashDateRange('9-13-2026')).toThrow(); // invalid month
    expect(() => parseSplashDateRange('32-4-2026')).toThrow(); // invalid day
  });
});

describe('deriveGenderFromEventHeader', () => {
  it('returns F for Girls/Women/Female', () => {
    expect(deriveGenderFromEventHeader('Girls 100 Freestyle')).toBe('F');
    expect(deriveGenderFromEventHeader('Women 200 IM')).toBe('F');
    expect(deriveGenderFromEventHeader('Female 50 Free')).toBe('F');
  });

  it('returns M for Boys/Men/Male', () => {
    expect(deriveGenderFromEventHeader('Boys 100 Backstroke')).toBe('M');
    expect(deriveGenderFromEventHeader('Men 1500 Free')).toBe('M');
    expect(deriveGenderFromEventHeader('Male 50 Fly')).toBe('M');
  });

  it('returns null when not present', () => {
    expect(deriveGenderFromEventHeader('Mixed 4x100 Free Relay')).toBeNull();
    expect(deriveGenderFromEventHeader('Open 100 IM')).toBeNull();
    expect(deriveGenderFromEventHeader('')).toBeNull();
  });

  it('matches case-insensitively', () => {
    expect(deriveGenderFromEventHeader('GIRLS 100 FREESTYLE')).toBe('F');
    expect(deriveGenderFromEventHeader('boys 100')).toBe('M');
  });
});

describe('hashMeetExternalId', () => {
  it('produces a stable, prefixed hash', () => {
    const a = hashMeetExternalId({
      meetName: 'Some Spring Open',
      startDate: new Date('2026-04-01'),
    });
    const b = hashMeetExternalId({
      meetName: 'Some Spring Open',
      startDate: new Date('2026-04-01'),
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^synth-[a-f0-9]{12}$/);
  });

  it('produces different hashes for different inputs', () => {
    const a = hashMeetExternalId({
      meetName: 'A Meet',
      startDate: new Date('2026-04-01'),
    });
    const b = hashMeetExternalId({
      meetName: 'B Meet',
      startDate: new Date('2026-04-01'),
    });
    const c = hashMeetExternalId({
      meetName: 'A Meet',
      startDate: new Date('2026-04-02'),
    });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});
```

### Step 2.2: Run — verify failure

Run: `pnpm --filter @flipturn/workers test helpers`
Expected: all 3 describe blocks fail with module-not-found.

### Step 2.3: Implement `apps/workers/src/parser/helpers.ts`

```ts
import { createHash } from 'node:crypto';
import type { Gender } from '@flipturn/shared';

const SPLASH_RANGE_RE =
  /^(?<startDay>\d{1,2})-\s*-\s*(?<endDay>\d{1,2})-(?<month>\d{1,2})-(?<year>\d{4})$/;
const SPLASH_SINGLE_RE = /^(?<day>\d{1,2})-(?<month>\d{1,2})-(?<year>\d{4})$/;

export interface DateRange {
  readonly startDate: Date;
  readonly endDate: Date;
}

/**
 * Parse SPLASH Meet Manager 11's date range format. Examples:
 *   "9- - 11-4-2026"  → 2026-04-09 to 2026-04-11
 *   "15-3-2025"       → 2025-03-15 (single day)
 */
export function parseSplashDateRange(input: string): DateRange {
  const trimmed = input.trim();
  const range = SPLASH_RANGE_RE.exec(trimmed);
  if (range?.groups) {
    const startDay = Number.parseInt(range.groups.startDay!, 10);
    const endDay = Number.parseInt(range.groups.endDay!, 10);
    const month = Number.parseInt(range.groups.month!, 10);
    const year = Number.parseInt(range.groups.year!, 10);
    if (!isValidYmd(year, month, startDay) || !isValidYmd(year, month, endDay)) {
      throw new Error(`parseSplashDateRange: invalid date in ${JSON.stringify(input)}`);
    }
    return {
      startDate: new Date(Date.UTC(year, month - 1, startDay)),
      endDate: new Date(Date.UTC(year, month - 1, endDay)),
    };
  }
  const single = SPLASH_SINGLE_RE.exec(trimmed);
  if (single?.groups) {
    const day = Number.parseInt(single.groups.day!, 10);
    const month = Number.parseInt(single.groups.month!, 10);
    const year = Number.parseInt(single.groups.year!, 10);
    if (!isValidYmd(year, month, day)) {
      throw new Error(`parseSplashDateRange: invalid date in ${JSON.stringify(input)}`);
    }
    const d = new Date(Date.UTC(year, month - 1, day));
    return { startDate: d, endDate: d };
  }
  throw new Error(`parseSplashDateRange: unrecognized format: ${JSON.stringify(input)}`);
}

function isValidYmd(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  // Round-trip via Date.UTC; reject if the components don't survive (e.g. 2025-02-30).
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

const FEMALE_PATTERNS = [/\bgirls?\b/i, /\bwomen?\b/i, /\bfemale\b/i];
const MALE_PATTERNS = [/\bboys?\b/i, /\bmen\b/i, /\bmale\b/i];

export function deriveGenderFromEventHeader(header: string): Gender | null {
  if (!header) return null;
  const matchesAny = (patterns: RegExp[]) => patterns.some((p) => p.test(header));
  if (matchesAny(FEMALE_PATTERNS)) return 'F';
  if (matchesAny(MALE_PATTERNS)) return 'M';
  return null;
}

export interface MeetIdSeed {
  readonly meetName: string;
  readonly startDate: Date;
}

/**
 * Build a stable synthesized meetExternalId for swims whose source row
 * doesn't include a real SNC meet ID. The hash is deterministic across
 * scrapes of the same meet — same name + same start date → same id.
 */
export function hashMeetExternalId(seed: MeetIdSeed): string {
  const dayStr = seed.startDate.toISOString().slice(0, 10);
  const input = `${seed.meetName.trim().toLowerCase()}|${dayStr}`;
  const hash = createHash('sha256').update(input).digest('hex').slice(0, 12);
  return `synth-${hash}`;
}
```

### Step 2.4: Run — verify pass

Run: `pnpm --filter @flipturn/workers test helpers`
Expected: 4 + 4 + 2 = 10 tests pass.

### Step 2.5: Format + typecheck

Run: `pnpm --filter @flipturn/workers typecheck` — exit 0
Run: `pnpm format:check` — exit 0

### Step 2.6: Commit

```bash
git add apps/workers/src/parser/helpers.ts apps/workers/tests/helpers.test.ts
git commit -m "feat(workers): SNC parser helpers (date range, gender, meet hash)"
```

---

## Task 3: Real athlete-page parser (TDD against captured fixture)

**Files:**

- Create: `apps/workers/tests/athletePage.test.ts`
- Create: `apps/workers/src/parser/athletePage.ts`
- Modify: `apps/workers/src/parser/types.ts` (add `dataSource` to `AthleteSnapshot`)

### Step 3.1: Update `parser/types.ts`

Read the current `apps/workers/src/parser/types.ts`. Modify `AthleteSnapshot` to include the data source:

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
  /** The host the snapshot was scraped from (e.g. "www.swimming.ca"). */
  readonly dataSource: string;
  readonly swims: readonly SwimRecord[];
}

export interface MeetEventRecord {
  readonly distanceM: number;
  readonly stroke: Stroke;
  readonly gender: Gender;
  readonly ageBand: string | null;
  readonly round: Round;
}

export interface MeetSnapshot {
  readonly externalId: string;
  readonly name: string;
  readonly course: Course;
  readonly location: string | null;
  readonly startDate: Date;
  readonly endDate: Date;
  readonly sanctionBody: string | null;
  readonly dataSource: string;
  readonly events: readonly MeetEventRecord[];
}
```

### Step 3.2: Write the failing parser test

Create `apps/workers/tests/athletePage.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseAthletePage } from '../src/parser/athletePage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '..', 'fixtures', 'snc-athlete-sample.html');
const EXPECTED = join(__dirname, '..', 'fixtures', 'snc-athlete-sample.expected.json');

describe('parseAthletePage', () => {
  let html: string;
  let expected: { athlete: Record<string, unknown>; swims: Array<Record<string, unknown>> };

  beforeAll(async () => {
    html = await readFile(FIXTURE, 'utf8');
    expected = JSON.parse(await readFile(EXPECTED, 'utf8'));
  });

  it('extracts athlete identity', () => {
    const snap = parseAthletePage(html, { sncId: '4030816' });
    expect(snap.sncId).toBe(expected.athlete.sncId ?? '4030816');
    expect(snap.primaryName).toBe(expected.athlete.primaryName);
    expect(snap.dataSource).toBe('www.swimming.ca');
  });

  it('extracts swims that match the golden expected output', () => {
    const snap = parseAthletePage(html, { sncId: '4030816' });
    expect(snap.swims.length).toBeGreaterThanOrEqual(expected.swims.length);

    // Every expected swim should be present in the parsed output.
    for (const exp of expected.swims) {
      const found = snap.swims.find(
        (s) =>
          s.distanceM === exp.distanceM &&
          s.stroke === exp.stroke &&
          s.course === exp.course &&
          s.timeCentiseconds === exp.timeCentiseconds,
      );
      expect(found, `missing swim ${JSON.stringify(exp)}`).toBeDefined();
    }
  });

  it('derives athlete gender from per-swim event headers when present', () => {
    const snap = parseAthletePage(html, { sncId: '4030816' });
    // Expected fixture is Ryan Cochrane (male). If derivation works, snap.gender === 'M'.
    expect(snap.gender).toBe('M');
  });

  it('uses synthesized meetExternalId when the row has no SNC meet link', () => {
    const snap = parseAthletePage(html, { sncId: '4030816' });
    const synth = snap.swims.filter((s) => s.meetExternalId.startsWith('synth-'));
    // It's OK if there are zero synth IDs — but every swim must have a non-empty meetExternalId.
    for (const s of snap.swims) {
      expect(s.meetExternalId).toBeTruthy();
    }
    // synthesized IDs are deterministic — re-parsing should produce the same set.
    const snap2 = parseAthletePage(html, { sncId: '4030816' });
    expect(new Set(snap2.swims.map((s) => s.meetExternalId))).toEqual(
      new Set(snap.swims.map((s) => s.meetExternalId)),
    );
  });

  it('every swim has a positive timeCentiseconds and a valid eventKey-compatible shape', () => {
    const snap = parseAthletePage(html, { sncId: '4030816' });
    for (const s of snap.swims) {
      expect(s.timeCentiseconds).toBeGreaterThan(0);
      expect(['SCM', 'LCM', 'SCY']).toContain(s.course);
      expect(['FR', 'BK', 'BR', 'FL', 'IM']).toContain(s.stroke);
      expect(s.distanceM).toBeGreaterThan(0);
    }
  });

  it('throws on inputs that are clearly not a swimmer page', () => {
    expect(() =>
      parseAthletePage('<html><body>Page not found</body></html>', { sncId: 'X' }),
    ).toThrow();
    expect(() => parseAthletePage('', { sncId: 'X' })).toThrow();
  });
});
```

### Step 3.3: Run — verify failure

Run: `pnpm --filter @flipturn/workers test athletePage`
Expected: tests fail with module-not-found for `../src/parser/athletePage.js`.

### Step 3.4: Implement `apps/workers/src/parser/athletePage.ts`

The implementer must inspect `apps/workers/fixtures/snc-athlete-sample.html` to discover the actual HTML structure. Below is the **shape** of the implementation; the selectors must match what's in the fixture (consult the fixtures README for documented uncertainties about fields like meetExternalId nullability).

```ts
import * as cheerio from 'cheerio';
import { parseSwimTime } from '@flipturn/shared';
import type { Course, Round, Stroke, Gender, SwimStatus } from '@flipturn/shared';
import type { AthleteSnapshot, SwimRecord } from './types.js';
import { deriveGenderFromEventHeader, hashMeetExternalId } from './helpers.js';

const DATA_SOURCE = 'www.swimming.ca';

export interface ParseAthleteOptions {
  /** Caller-known SNC ID (from the URL). The page may not echo it. */
  readonly sncId: string;
}

export function parseAthletePage(html: string, options: ParseAthleteOptions): AthleteSnapshot {
  if (!html || html.length < 200) {
    throw new Error('parseAthletePage: input too short to be a real page');
  }

  const $ = cheerio.load(html);

  // 1. Athlete identity. Selectors below are illustrative — the implementer
  //    must update them after inspecting snc-athlete-sample.html. Look for:
  //    - the page title / h1 for the swimmer's name
  //    - any "Club: <name>" affordance for homeClub
  //    - the URL-derived sncId from options.sncId
  const primaryName = extractPrimaryName($);
  if (!primaryName) {
    throw new Error('parseAthletePage: could not extract athlete name');
  }
  const homeClub = extractHomeClub($);

  // 2. Swims table. Each row contains: event header (with gender), course,
  //    distance/stroke, time, date, meet name, optional meet link.
  const swims: SwimRecord[] = [];
  let derivedGender: Gender | null = null;

  for (const row of extractSwimRows($)) {
    const swim = parseSwimRow(row);
    swims.push(swim);
    if (!derivedGender && (row.gender === 'F' || row.gender === 'M')) {
      derivedGender = row.gender;
    }
  }

  return {
    sncId: options.sncId,
    primaryName,
    gender: derivedGender,
    homeClub,
    dataSource: DATA_SOURCE,
    swims,
  };
}

interface SwimRowRaw {
  readonly eventHeader: string;
  readonly gender: Gender | null;
  readonly course: Course;
  readonly distanceM: number;
  readonly stroke: Stroke;
  readonly round: Round;
  readonly ageBand: string | null;
  readonly timeText: string;
  readonly placeText: string | null;
  readonly statusText: string | null;
  readonly meetName: string;
  readonly meetLinkSncId: string | null;
  readonly dateText: string;
}

function extractPrimaryName($: cheerio.CheerioAPI): string {
  // TODO: replace with the actual selector after inspecting the fixture.
  // Likely candidates (from a typical WordPress + plugin layout):
  //   $('h1.entry-title').text()   — page title
  //   $('h1').first().text()       — first h1
  //   $('.swimmer-name').text()    — explicit class
  // Use the simplest selector that matches one node in the fixture.
  const h1 = $('h1').first().text().trim();
  return h1;
}

function extractHomeClub($: cheerio.CheerioAPI): string | null {
  // TODO: replace with the actual selector.
  // Look for "Club: <name>" or a row labeled "Home Club".
  const clubLabel = $('*:contains("Club:")').first().text().trim();
  const m = /Club:\s*(.+?)(?:\s+|$)/.exec(clubLabel);
  return m?.[1] ?? null;
}

function extractSwimRows($: cheerio.CheerioAPI): SwimRowRaw[] {
  // TODO: replace with the actual selector. Likely a table row iterator
  // grouped by event header. Read the fixture and adapt.
  // Pseudocode:
  //   for each <h2 or <h3 event header>:
  //     find following <table> / <tr>:
  //       extract { course, distance/stroke, time, place, status, meet, date }
  return [];
}

function parseSwimRow(row: SwimRowRaw): SwimRecord {
  const timeCentiseconds = parseSwimTime(row.timeText);
  const swamAt = parseRowDate(row.dateText);
  const meetStartDate = swamAt;
  const meetEndDate = swamAt; // refined later via meet-page enrichment
  const meetExternalId = row.meetLinkSncId
    ? row.meetLinkSncId
    : hashMeetExternalId({ meetName: row.meetName, startDate: meetStartDate });
  const status = mapStatus(row.statusText);
  const place = row.placeText ? Number.parseInt(row.placeText, 10) : null;

  return {
    meetExternalId,
    meetName: row.meetName,
    meetStartDate,
    meetEndDate,
    course: row.course,
    distanceM: row.distanceM,
    stroke: row.stroke,
    round: row.round,
    gender: row.gender ?? 'X',
    ageBand: row.ageBand,
    timeCentiseconds,
    splits: [],
    place: Number.isFinite(place) ? place : null,
    status,
    swamAt,
  };
}

function parseRowDate(text: string): Date {
  // TODO: implement based on the actual format observed in the fixture.
  // Common formats: "2024-08-15", "Aug 15, 2024", "15/08/2024".
  // For now: use Date constructor as a fallback.
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`parseRowDate: unrecognized date ${JSON.stringify(text)}`);
  }
  return d;
}

function mapStatus(raw: string | null): SwimStatus {
  if (!raw) return 'OFFICIAL';
  const u = raw.toUpperCase().trim();
  if (u === 'DQ') return 'DQ';
  if (u === 'NS' || u === 'NO SHOW') return 'NS';
  if (u === 'DNF') return 'DNF';
  if (u === 'WD' || u === 'WITHDRAWN') return 'WITHDRAWN';
  return 'OFFICIAL';
}
```

**Important:** the `TODO` comments above mark the exact spots where the implementer must consult the captured fixture (`apps/workers/fixtures/snc-athlete-sample.html`) to discover the real HTML structure and write matching selectors. The fixtures README has hand-extracted notes that document edge cases. The shape above is a scaffold; the actual selectors are spike-output-driven.

### Step 3.5: Run — iterate until tests pass

Run: `pnpm --filter @flipturn/workers test athletePage`
This will likely fail on the first run because `extractSwimRows` is empty. Iterate:

1. Open `apps/workers/fixtures/snc-athlete-sample.html` and find the swimmer's name node — update `extractPrimaryName`.
2. Find a swim row — pick a known PB time from `snc-athlete-sample.expected.json` and search the HTML for it. Use the surrounding structure to write `extractSwimRows`.
3. Run tests after each selector update to see which assertions still fail.

Stop iterating once all 6 tests pass.

### Step 3.6: Typecheck + format

Run: `pnpm --filter @flipturn/workers typecheck` — exit 0
Run: `pnpm format:check` — exit 0

### Step 3.7: Commit

```bash
git add apps/workers/src/parser/athletePage.ts apps/workers/src/parser/types.ts apps/workers/tests/athletePage.test.ts
git commit -m "feat(workers): cheerio parser for www.swimming.ca athlete pages"
```

---

## Task 4: Real meet-page parser (TDD against captured fixture)

**Files:**

- Create: `apps/workers/tests/meetPage.test.ts`
- Create: `apps/workers/src/parser/meetPage.ts`

The meet-page parser is **simpler**: it extracts the meet header and a list of events. It does not (yet) extract per-swim results from PDFs. Plan 3 ships it for completeness, but the worker pipeline does not enqueue meet-page scrapes — meets are still populated by the athlete-page-driven reconciler. Plan 4+ may wire meet-page enrichment when richer meet metadata is needed.

### Step 4.1: Write the failing test

Create `apps/workers/tests/meetPage.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseMeetIndex } from '../src/parser/meetPage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '..', 'fixtures', 'snc-meet-sample.html');
const EXPECTED = join(__dirname, '..', 'fixtures', 'snc-meet-sample.expected.json');

describe('parseMeetIndex', () => {
  let html: string;
  let expected: {
    meet: Record<string, unknown>;
    events: Array<Record<string, unknown>>;
  };

  beforeAll(async () => {
    html = await readFile(FIXTURE, 'utf8');
    expected = JSON.parse(await readFile(EXPECTED, 'utf8'));
  });

  it('extracts meet header', () => {
    const snap = parseMeetIndex(html, { externalId: String(expected.meet.externalId) });
    expect(snap.externalId).toBe(expected.meet.externalId);
    expect(snap.name).toBe(expected.meet.name);
    expect(snap.course).toBe(expected.meet.course);
    expect(snap.dataSource).toBe('results.swimming.ca');
  });

  it('parses the SPLASH date range', () => {
    const snap = parseMeetIndex(html, { externalId: String(expected.meet.externalId) });
    expect(snap.startDate.toISOString().slice(0, 10)).toBe(
      String(expected.meet.startDate).slice(0, 10),
    );
    expect(snap.endDate.toISOString().slice(0, 10)).toBe(
      String(expected.meet.endDate).slice(0, 10),
    );
  });

  it('extracts events that match the golden expected output', () => {
    const snap = parseMeetIndex(html, { externalId: String(expected.meet.externalId) });
    expect(snap.events.length).toBeGreaterThanOrEqual(expected.events.length);
    for (const exp of expected.events) {
      const found = snap.events.find(
        (e) => e.distanceM === exp.distanceM && e.stroke === exp.stroke && e.gender === exp.gender,
      );
      expect(found, `missing event ${JSON.stringify(exp)}`).toBeDefined();
    }
  });

  it('throws on inputs that are clearly not a meet page', () => {
    expect(() => parseMeetIndex('<html>oops</html>', { externalId: 'X' })).toThrow();
    expect(() => parseMeetIndex('', { externalId: 'X' })).toThrow();
  });
});
```

### Step 4.2: Run — verify failure

Run: `pnpm --filter @flipturn/workers test meetPage`
Expected: fails with module-not-found.

### Step 4.3: Implement `apps/workers/src/parser/meetPage.ts`

```ts
import * as cheerio from 'cheerio';
import type { Course, Round, Stroke, Gender } from '@flipturn/shared';
import type { MeetSnapshot, MeetEventRecord } from './types.js';
import { deriveGenderFromEventHeader, parseSplashDateRange } from './helpers.js';

const DATA_SOURCE = 'results.swimming.ca';

export interface ParseMeetOptions {
  /** Caller-known meet identifier (from the URL slug). */
  readonly externalId: string;
}

export function parseMeetIndex(html: string, options: ParseMeetOptions): MeetSnapshot {
  if (!html || html.length < 200) {
    throw new Error('parseMeetIndex: input too short to be a real page');
  }

  const $ = cheerio.load(html);

  // 1. Meet header — name, location, sanction body, course, date range.
  //    SPLASH index pages typically have a header table near the top.
  const name = extractMeetName($);
  if (!name) {
    throw new Error('parseMeetIndex: could not extract meet name');
  }
  const dateText = extractDateText($);
  const { startDate, endDate } = parseSplashDateRange(dateText);
  const course = extractCourse($);
  const location = extractLocation($);
  const sanctionBody = extractSanctionBody($);

  // 2. Event list.
  const events: MeetEventRecord[] = extractEvents($);

  return {
    externalId: options.externalId,
    name,
    course,
    location,
    startDate,
    endDate,
    sanctionBody,
    dataSource: DATA_SOURCE,
    events,
  };
}

// TODO: the implementer must fill in the selector implementations below
// based on inspecting `apps/workers/fixtures/snc-meet-sample.html`. The
// shape is fixed by the SPLASH MM11 templates (consistent across SNC).

function extractMeetName($: cheerio.CheerioAPI): string {
  return $('h1, h2').first().text().trim();
}

function extractDateText($: cheerio.CheerioAPI): string {
  // Look for a "Date:" or similar label near the meet header.
  const m = $('*:contains("Date:")').first().text().trim();
  const out = /Date:\s*(.+?)(?:\s+|$)/.exec(m);
  return out?.[1] ?? '';
}

function extractCourse($: cheerio.CheerioAPI): Course {
  const text = $('body').text();
  if (/long\s*course/i.test(text)) return 'LCM';
  if (/short\s*course\s*meters?/i.test(text)) return 'SCM';
  if (/short\s*course\s*yards?/i.test(text)) return 'SCY';
  return 'LCM'; // safe default; meet header almost always specifies
}

function extractLocation($: cheerio.CheerioAPI): string | null {
  const m = $('*:contains("Location:")').first().text().trim();
  const out = /Location:\s*(.+?)(?:\s+|$)/.exec(m);
  return out?.[1] ?? null;
}

function extractSanctionBody($: cheerio.CheerioAPI): string | null {
  const m = $('*:contains("Sanction")').first().text().trim();
  if (!m) return null;
  if (/swimming\s*canada|snc/i.test(m)) return 'SNC';
  return m.slice(0, 60);
}

function extractEvents($: cheerio.CheerioAPI): MeetEventRecord[] {
  // TODO: SPLASH event index typically has a table with rows like:
  //   "1  Boys 13 & Over 100 Freestyle"
  // Parse each row into { distanceM, stroke, gender, ageBand, round }.
  return [];
}
```

### Step 4.4: Iterate until pass

Run: `pnpm --filter @flipturn/workers test meetPage`
Iterate selectors against the fixture until all 4 tests pass.

### Step 4.5: Typecheck + format

Run: `pnpm --filter @flipturn/workers typecheck` — exit 0
Run: `pnpm format:check` — exit 0

### Step 4.6: Commit

```bash
git add apps/workers/src/parser/meetPage.ts apps/workers/tests/meetPage.test.ts
git commit -m "feat(workers): cheerio parser for results.swimming.ca meet index"
```

---

## Task 5: Two-host URL builders + ScrapeJob shape evolution

**Files:**

- Create: `apps/workers/src/url.ts`
- Create: `apps/workers/tests/url.test.ts`
- Modify: `apps/workers/src/queue.ts` (drop `fixtureName`)

### Step 5.1: Drop `fixtureName` from `ScrapeAthleteJob`

Read the current `apps/workers/src/queue.ts`. Remove the `fixtureName` field from `ScrapeAthleteJob`:

```ts
import { Queue, type JobsOptions } from 'bullmq';
import { getRedis } from './redis.js';

export const SCRAPE_ATHLETE_QUEUE = 'scrape-athlete';

export interface ScrapeAthleteJob {
  /** Internal Athlete.id (cuid). */
  readonly athleteId: string;
  /** SNC athlete ID (used to construct the source URL). */
  readonly sncId: string;
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
  options?: JobsOptions | undefined,
): Promise<string> {
  const queue = getScrapeAthleteQueue();
  const added = await queue.add('scrape', job, options);
  return added.id ?? '<no-id>';
}
```

### Step 5.2: Write URL-builder tests

Create `apps/workers/tests/url.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildAthleteUrl, buildMeetUrl, classifyUrl } from '../src/url.js';

describe('buildAthleteUrl', () => {
  it('builds the canonical athlete URL on www.swimming.ca', () => {
    expect(buildAthleteUrl('4030816')).toBe('https://www.swimming.ca/swimmer/4030816/');
  });

  it('URL-encodes IDs with unsafe characters', () => {
    expect(buildAthleteUrl('A B/C')).toBe('https://www.swimming.ca/swimmer/A%20B%2FC/');
  });

  it('rejects empty or whitespace-only IDs', () => {
    expect(() => buildAthleteUrl('')).toThrow();
    expect(() => buildAthleteUrl('   ')).toThrow();
  });
});

describe('buildMeetUrl', () => {
  it('builds the canonical meet URL on results.swimming.ca', () => {
    expect(buildMeetUrl('2026-speedo-canadian-swimming-open')).toBe(
      'https://results.swimming.ca/2026-speedo-canadian-swimming-open/',
    );
  });

  it('rejects empty slugs', () => {
    expect(() => buildMeetUrl('')).toThrow();
  });
});

describe('classifyUrl', () => {
  it('classifies www.swimming.ca/swimmer/* as athlete', () => {
    expect(classifyUrl('https://www.swimming.ca/swimmer/4030816/')).toBe('athlete');
  });

  it('classifies results.swimming.ca/* as meet', () => {
    expect(classifyUrl('https://results.swimming.ca/some-meet/')).toBe('meet');
  });

  it('returns unknown for other URLs', () => {
    expect(classifyUrl('https://example.com/swimmer/1')).toBe('unknown');
    expect(classifyUrl('https://www.swimming.ca/result/123/')).toBe('unknown');
  });
});
```

### Step 5.3: Run — verify failure

Run: `pnpm --filter @flipturn/workers test url`
Expected: fails with module-not-found.

### Step 5.4: Implement `apps/workers/src/url.ts`

```ts
const ATHLETE_HOST = 'www.swimming.ca';
const MEET_HOST = 'results.swimming.ca';

export type SourceKind = 'athlete' | 'meet' | 'unknown';

export function buildAthleteUrl(sncId: string): string {
  const trimmed = sncId.trim();
  if (!trimmed) {
    throw new Error('buildAthleteUrl: sncId must be non-empty');
  }
  return `https://${ATHLETE_HOST}/swimmer/${encodeURIComponent(trimmed)}/`;
}

export function buildMeetUrl(slug: string): string {
  const trimmed = slug.trim();
  if (!trimmed) {
    throw new Error('buildMeetUrl: slug must be non-empty');
  }
  return `https://${MEET_HOST}/${encodeURIComponent(trimmed)}/`;
}

export function classifyUrl(fullUrl: string): SourceKind {
  let url: URL;
  try {
    url = new URL(fullUrl);
  } catch {
    return 'unknown';
  }
  if (url.host === ATHLETE_HOST && url.pathname.startsWith('/swimmer/')) {
    return 'athlete';
  }
  if (url.host === MEET_HOST) {
    return 'meet';
  }
  return 'unknown';
}
```

### Step 5.5: Run — verify pass

Run: `pnpm --filter @flipturn/workers test url`
Expected: 6 + 2 + 3 = should-pass count is 8 minimum across the 3 describe blocks. Adjust to your exact count.

### Step 5.6: Typecheck + format

Run: `pnpm --filter @flipturn/workers typecheck` — exit 0
Run: `pnpm format:check` — exit 0

### Step 5.7: Commit

```bash
git add apps/workers/src/url.ts apps/workers/tests/url.test.ts apps/workers/src/queue.ts
git commit -m "feat(workers): two-host URL builders + drop fixtureName from job"
```

---

## Task 6: Parameterize `dataSource` through reconcile

**Files:**

- Modify: `apps/workers/src/reconcile.ts`
- Modify: `apps/workers/tests/reconcile.test.ts` (replace stub usage with real fixture-driven snapshot)
- Modify: `apps/workers/tests/personalBest.test.ts` (same)

### Step 6.1: Update `reconcile.ts`

Read the current file. Change the hardcoded `dataSource: 'results.swimming.ca'` to use the snapshot's field. The signature stays the same.

In the `tx.swim.upsert(...)`'s `create` block, change:

```ts
        create: {
          // ... unchanged fields ...
          dataSource: 'results.swimming.ca',
        },
```

to:

```ts
        create: {
          // ... unchanged fields ...
          dataSource: snapshot.dataSource,
        },
```

The `update` block doesn't need to set `dataSource` because re-scrapes with the same key shouldn't change which source the row originally came from (Plan 4+ may revisit when multi-source ingestion arrives).

### Step 6.2: Update reconcile tests to use real-parser-shaped snapshots

The existing `reconcile.test.ts` calls `parseStub({ fixtureName: 'demo-sarah', ... })`. Plan 3 deletes the stub. Replace each test setup with a directly-constructed `AthleteSnapshot`:

Read the current `apps/workers/tests/reconcile.test.ts`. Replace the `parseStub({ fixtureName: 'demo-sarah', ... })` calls with a `makeDemoSnapshot()` helper at the top of the file:

```ts
function makeDemoSnapshot(): AthleteSnapshot {
  return {
    sncId: 'DEMO-SARAH-001',
    primaryName: 'Sarah Demo',
    gender: 'F',
    homeClub: 'Waterloo Region Aquatics',
    dataSource: 'www.swimming.ca',
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
    ],
  };
}
```

Add this import at the top:

```ts
import type { AthleteSnapshot } from '../src/parser/types.js';
```

Replace every `parseStub({ fixtureName: 'demo-sarah', sncId: 'x', body: '' })` with `makeDemoSnapshot()`.

Add one new test that verifies the `dataSource` field is propagated:

```ts
it('writes the snapshot dataSource onto every swim', async () => {
  const snap = makeDemoSnapshot();
  await reconcile(prisma, snap);
  const swims = await prisma.swim.findMany();
  for (const swim of swims) {
    expect(swim.dataSource).toBe('www.swimming.ca');
  }
});
```

### Step 6.3: Update personalBest tests the same way

Repeat Step 6.2 for `apps/workers/tests/personalBest.test.ts` — replace `parseStub` calls with the same `makeDemoSnapshot()` helper (extract it to a shared `tests/_demo.ts` if you want; both tests can import it).

Suggested: create `apps/workers/tests/_demo.ts`:

```ts
import type { AthleteSnapshot } from '../src/parser/types.js';

export function makeDemoSnapshot(): AthleteSnapshot {
  // (paste the function body from Step 6.2)
}
```

Then both reconcile.test.ts and personalBest.test.ts import from `'./_demo.js'`.

### Step 6.4: Run all tests

Run: `pnpm --filter @flipturn/workers test`
Expected: all tests pass — including the new `dataSource` assertion. Total: previous count + 1 = 27 (or your current total + 1).

### Step 6.5: Typecheck + format

Run: `pnpm --filter @flipturn/workers typecheck` — exit 0
Run: `pnpm format:check` — exit 0

### Step 6.6: Commit

```bash
git add apps/workers/src/reconcile.ts apps/workers/tests/reconcile.test.ts apps/workers/tests/personalBest.test.ts apps/workers/tests/_demo.ts
git commit -m "feat(workers): parameterize dataSource on AthleteSnapshot"
```

---

## Task 7: Wire real parser into worker.ts (delete stub)

**Files:**

- Modify: `apps/workers/src/worker.ts` (real fetcher + dispatch by URL; no fixtureName branch)
- Delete: `apps/workers/src/parser/stub.ts`
- Delete: `apps/workers/tests/stub.test.ts`

### Step 7.1: Delete the stub parser and its test

```bash
rm apps/workers/src/parser/stub.ts
rm apps/workers/tests/stub.test.ts
```

### Step 7.2: Replace `apps/workers/src/worker.ts`

Read the current file. Replace it entirely with:

```ts
import { Worker, type Job } from 'bullmq';
import { getPrisma } from '@flipturn/db';
import { SCRAPE_ATHLETE_QUEUE, type ScrapeAthleteJob } from './queue.js';
import { getRedis } from './redis.js';
import { getLogger } from './logger.js';
import { politeFetch, FetchBlockedError, FetchRetryError } from './fetch.js';
import { parseAthletePage } from './parser/athletePage.js';
import { reconcile } from './reconcile.js';
import { recomputePersonalBests } from './personalBest.js';
import { buildAthleteUrl } from './url.js';

export function startScrapeWorker(): Worker<ScrapeAthleteJob> {
  const log = getLogger();

  const worker = new Worker<ScrapeAthleteJob>(
    SCRAPE_ATHLETE_QUEUE,
    async (job: Job<ScrapeAthleteJob>) => {
      const { athleteId, sncId } = job.data;
      const url = buildAthleteUrl(sncId);
      log.info({ jobId: job.id, athleteId, sncId, url }, 'job started');

      let body: string;
      try {
        const result = await politeFetch({ url, sncId });
        body = result.body;
      } catch (err) {
        if (err instanceof FetchBlockedError) {
          log.warn({ jobId: job.id, err: err.message }, 'fetch blocked; skipping');
          return { skipped: true as const, reason: err.message };
        }
        // FetchRetryError + any other error → re-throw so BullMQ retries.
        throw err;
      }

      const snapshot = parseAthletePage(body, { sncId });

      const prisma = getPrisma();
      const { athleteId: dbAthleteId } = await reconcile(prisma, snapshot);
      await recomputePersonalBests(prisma, dbAthleteId);

      log.info({ jobId: job.id, dbAthleteId, swims: snapshot.swims.length }, 'job complete');
      return { dbAthleteId, swims: snapshot.swims.length };
    },
    {
      connection: getRedis(),
      concurrency: 1,
    },
  );

  worker.on('failed', (job, err) => {
    if (err instanceof FetchRetryError) {
      log.warn({ jobId: job?.id, retryAfterMs: err.retryAfterMs }, 'job will retry on backoff');
    } else {
      log.error({ jobId: job?.id, err }, 'job failed');
    }
  });

  worker.on('completed', (job) => {
    log.debug({ jobId: job.id }, 'job completed');
  });

  return worker;
}

export function startSchedulerWorker(): Worker {
  const log = getLogger();
  const w = new Worker(
    'flipturn-scheduler',
    async () => {
      const { tickScheduler } = await import('./scheduler.js');
      await tickScheduler();
    },
    { connection: getRedis(), concurrency: 1 },
  );
  w.on('failed', (job, err) => log.error({ jobId: job?.id, err }, 'scheduler tick failed'));
  return w;
}
```

### Step 7.3: Run all tests

Run: `pnpm --filter @flipturn/workers test`
Expected: all tests pass except `stub.test.ts` is gone (deleted). The `pipeline.integration.test.ts` will fail because it still uses `parseStub` — that's Task 8.

### Step 7.4: Typecheck + format

Run: `pnpm --filter @flipturn/workers typecheck` — exit 0
Run: `pnpm format:check` — exit 0

### Step 7.5: Commit

```bash
git add apps/workers/src/worker.ts apps/workers/src/parser/stub.ts apps/workers/tests/stub.test.ts
git commit -m "feat(workers): wire real parser into pipeline; remove stub"
```

The `git add` will track the deletes correctly because git's status detection picks them up.

---

## Task 8: Rewrite end-to-end integration test

**Files:**

- Modify (effectively rewrite): `apps/workers/tests/pipeline.integration.test.ts`

The new test reads `snc-athlete-sample.html` from the fixtures dir, mocks `politeFetch` to return that HTML, and verifies the full pipeline produces the expected athlete + swims + PBs in DB.

### Step 8.1: Replace the test

Replace `apps/workers/tests/pipeline.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@flipturn/db';
import { Queue, Worker, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { reconcile } from '../src/reconcile.js';
import { recomputePersonalBests } from '../src/personalBest.js';
import { parseAthletePage } from '../src/parser/athletePage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '..', 'fixtures', 'snc-athlete-sample.html');

const TEST_DB = `flipturn_pipeline_test_${Date.now()}`;
const TEST_URL = `postgresql://flipturn:flipturn_dev@localhost:55432/${TEST_DB}?schema=public`;
const TEST_REDIS_URL = 'redis://localhost:56379';
const QUEUE_NAME = `pipeline-test-${Date.now()}`;

let prisma: PrismaClient;
let redis: Redis;
let queue: Queue;
let worker: Worker;
let events: QueueEvents;
let html: string;

describe('pipeline integration (real parser, mocked fetch)', () => {
  beforeAll(async () => {
    html = await readFile(FIXTURE, 'utf8');

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
        const { sncId } = job.data as { sncId: string; athleteId: string };
        // Use the captured fixture as the "fetched" body — bypassing politeFetch.
        const snap = parseAthletePage(html, { sncId });
        const { athleteId } = await reconcile(prisma, snap);
        await recomputePersonalBests(prisma, athleteId);
        return { athleteId, swims: snap.swims.length };
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

  it('processes a real fixture end-to-end: athlete + swims + PBs in DB', async () => {
    const job = await queue.add('scrape', {
      athleteId: 'pipeline-1',
      sncId: '4030816',
    });
    const result = (await job.waitUntilFinished(events, 30_000)) as {
      athleteId: string;
      swims: number;
    };
    expect(result.athleteId).toEqual(expect.any(String));
    expect(result.swims).toBeGreaterThan(0);

    const athlete = await prisma.athlete.findUnique({ where: { sncId: '4030816' } });
    expect(athlete).not.toBeNull();
    expect(athlete?.gender).toBe('M'); // derived from event headers

    const swims = await prisma.swim.findMany({ where: { athleteId: athlete!.id } });
    expect(swims.length).toBeGreaterThan(0);
    for (const s of swims) {
      expect(s.dataSource).toBe('www.swimming.ca');
      expect(s.timeCentiseconds).toBeGreaterThan(0);
    }

    const pbs = await prisma.personalBest.findMany({ where: { athleteId: athlete!.id } });
    expect(pbs.length).toBeGreaterThan(0);
  });
});
```

### Step 8.2: Run the integration test

Run: `pnpm --filter @flipturn/workers test pipeline.integration`
Expected: 1 test passes within ~10 seconds.

### Step 8.3: Run all tests together

Run: `pnpm --filter @flipturn/workers test`
Expected: all worker tests pass (rough total: 24 from Plan 2 minus 4 stub tests + new tests across Tasks 1-5 + dataSource assertion). Final number is bookkeeping; what matters is **all green**.

### Step 8.4: Typecheck + format

Run: `pnpm --filter @flipturn/workers typecheck` — exit 0
Run: `pnpm format:check` — exit 0

### Step 8.5: Commit

```bash
git add apps/workers/tests/pipeline.integration.test.ts
git commit -m "test(workers): rewrite integration test to use real parser + fixture"
```

---

## Task 9: Cleanups — scheduler unit test + redundant PB query collapse

**Files:**

- Create: `apps/workers/tests/scheduler.test.ts`
- Modify: `apps/workers/src/personalBest.ts` (collapse the two-query fastest-swim lookup into one)

### Step 9.1: Write scheduler test

Create `apps/workers/tests/scheduler.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { PrismaClient } from '@flipturn/db';

const TEST_DB = `flipturn_scheduler_test_${Date.now()}`;
const TEST_URL = `postgresql://flipturn:flipturn_dev@localhost:55432/${TEST_DB}?schema=public`;

let prisma: PrismaClient;

// Mock enqueueScrapeAthlete so we can assert calls without touching Redis.
vi.mock('../src/queue.js', async () => {
  return {
    enqueueScrapeAthlete: vi.fn(async () => 'mock-id'),
  };
});

// getPrisma is also mocked so tickScheduler uses our test prisma.
vi.mock('@flipturn/db', async () => {
  const original = await vi.importActual<typeof import('@flipturn/db')>('@flipturn/db');
  return {
    ...original,
    getPrisma: () => prisma,
  };
});

describe('tickScheduler', () => {
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
    await prisma.athlete.deleteMany();
    vi.clearAllMocks();
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

  it('enqueues a scrape job per athlete and returns the count', async () => {
    await prisma.athlete.createMany({
      data: [
        { sncId: 'SNC-T-1', primaryName: 'A' },
        { sncId: 'SNC-T-2', primaryName: 'B' },
        { sncId: 'SNC-T-3', primaryName: 'C' },
      ],
    });

    const { tickScheduler } = await import('../src/scheduler.js');
    const { enqueueScrapeAthlete } = await import('../src/queue.js');

    const result = await tickScheduler();
    expect(result.enqueued).toBe(3);
    expect(enqueueScrapeAthlete).toHaveBeenCalledTimes(3);

    const calls = (enqueueScrapeAthlete as unknown as { mock: { calls: Array<[unknown]> } }).mock
      .calls;
    const sncIds = calls.map((c) => (c[0] as { sncId: string }).sncId).sort();
    expect(sncIds).toEqual(['SNC-T-1', 'SNC-T-2', 'SNC-T-3']);
  });

  it('returns enqueued: 0 when there are no athletes', async () => {
    const { tickScheduler } = await import('../src/scheduler.js');
    const { enqueueScrapeAthlete } = await import('../src/queue.js');
    const result = await tickScheduler();
    expect(result.enqueued).toBe(0);
    expect(enqueueScrapeAthlete).not.toHaveBeenCalled();
  });
});
```

### Step 9.2: Run scheduler test — verify pass

Run: `pnpm --filter @flipturn/workers test scheduler`
Expected: 2 tests pass.

If the test fails because `tickScheduler`'s import of `getPrisma` resolves before the mock is set up, the test may need to use `vi.hoisted` or rearrange the mock declaration. Iterate until it passes; if you can't get vi.mock to override `@flipturn/db`'s `getPrisma`, fall back to refactoring `tickScheduler` to accept `prisma` as a parameter (cleaner anyway). If you take that path, also update `worker.ts`'s `startSchedulerWorker` to pass `getPrisma()` in.

### Step 9.3: Collapse the redundant query in `personalBest.ts`

Read the current `apps/workers/src/personalBest.ts`. The current implementation does:

```ts
const swims = await tx.swim.findMany({
  where: { athleteId, status: 'OFFICIAL', isCurrent: true },
  orderBy: [{ eventKey: 'asc' }, { timeCentiseconds: 'asc' }],
});
// ... build fastestByEventKey ...
const swimDetails = await tx.swim.findMany({
  where: { id: { in: swimIds } },
  include: { meet: { select: { startDate: true } } },
});
```

Collapse into a single query by including the meet relation up-front:

```ts
const swims = await tx.swim.findMany({
  where: { athleteId, status: 'OFFICIAL', isCurrent: true },
  orderBy: [{ eventKey: 'asc' }, { timeCentiseconds: 'asc' }],
  include: { meet: { select: { startDate: true } } },
});
```

Then update the map-construction loop to read `meet.startDate` directly:

```ts
const fastestByEventKey = new Map<
  string,
  { id: string; timeCentiseconds: number; achievedAt: Date }
>();
for (const swim of swims) {
  if (!fastestByEventKey.has(swim.eventKey)) {
    fastestByEventKey.set(swim.eventKey, {
      id: swim.id,
      timeCentiseconds: swim.timeCentiseconds,
      achievedAt: swim.meet.startDate,
    });
  }
}
```

Delete the second `findMany` and the `swamAtById` map. Update the upsert's `update`/`create` to use `best.achievedAt` directly.

### Step 9.4: Run all PB tests

Run: `pnpm --filter @flipturn/workers test personalBest`
Expected: 4 tests still pass (the existing idempotency test will catch any regression).

### Step 9.5: Typecheck + format

Run: `pnpm --filter @flipturn/workers typecheck` — exit 0
Run: `pnpm format:check` — exit 0

### Step 9.6: Run all tests

Run: `pnpm --filter @flipturn/workers test`
Expected: all green.

### Step 9.7: Commit

```bash
git add apps/workers/src/personalBest.ts apps/workers/tests/scheduler.test.ts
git commit -m "refactor(workers): scheduler unit test + collapse PB lookup query"
```

---

## Task 10: ADR 0003 + final integration check + README update

**Files:**

- Create: `docs/adr/0003-parser-architecture.md`
- Modify: `apps/workers/README.md` (drop the "stub parser" section, document real parser)

### Step 10.1: Write ADR 0003

Create `docs/adr/0003-parser-architecture.md`:

```markdown
# ADR 0003 — Parser architecture: dispatch by URL, retry semantics, gender derivation

**Status:** Accepted
**Date:** 2026-05-04
**Deciders:** Darrell Bechtel
**Spec link:** [`docs/superpowers/specs/2026-05-04-flipturn-mvp-design.md`](../superpowers/specs/2026-05-04-flipturn-mvp-design.md)
**Builds on:** [ADR 0002 — SNC data source](./0002-snc-data-source.md)

## Context

ADR 0002 chose cheerio-on-static-HTML for SNC fetching. Plan 3 needed
to land three architectural details that ADR 0002 deferred:

1. How does the worker pipeline dispatch between athlete-page and meet-page parsers?
2. How does it react to HTTP 429 / `Retry-After` from Cloudflare?
3. How does it handle data the source page doesn't expose (most notably athlete gender)?

## Decisions

### 1. URL-classification dispatch

`apps/workers/src/url.ts` exposes `classifyUrl(fullUrl) → 'athlete' | 'meet' | 'unknown'`
based on host + path prefix:

- `www.swimming.ca/swimmer/*` → athlete
- `results.swimming.ca/*` → meet
- everything else → unknown (defensive fail-closed)

The worker's job processor decides which URL to fetch via `buildAthleteUrl`
or `buildMeetUrl`, then routes the response body to the matching parser.
The parser modules don't know about each other.

### 2. 429 / Retry-After handling

`politeFetch` parses the `Retry-After` header (RFC 7231: integer seconds OR HTTP-date),
clamps the resulting delay to `[60s, 24h]`, applies the delay to the host's
politeness key via `applyBackoff(redis, host, delayMs)`, and throws
`FetchRetryError`. BullMQ's existing retry config picks up the throw and re-runs
the job after its own exponential backoff — by which time the host's
politeness budget will block until `Retry-After` has elapsed.

Two layers stack here: BullMQ's job-level backoff and the politeness key's
host-level backoff. Both must clear before the next fetch.

The 60s minimum is a defensive floor: a server that says `Retry-After: 1`
is asking for trouble, not for politeness.

### 3. Gender derivation

The athlete page does not expose athlete gender directly. The parser derives
it from per-swim event headers ("Boys 100 Free" → M, "Girls 200 IM" → F)
and assigns the most-common derivation to `Athlete.gender`. If no swim row
yields a gender (e.g. an athlete with only mixed-gender relay entries), the
field stays `null`.

This is best-effort, not authoritative. Plan 4 (parent onboarding) gives
the parent a chance to confirm or correct the value during athlete linking.

## Alternatives considered

- **Single combined parser** — one `parseSwimmingPage(body, hint)` function
  with internal branching. Rejected: the two parsers have entirely different
  selectors, error modes, and golden test fixtures. Composition over
  conditionals.

- **Retry inside `politeFetch`** — automatic retry-with-sleep within a
  single fetch. Rejected: ties up the BullMQ worker for the duration,
  prevents the host from being released to other jobs, and obscures the
  retry from the job-level retry config.

- **Inferring gender from the SNC ID** — SNC IDs are not gendered. Rejected.

## Consequences

- The parser interface is stable: athlete pages and meet pages produce
  `AthleteSnapshot` and `MeetSnapshot` respectively. Adding a third source
  (e.g. SwimCloud one-off lookups, or live results from TouchPadLive) is
  a new parser + a new URL classification, no upstream changes.
- 429 handling is correct but verbose: a job that hits a 429 will be
  retried by BullMQ up to its `attempts` limit. A WAF-mediated long block
  could fail the job permanently and dead-letter; manual recovery happens
  by re-enqueuing.
- Gender is an inference, not a fact. Future migrations should preserve
  the option of nullable gender; user-confirmed values must override the
  derived one.
```

### Step 10.2: Update `apps/workers/README.md`

Read the current README. Replace the "Current state (Plan 2)" section with a "Current state (Plan 3)" section:

```markdown
## Current state (Plan 3)

This package ships the full scrape pipeline:

- BullMQ + Redis client + queue
- Politeness (token bucket, robots.txt cache, user-agent, **429/Retry-After backoff**)
- Raw artifact archive on disk
- Idempotent reconciler against Postgres (with snapshot-driven `dataSource`)
- PersonalBest recompute (single-query, DQ handling, idempotent)
- Daily scheduler via BullMQ repeatable jobs (with unit test)
- Heartbeat key in Redis
- **Real cheerio parsers** for `www.swimming.ca/swimmer/<id>/` and `results.swimming.ca/<slug>/`
- End-to-end integration test using captured fixtures

To enqueue a job manually for local testing:

\`\`\`ts
import { enqueueScrapeAthlete } from './src/queue.js';
await enqueueScrapeAthlete({
athleteId: '<some athlete id>',
sncId: '4030816',
});
\`\`\`

See [`docs/adr/0002-snc-data-source.md`](../../docs/adr/0002-snc-data-source.md)
and [`docs/adr/0003-parser-architecture.md`](../../docs/adr/0003-parser-architecture.md)
for the design decisions.
```

(Use real triple-backticks in the file.)

### Step 10.3: Run all gates

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm format:check
```

All four should exit 0.

### Step 10.4: Verify a clean install + test run

```bash
rm -rf node_modules apps/*/node_modules packages/*/node_modules
pnpm install
pnpm typecheck
pnpm test
```

Expected: all tests pass after a fresh install.

### Step 10.5: Commit

```bash
git add docs/adr/0003-parser-architecture.md apps/workers/README.md
git commit -m "docs(workers): adr 0003 parser architecture + plan 3 readme"
```

---

## Acceptance criteria for Plan 3

- [ ] `apps/workers/src/parser/stub.ts` and `tests/stub.test.ts` deleted
- [ ] `apps/workers/src/parser/athletePage.ts` parses the captured fixture into the golden expected output
- [ ] `apps/workers/src/parser/meetPage.ts` parses the captured fixture into the golden expected output
- [ ] `politeFetch` honors `Retry-After` on 429 (unit-tested)
- [ ] `applyBackoff` defers the host's next token grant
- [ ] `apps/workers/src/url.ts` builds athlete and meet URLs and classifies them
- [ ] `ScrapeAthleteJob` no longer carries `fixtureName`
- [ ] `Swim.dataSource` reflects the snapshot's host (verified by reconcile test)
- [ ] `recomputePersonalBests` does a single `findMany` (verified by code inspection)
- [ ] `tickScheduler` has a unit test with mocked enqueue
- [ ] End-to-end integration test consumes `snc-athlete-sample.html` and produces athlete + swims + PBs
- [ ] ADR 0003 committed
- [ ] All commits use conventional-commit style
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` all green

When all checked, hand off to Plan 4 — the API (Hono + magic-link auth + endpoints).

## Open items deferred again

- Live smoke against `www.swimming.ca` — Plan 6 (closed beta launch) covers this; Plan 3's fixture-driven test is the acceptance gate.
- Token-bucket race under `concurrency > 1` — Plan 6.
- `pnpm workers:dev/start` switching to `node --env-file=.env` — Plan 6 hosting work.
- Meet-page enrichment (using `parseMeetIndex` to backfill richer meet metadata) — Plan 4+ when richer meet metadata is needed.
- SwimRankings athlete-ID linking (the spike noted some swim rows lack SNC meet IDs because SwimRankings can't resolve them) — synthesized hashes work for MVP; a real cross-reference is post-MVP.
