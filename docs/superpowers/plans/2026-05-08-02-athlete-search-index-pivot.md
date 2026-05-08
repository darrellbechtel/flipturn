# Athlete Search Index — v2 Pivot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the search-proxy + on-demand ingest + priority-club warmer architecture from [`2026-05-08-02-athlete-search-index-pivot.md`](../specs/2026-05-08-02-athlete-search-index-pivot.md), which supersedes §5–§7 of the original spec.

**Tasks 1–4 from the original plan are already shipped** on `darrellbechtel/feat/athlete-search-impl`:
- Task 1: schema migration (Club, Athlete additions, `pg_trgm`/`unaccent`, tsvector, GIN indexes)
- Task 2: window + jitter helpers (`apps/server/workers/src/scheduler/window.ts`)
- Task 3: politeFetch sampled inter-request delay
- Task 4: `parseClubDirectory` JSONP parser + 415-club fixture

**Tasks 5–11 from the original plan are dropped** (no per-club roster URLs, no priority seed needed). New tasks below.

**Tech stack reminder:** TypeScript, Hono, BullMQ, Prisma + PostgreSQL, Vitest, pnpm workspaces. All paths absolute under `/Users/darrell/Documents/ai-projects/flipturn`.

---

## File structure (new files only)

```
apps/server/workers/src/parser/searchResults.ts
apps/server/workers/src/parser/swimmerPage.ts            (may share with existing parser/athletePage.ts)
apps/server/workers/src/jobs/priorityWarmer.ts
apps/server/workers/src/scheduler/warmerScheduler.ts
apps/server/api/src/services/athleteSearch.ts
apps/server/api/src/services/searchProxy.ts              (live-fallback fetcher; unit-testable seam)

apps/server/workers/tests/parser/searchResults.test.ts
apps/server/workers/tests/parser/__fixtures__/search-results.html
apps/server/workers/tests/parser/swimmerPage.test.ts
apps/server/workers/tests/parser/__fixtures__/swimmer-5567334.html
apps/server/workers/tests/jobs/priorityWarmer.test.ts
apps/server/workers/tests/scheduler/warmerScheduler.test.ts
apps/server/api/tests/services/athleteSearch.test.ts
apps/server/api/tests/services/searchProxy.test.ts
apps/server/api/tests/routes/athleteSearch.test.ts
apps/server/api/tests/routes/admin.test.ts
packages/shared/src/schemas/athleteSearch.ts
packages/shared/tests/schemas/athleteSearch.test.ts
```

**Modified:**
```
apps/server/workers/src/queue.ts                         (add PRIORITY_WARMER_QUEUE + enqueueWarmerRun)
apps/server/workers/src/worker.ts                        (register new processor + warmer cron)
apps/server/api/src/routes/athletes.ts                   (add GET /search)
apps/server/api/src/routes/admin.ts                      (new file)
apps/server/api/src/app.ts                               (mount /v1/admin)
packages/shared/src/index.ts                             (re-export schemas)
packages/db/prisma/schema.prisma                         (add REMOTE_DISCOVERY enum value; drop crawlPriority)
packages/db/prisma/migrations/<ts>_pivot_v2/migration.sql
```

---

## Task 5: `parseSearchResults` parser

**Files:**
- Create: `apps/server/workers/src/parser/searchResults.ts`
- Test: `apps/server/workers/tests/parser/searchResults.test.ts`
- Fixture: `apps/server/workers/tests/parser/__fixtures__/search-results.html`

- [ ] **Step 1: Capture fixture from a known-good query.**

```bash
mkdir -p apps/server/workers/tests/parser/__fixtures__
curl -sS -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36" \
  "https://www.swimming.ca/?s=Felix+Bechtel" \
  -o apps/server/workers/tests/parser/__fixtures__/search-results.html
wc -c apps/server/workers/tests/parser/__fixtures__/search-results.html
```
Expected: ≥ 30 KB. The page should contain at least one `/swimmer/5567334/` href and one `/swimmer/felix-cowan/` href.

- [ ] **Step 2: Write the failing test.**

```typescript
// apps/server/workers/tests/parser/searchResults.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseSearchResults } from '../../src/parser/searchResults';

const html = readFileSync(join(__dirname, '__fixtures__/search-results.html'), 'utf8');

describe('parseSearchResults', () => {
  it('extracts numeric /swimmer/<id>/ results', () => {
    const rows = parseSearchResults(html);
    const numeric = rows.filter(r => /^\d+$/.test(r.sncId));
    expect(numeric.length).toBeGreaterThan(0);
    expect(numeric.some(r => r.sncId === '5567334')).toBe(true);
  });

  it('skips curated WP-CPT slug results (non-numeric sncId)', () => {
    const rows = parseSearchResults(html);
    expect(rows.every(r => /^\d+$/.test(r.sncId))).toBe(true);
  });

  it('returns a non-empty displayName for each result', () => {
    const rows = parseSearchResults(html);
    for (const r of rows) {
      expect(r.displayName.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 3: Run, expect failure.**
```bash
pnpm --filter @flipturn/workers test parser/searchResults
```

- [ ] **Step 4: Implement.**

```typescript
// apps/server/workers/src/parser/searchResults.ts
import { load } from 'cheerio';

export type ParsedSearchResult = {
  sncId: string;        // numeric-only; non-numeric (curated bio slugs) are filtered out
  displayName: string;
  profileUrl: string;   // absolute, e.g. https://www.swimming.ca/swimmer/5567334/
};

const NUMERIC_HREF_RE = /^\/swimmer\/(\d+)\/$/;

export function parseSearchResults(html: string): ParsedSearchResult[] {
  const $ = load(html);
  const seen = new Set<string>();
  const results: ParsedSearchResult[] = [];

  // The WP search renders results as <article> elements with <a class="..." href="/swimmer/<id>/">.
  // Selector intentionally broad — we filter by href shape rather than by class to be resilient
  // to theme tweaks. Inspect the fixture and tighten only if false-positive matches appear.
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href') ?? '';
    const m = NUMERIC_HREF_RE.exec(href);
    if (!m) return;
    const sncId = m[1];
    if (seen.has(sncId)) return;
    const displayName = $(a).text().trim() || $(a).closest('article').find('h2,h3').first().text().trim();
    if (!displayName) return;
    seen.add(sncId);
    results.push({
      sncId,
      displayName,
      profileUrl: `https://www.swimming.ca/swimmer/${sncId}/`,
    });
  });

  return results;
}
```

- [ ] **Step 5: Run, expect pass.** Iterate the selector if needed.

- [ ] **Step 6: Commit.**
```bash
git add apps/server/workers/src/parser/searchResults.ts \
        apps/server/workers/tests/parser/searchResults.test.ts \
        apps/server/workers/tests/parser/__fixtures__/search-results.html
git commit -m "feat(workers): parseSearchResults — extract /swimmer/<id>/ from WP search HTML"
```

---

## Task 6: `parseSwimmerPage` parser

**Files:**
- Create: `apps/server/workers/src/parser/swimmerPage.ts`
- Test: `apps/server/workers/tests/parser/swimmerPage.test.ts`
- Fixture: `apps/server/workers/tests/parser/__fixtures__/swimmer-5567334.html`

This may overlap with the existing `parser/athletePage.ts`. **Read it first** and decide: extend it, share helpers, or build a sibling. Don't duplicate without reason. If `parseAthletePage` already does most of this, the deliverable is a `parseSwimmerProfile(html): ParsedSwimmer` thin wrapper that returns the index-time fields (sncId-deferred-to-caller, primaryName, clubName, dobYear, gender) — leave the existing PB/swims extraction untouched.

- [ ] **Step 1: Capture fixture.**

```bash
curl -sS -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36" \
  "https://www.swimming.ca/swimmer/5567334/" \
  -o apps/server/workers/tests/parser/__fixtures__/swimmer-5567334.html
wc -c apps/server/workers/tests/parser/__fixtures__/swimmer-5567334.html
```
Expected: ≥ 60 KB. The page contains a `print_r`-style data dump (verified during pivot probe) with fields like `[club] => [name] => Club Warrior Swimmers@UW` and similar.

- [ ] **Step 2: Inspect existing `apps/server/workers/src/parser/athletePage.ts`.** What fields does it already extract from the same URL? If it already returns `primaryName`, `clubName`, `gender`, `dobYear` (or you can compute year-of-birth from age-at-meet), reuse it: just write a thin `parseSwimmerProfile` that calls `parseAthletePage` and projects the index-time fields. If those fields aren't present, add them to `athletePage.ts` directly rather than creating a parallel parser.

- [ ] **Step 3: Write the failing test** (whether against a new function or an extended `parseAthletePage`):

```typescript
// apps/server/workers/tests/parser/swimmerPage.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseSwimmerProfile } from '../../src/parser/swimmerPage';

const html = readFileSync(join(__dirname, '__fixtures__/swimmer-5567334.html'), 'utf8');

describe('parseSwimmerProfile', () => {
  it('extracts primaryName "Felix Bechtel"', () => {
    const r = parseSwimmerProfile(html);
    expect(r.primaryName).toBe('Felix Bechtel');
  });
  it('extracts club name "Club Warrior Swimmers@UW"', () => {
    const r = parseSwimmerProfile(html);
    expect(r.clubName).toMatch(/Club Warrior/i);
  });
  it('extracts gender M/F/X or null', () => {
    const r = parseSwimmerProfile(html);
    expect(['M', 'F', 'X', null]).toContain(r.gender);
  });
  it('extracts dobYear (4-digit year) or null', () => {
    const r = parseSwimmerProfile(html);
    if (r.dobYear !== null) {
      expect(r.dobYear).toBeGreaterThanOrEqual(1950);
      expect(r.dobYear).toBeLessThanOrEqual(new Date().getFullYear());
    }
  });
});
```

- [ ] **Step 4: Implement.**

```typescript
// apps/server/workers/src/parser/swimmerPage.ts
import { load } from 'cheerio';
// Optional: import existing helpers from './athletePage' or './helpers' — DO NOT duplicate.

export type ParsedSwimmer = {
  primaryName: string;
  clubName: string | null;
  gender: 'M' | 'F' | 'X' | null;
  dobYear: number | null;
};

const TITLE_RE = /<title>([^<]+?)<\/title>/i;
const CLUB_RE = /\[name\]\s*=>?\s*([^\n<]+?)(?=\s*\[|\s*<|\s*\Z)/;
const GENDER_RE = /\[gender\]\s*=>?\s*([MFX])/i;
const DOB_YEAR_RE = /\[dob\]\s*=>?\s*(\d{4})|\[birth_?year\]\s*=>?\s*(\d{4})/i;

export function parseSwimmerProfile(html: string): ParsedSwimmer {
  const $ = load(html);

  // The page <title> is "Firstname Lastname - Swimming Canada" or "Swimmer 5567334 - Swimming Canada"
  // for swimmers without a title override. Prefer h1 / og:title / display headings if present.
  const ogTitle = $('meta[property="og:title"]').attr('content') ?? '';
  const h1 = $('h1').first().text().trim();
  const titleTagMatch = TITLE_RE.exec(html);
  const titleText = titleTagMatch?.[1] ?? '';
  const candidate = (h1 || ogTitle || titleText).replace(/\s*[-–|]\s*Swimming Canada.*$/i, '').trim();
  const primaryName = /^Swimmer \d+$/i.test(candidate) ? '' : candidate;

  const clubMatch = CLUB_RE.exec(html);
  const clubName = clubMatch?.[1]?.trim() ?? null;

  const genderMatch = GENDER_RE.exec(html);
  const gender = (genderMatch?.[1]?.toUpperCase() ?? null) as 'M' | 'F' | 'X' | null;

  const dobMatch = DOB_YEAR_RE.exec(html);
  const dobYear = dobMatch ? parseInt(dobMatch[1] ?? dobMatch[2] ?? '0', 10) || null : null;

  return { primaryName, clubName, gender, dobYear };
}
```

The regexes target the embedded `print_r` dump observed in the live page during the pivot probe. **Implementer must inspect the actual fixture** and adjust regexes to match the real shape — the patterns above are starting points, not authoritative.

- [ ] **Step 5: Run, expect pass.** Iterate regexes against the fixture.

- [ ] **Step 6: Commit.**
```bash
git add apps/server/workers/src/parser/swimmerPage.ts \
        apps/server/workers/tests/parser/swimmerPage.test.ts \
        apps/server/workers/tests/parser/__fixtures__/swimmer-5567334.html
git commit -m "feat(workers): parseSwimmerProfile — index-time fields from /swimmer/<id>/"
```

---

## Task 7: New BullMQ queue + enqueue helper for the warmer

**Files:**
- Modify: `apps/server/workers/src/queue.ts`
- Test: `apps/server/workers/tests/queue.test.ts` (extend)

- [ ] **Step 1: Add the queue.**

```typescript
// in queue.ts, alongside existing exports:
export const PRIORITY_WARMER_QUEUE = 'priority-warmer';

export type PriorityWarmerJob = {
  clubName: string;     // free-text club name to search by
  reason: 'cron' | 'admin';
};

let _warmerQueue: Queue<PriorityWarmerJob> | null = null;
function warmerQueue() {
  if (!_warmerQueue) {
    _warmerQueue = new Queue<PriorityWarmerJob>(PRIORITY_WARMER_QUEUE, { connection: getRedis() });
  }
  return _warmerQueue;
}

export async function enqueueWarmerRun(
  clubName: string,
  reason: PriorityWarmerJob['reason'] = 'cron',
  delayMs = 0,
): Promise<void> {
  await warmerQueue().add(
    `warm:${clubName}`,
    { clubName, reason },
    {
      delay: delayMs,
      attempts: 5,
      backoff: { type: 'exponential', delay: 60_000 },
      jobId: `warm:${clubName}:${Math.floor(Date.now() / (24 * 60 * 60 * 1000))}`,  // dedup per UTC day
    },
  );
}
```

- [ ] **Step 2: Add a test** mirroring the existing queue test pattern (mock `bullmq` Queue, assert the queue name + jobId shape).

- [ ] **Step 3: Run, commit.**
```bash
pnpm --filter @flipturn/workers test queue
git commit -m "feat(workers): priority-warmer queue + enqueueWarmerRun"
```

---

## Task 8: `priorityWarmerCrawl` job processor

**Files:**
- Create: `apps/server/workers/src/jobs/priorityWarmer.ts`
- Test: `apps/server/workers/tests/jobs/priorityWarmer.test.ts`

For one club name input, the warmer:
1. Fetches `swimming.ca/?s=<clubName>` via `politeFetch` (sampled delay).
2. Parses with `parseSearchResults` → list of numeric sncIds.
3. For each sncId, fetches `swimming.ca/swimmer/<sncId>/` via `politeFetch`.
4. Parses with `parseSwimmerProfile` → upserts `Athlete` (`source = CRAWLED`, `lastIndexedAt = now()`).
5. Updates `Club.lastCrawledAt` if a matching `Club` row exists (name `ILIKE` match against `clubName`).

- [ ] **Step 1: Write the failing test.**

```typescript
// apps/server/workers/tests/jobs/priorityWarmer.test.ts
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { runPriorityWarmer } from '../../src/jobs/priorityWarmer';

const searchHtml = readFileSync(join(__dirname, '..', 'parser', '__fixtures__', 'search-results.html'), 'utf8');
const swimmerHtml = readFileSync(join(__dirname, '..', 'parser', '__fixtures__', 'swimmer-5567334.html'), 'utf8');

describe('runPriorityWarmer', () => {
  it('searches, fetches each numeric result, and upserts Athletes', async () => {
    const upserts: Array<Record<string, unknown>> = [];
    const prisma = {
      athlete: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async (args: unknown) => { upserts.push((args as { data: Record<string, unknown> }).data); return {}; }),
        update: vi.fn(async () => ({})),
      },
      club: {
        findFirst: vi.fn(async () => null),
        update: vi.fn(async () => ({})),
      },
    } as unknown as PrismaClient;
    const fetcher = vi.fn(async (req: { url: string }) => {
      if (req.url.includes('?s=')) return { status: 200, body: searchHtml };
      if (req.url.includes('/swimmer/')) return { status: 200, body: swimmerHtml };
      throw new Error('unexpected url ' + req.url);
    });

    const result = await runPriorityWarmer({ prisma, fetch: fetcher, clubName: 'Felix Bechtel' /* fixture's query */ });

    expect(result.searched).toBe(1);
    expect(result.discovered).toBeGreaterThan(0);
    expect(upserts.some(d => d.sncId === '5567334')).toBe(true);
    expect(upserts.every(d => d.source === 'CRAWLED')).toBe(true);
  });
});
```

(Note: the fixture filename is "search-results.html" but contains a Felix-Bechtel query — that's why we pass `clubName: 'Felix Bechtel'` here. In production the warmer is keyed on a real club name; the fixture is a stand-in.)

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement.**

```typescript
// apps/server/workers/src/jobs/priorityWarmer.ts
import type { PrismaClient } from '@prisma/client';
import { parseSearchResults } from '../parser/searchResults';
import { parseSwimmerProfile } from '../parser/swimmerPage';
import { ParserMismatchError, type FetchFn } from './clubDirectoryCrawl';

export async function runPriorityWarmer(deps: {
  prisma: PrismaClient;
  fetch: FetchFn;
  clubName: string;
}): Promise<{ searched: number; discovered: number; upserted: number }> {
  const searchUrl = `https://www.swimming.ca/?s=${encodeURIComponent(deps.clubName)}`;
  const searchRes = await deps.fetch({ url: searchUrl });
  if (searchRes.status !== 200) throw new Error(`search fetch failed: ${searchRes.status}`);
  const searchRows = parseSearchResults(searchRes.body);
  if (searchRows.length === 0) {
    // Empty results aren't a parser bug — the search may legitimately return nothing.
    // Only throw if the page itself is malformed (parser crashes) — current parseSearchResults
    // returns [] gracefully, so this branch is just an info path.
    return { searched: 1, discovered: 0, upserted: 0 };
  }

  const now = new Date();
  let upserted = 0;
  for (const row of searchRows) {
    const swimmerRes = await deps.fetch({ url: row.profileUrl });
    if (swimmerRes.status !== 200) continue; // skip individual failures; rely on next run
    const profile = parseSwimmerProfile(swimmerRes.body);
    if (!profile.primaryName) continue;

    // Resolve clubId by name match (best-effort)
    let clubId: string | null = null;
    if (profile.clubName) {
      const club = await deps.prisma.club.findFirst({
        where: { name: { contains: profile.clubName, mode: 'insensitive' } },
        select: { id: true },
      });
      clubId = club?.id ?? null;
    }

    const existing = await deps.prisma.athlete.findUnique({ where: { sncId: row.sncId } });
    if (!existing) {
      await deps.prisma.athlete.create({
        data: {
          sncId: row.sncId,
          primaryName: profile.primaryName,
          alternateNames: [],
          dobYear: profile.dobYear ?? null,
          gender: profile.gender ?? undefined,
          homeClub: profile.clubName ?? null,
          clubId,
          source: 'CRAWLED',
          lastIndexedAt: now,
        },
      });
    } else {
      const shouldFlipToCrawled =
        existing.source === 'USER_ONBOARDED' && existing.primaryName === profile.primaryName;
      await deps.prisma.athlete.update({
        where: { sncId: row.sncId },
        data: {
          primaryName: profile.primaryName,
          dobYear: profile.dobYear ?? existing.dobYear,
          gender: profile.gender ?? existing.gender ?? undefined,
          homeClub: profile.clubName ?? existing.homeClub,
          clubId: clubId ?? existing.clubId,
          lastIndexedAt: now,
          ...(shouldFlipToCrawled ? { source: 'CRAWLED' as const } : {}),
        },
      });
    }
    upserted++;
  }

  // Update Club.lastCrawledAt for the matched club, if any.
  const matchedClub = await deps.prisma.club.findFirst({
    where: { name: { contains: deps.clubName, mode: 'insensitive' } },
    select: { id: true },
  });
  if (matchedClub) {
    await deps.prisma.club.update({ where: { id: matchedClub.id }, data: { lastCrawledAt: now } });
  }

  return { searched: 1, discovered: searchRows.length, upserted };
}
```

- [ ] **Step 4: Run tests, commit.**
```bash
pnpm --filter @flipturn/workers test jobs/priorityWarmer
git commit -m "feat(workers): priorityWarmer job (search → fetch → upsert Athlete)"
```

---

## Task 9: Daily warmer scheduler

**Files:**
- Create: `apps/server/workers/src/scheduler/warmerScheduler.ts`
- Test: `apps/server/workers/tests/scheduler/warmerScheduler.test.ts`

The scheduler picks **one priority club per active day** (conservative for v1 — Swimming Canada rate-limits aggressively, so we don't want to fan out 13 club searches in one window). Cycles through the priority list FIFO; persists last-warmed timestamp implicitly via `Club.lastCrawledAt` (already populated by Task 8).

- [ ] **Step 1: Define the priority list.**

```typescript
// apps/server/workers/src/scheduler/warmerScheduler.ts
import { DateTime } from 'luxon';
import type { PrismaClient } from '@prisma/client';
import {
  CRAWL_TZ,
  WINDOW_END_HOUR,
  WINDOW_END_MIN,
  isInActiveWindow,
  sampleFireTimeForDate,
  type Rng,
} from './window';

// Hardcoded for v1. When PSO crawlers (Swim Ontario, etc.) come back, this moves to a config/db row.
export const BETA_PRIORITY_CLUBS: readonly string[] = [
  'Club Warriors',
  'Region of Waterloo Swim Club',
  'Guelph Gryphon',
  // P2 — WOSA-region (Windsor Regionals trial cohort)
  'Windsor Aquatic Club',
  'Sarnia Rapids',
  'London Aquatic Club',
  'Cambridge Aquatic Jets',
  'Brantford Aquatic Club',
  'Burlington Aquatic Devilrays',
  'Oakville Aquatic Club',
  'Etobicoke Pepsi Swimming',
  'Mississauga Aquatic Club',
  'North York Aquatic Club',
];

export type PlannedWarm = { clubName: string; fireAt: DateTime };

export async function planDailyWarm(deps: {
  prisma: PrismaClient;
  today: DateTime;
  rng?: Rng;
  list?: readonly string[];
}): Promise<PlannedWarm | null> {
  const today = deps.today.setZone(CRAWL_TZ);
  const windowEnd = today.startOf('day').plus({ hours: WINDOW_END_HOUR, minutes: WINDOW_END_MIN });
  if (today > windowEnd) return null; // window closed

  const list = deps.list ?? BETA_PRIORITY_CLUBS;
  if (list.length === 0) return null;

  // Pick the club whose matching Club row has the oldest lastCrawledAt (NULL first).
  // Falls back to FIFO order through the hardcoded list when no Club row matches.
  const ages: { clubName: string; lastCrawledAt: Date | null }[] = await Promise.all(
    list.map(async (n) => {
      const c = await deps.prisma.club.findFirst({
        where: { name: { contains: n, mode: 'insensitive' } },
        select: { lastCrawledAt: true },
      });
      return { clubName: n, lastCrawledAt: c?.lastCrawledAt ?? null };
    }),
  );
  ages.sort((a, b) => {
    if (a.lastCrawledAt === null && b.lastCrawledAt === null) return 0;
    if (a.lastCrawledAt === null) return -1;
    if (b.lastCrawledAt === null) return 1;
    return a.lastCrawledAt.getTime() - b.lastCrawledAt.getTime();
  });
  const pick = ages[0];

  let fireAt = sampleFireTimeForDate(today, deps.rng);
  if (fireAt < today) fireAt = today.plus({ minutes: 1 });
  if (!isInActiveWindow(fireAt)) return null;
  return { clubName: pick.clubName, fireAt };
}
```

- [ ] **Step 2: Test the scheduler.** Test cases:
  - Returns null if window has closed
  - Picks NULL-lastCrawledAt clubs first
  - Falls back to oldest lastCrawledAt
  - Fire time is inside the active window

- [ ] **Step 3: Run, commit.**
```bash
git commit -m "feat(workers): warmer scheduler (1 priority club / active day, oldest-first)"
```

---

## Task 10: Wire warmer + processor into `worker.ts`

**Files:**
- Modify: `apps/server/workers/src/worker.ts`

- [ ] **Step 1: Register the new BullMQ worker** behind the same `INDEX_CRAWL_ENABLED` flag from the original Task 10 sketch:

```typescript
import { Worker, Queue } from 'bullmq';
import { DateTime } from 'luxon';
import { PRIORITY_WARMER_QUEUE, type PriorityWarmerJob, enqueueWarmerRun } from './queue';
import { politeFetch } from './fetch';
import { runPriorityWarmer } from './jobs/priorityWarmer';
import { planDailyWarm } from './scheduler/warmerScheduler';
import { CRAWL_TZ } from './scheduler/window';
import { getRedis } from './redis';
import { prisma } from './prisma';

const indexCrawlEnabled = process.env.INDEX_CRAWL_ENABLED === 'true';

if (indexCrawlEnabled) {
  new Worker<PriorityWarmerJob>(
    PRIORITY_WARMER_QUEUE,
    async (job) => runPriorityWarmer({ prisma, fetch: politeFetch, clubName: job.data.clubName }),
    { connection: getRedis(), concurrency: 1 },
  );

  // Daily planner — runs at 15:55 ET, schedules one warmer run for today's window.
  const planQueue = new Queue('priority-warmer-plan', { connection: getRedis() });
  planQueue.add('plan', {}, {
    repeat: { pattern: '55 15 * * *', tz: CRAWL_TZ },
    jobId: 'priority-warmer-plan-cron',
  });
  new Worker(
    'priority-warmer-plan',
    async () => {
      const today = DateTime.now().setZone(CRAWL_TZ);
      const plan = await planDailyWarm({ prisma, today });
      if (!plan) return;
      const delayMs = Math.max(0, plan.fireAt.toMillis() - today.toMillis());
      await enqueueWarmerRun(plan.clubName, 'cron', delayMs);
    },
    { connection: getRedis(), concurrency: 1 },
  );
}
```

- [ ] **Step 2: Run the existing test suite to confirm nothing regressed.**
```bash
pnpm --filter @flipturn/workers test
```

- [ ] **Step 3: Commit.**
```bash
git commit -m "feat(workers): register priority-warmer processor + daily plan cron"
```

---

## Task 11: Zod schemas for athlete search

**Files:**
- Create: `packages/shared/src/schemas/athleteSearch.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/tests/schemas/athleteSearch.test.ts`

Identical to the original plan's Task 12. Copy the schemas verbatim from the original plan: `AthleteSearchQuerySchema`, `AthleteSearchResultSchema`, `AthleteSearchResponseSchema`. No changes needed for the pivot.

Commit: `feat(shared): zod schemas for athlete search API`

---

## Task 12: `searchAthletes` service — local-first with live fallback

**Files:**
- Create: `apps/server/api/src/services/athleteSearch.ts`
- Create: `apps/server/api/src/services/searchProxy.ts`
- Test: `apps/server/api/tests/services/athleteSearch.test.ts`
- Test: `apps/server/api/tests/services/searchProxy.test.ts`

**Important:** raw SQL must use `f_unaccent(...)` (the IMMUTABLE wrapper added in Task 1's migration), not bare `unaccent(...)`. Otherwise the GIN index on `searchVector` won't be hit.

- [ ] **Step 1: Implement `searchProxy.ts`** — a thin wrapper around the WordPress search:

```typescript
// apps/server/api/src/services/searchProxy.ts
import { parseSearchResults } from '@flipturn/workers/parser/searchResults'; // adjust import path
import { politeFetch } from '@flipturn/workers/fetch';
import type { PrismaClient } from '@prisma/client';

export async function searchRemoteAndPersistStubs(deps: {
  prisma: PrismaClient;
  q: string;
}): Promise<{ stubsCreated: number; sncIds: string[] }> {
  const url = `https://www.swimming.ca/?s=${encodeURIComponent(deps.q)}`;
  const res = await politeFetch({ url });
  if (res.status !== 200) return { stubsCreated: 0, sncIds: [] };
  const rows = parseSearchResults(res.body);
  let stubsCreated = 0;
  for (const r of rows) {
    const existing = await deps.prisma.athlete.findUnique({ where: { sncId: r.sncId } });
    if (existing) continue;
    await deps.prisma.athlete.create({
      data: {
        sncId: r.sncId,
        primaryName: r.displayName,
        alternateNames: [],
        source: 'REMOTE_DISCOVERY',
        // dobYear, gender, clubId left null — backfilled by athlete-detail-scrape on selection
      },
    });
    stubsCreated++;
  }
  return { stubsCreated, sncIds: rows.map(r => r.sncId) };
}
```

(Add `REMOTE_DISCOVERY` to the `AthleteSource` enum in `schema.prisma` + a migration. See Task 16.)

- [ ] **Step 2: Implement `athleteSearch.ts`** with the two-stage flow:

```typescript
// apps/server/api/src/services/athleteSearch.ts
import type { PrismaClient } from '@prisma/client';
import type { AthleteSearchResponse } from '@flipturn/shared';
import { searchRemoteAndPersistStubs } from './searchProxy';

const MIN_LOCAL_HITS = 3;

export async function searchAthletes(args: {
  prisma: PrismaClient;
  q: string;
  clubId?: string;
  province?: string;
  limit: number;
  userId: string;
}): Promise<AthleteSearchResponse> {
  const local = await runLocalSearch(args);
  if (local.results.length >= MIN_LOCAL_HITS) return local;

  // Live fallback: persist stubs, then re-run local search to pick them up with full ranking.
  await searchRemoteAndPersistStubs({ prisma: args.prisma, q: args.q });
  const merged = await runLocalSearch(args);
  return merged;
}

async function runLocalSearch(args: {
  prisma: PrismaClient;
  q: string;
  clubId?: string;
  province?: string;
  limit: number;
  userId: string;
}): Promise<AthleteSearchResponse> {
  const { prisma, q, clubId, province, limit, userId } = args;
  type Row = {
    sncId: string;
    primaryName: string;
    alternateNames: string[];
    dobYear: number | null;
    gender: 'M' | 'F' | 'X' | null;
    clubId: string | null;
    clubName: string | null;
    clubProvince: string | null;
    hasFlipturnProfile: boolean;
    alreadyLinkedToMe: boolean;
  };
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT
      a."sncId",
      a."primaryName",
      a."alternateNames",
      a."dobYear",
      a.gender::text AS gender,
      c."id"   AS "clubId",
      c."name" AS "clubName",
      c."province" AS "clubProvince",
      EXISTS (SELECT 1 FROM "UserAthlete" ua WHERE ua."athleteId" = a.id) AS "hasFlipturnProfile",
      EXISTS (SELECT 1 FROM "UserAthlete" ua WHERE ua."athleteId" = a.id AND ua."userId" = ${userId}) AS "alreadyLinkedToMe",
      GREATEST(
        CASE WHEN f_unaccent(lower(a."primaryName")) = f_unaccent(lower(${q})) THEN 1.0 ELSE 0 END,
        ts_rank(a."searchVector", plainto_tsquery('simple', f_unaccent(${q}))),
        similarity(a."primaryName", ${q})
      ) AS rank
    FROM "Athlete" a
    LEFT JOIN "Club" c ON c.id = a."clubId"
    WHERE
      (
        a."searchVector" @@ plainto_tsquery('simple', f_unaccent(${q}))
        OR similarity(a."primaryName", ${q}) > 0.3
      )
      AND (${clubId}::text IS NULL OR a."clubId" = ${clubId})
      AND (${province}::text IS NULL OR c."province" = ${province})
    ORDER BY rank DESC, a."primaryName" ASC
    LIMIT ${limit}
  `;
  return {
    results: rows.map(r => ({
      sncId: r.sncId,
      displayName: r.primaryName,
      alternateNames: r.alternateNames,
      dobYear: r.dobYear,
      gender: r.gender,
      club: r.clubId ? { id: r.clubId, name: r.clubName!, province: r.clubProvince } : null,
      hasFlipturnProfile: r.hasFlipturnProfile,
      alreadyLinkedToMe: r.alreadyLinkedToMe,
    })),
    total: rows.length,
  };
}
```

- [ ] **Step 3: Tests** (DB-backed integration test for the local path + a mocked-fetch test for the remote path).

- [ ] **Step 4: Commit.**
```bash
git commit -m "feat(api): athleteSearch service (local tsvector + live fallback)"
```

---

## Task 13: `GET /v1/athletes/search` route

Identical to the original plan's Task 14. Mount the `searchAthletes` service behind `sessionMiddleware` + rate limit. Validate with `AthleteSearchQuerySchema`.

Note the live-fallback may take several seconds; either set a generous timeout or document an SSE/polling variant in a follow-up plan. For v1, accept the single-shot latency.

Commit: `feat(api): GET /v1/athletes/search route`

---

## Task 14: Admin one-shot endpoints

**Files:**
- Create: `apps/server/api/src/routes/admin.ts`
- Modify: `apps/server/api/src/app.ts`
- Test: `apps/server/api/tests/routes/admin.test.ts`

Two endpoints, both `x-admin-token`-gated:

- `POST /v1/admin/crawl/club-directory` — enqueues `clubDirectoryCrawl` (existing, from Task 4 work). Body: empty.
- `POST /v1/admin/warmer-run` — enqueues `priorityWarmer` for one club. Body: `{ clubName: string }`. Bypasses the active window for bootstrapping.
- `GET /v1/admin/index-stats` — returns `{ totalClubs, totalAthletes, recentCrawls: [{ clubId, name, lastCrawledAt }] }`.

Implementation mirrors Tasks 15+16 of the original plan but with the warmer endpoint replacing the per-club roster endpoint.

Commit: `feat(api): admin crawl-trigger + index-stats endpoints`

---

## Task 15: Drop `Club.crawlPriority` migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<ts>_drop_crawl_priority/migration.sql`

The pivot drops per-club priority — it now lives in the hardcoded BETA_PRIORITY_CLUBS list. The column and its composite index are dead weight.

- [ ] Step 1: Remove `crawlPriority Int @default(0)` and `@@index([crawlPriority, lastCrawledAt])` from `Club` in schema.prisma.
- [ ] Step 2: Add `REMOTE_DISCOVERY` to `enum AthleteSource` (used by `searchProxy`).
- [ ] Step 3: `pnpm db:migrate dev --name drop_crawl_priority --create-only`. Verify the generated SQL drops the column and the index, and adds the enum value.
- [ ] Step 4: Apply, regenerate Prisma client, typecheck, test.
- [ ] Step 5: Commit: `feat(db): drop Club.crawlPriority + add REMOTE_DISCOVERY AthleteSource`.

---

## Task 16: Full suite + manual smoke + open PR

- [ ] **Step 1: Full suite green.**
```bash
pnpm typecheck && pnpm lint && pnpm test
```

- [ ] **Step 2: Manual smoke** (using admin endpoints):
```bash
ADMIN_TOKEN=$ADMIN_TOKEN INDEX_CRAWL_ENABLED=true pnpm --filter @flipturn/workers start &
sleep 5
# Trigger a warmer run for Felix's club:
curl -X POST -H "x-admin-token: $ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"clubName":"Club Warriors"}' http://localhost:3000/v1/admin/warmer-run
# Wait a minute, then verify Felix is in the DB:
docker compose exec postgres psql -U flipturn -d flipturn -c \
  'SELECT "sncId", "primaryName", "homeClub" FROM "Athlete" WHERE "sncId" = '\''5567334'\'';'
# Expected: one row, name 'Felix Bechtel', homeClub like 'Club Warrior%'.
# Then verify search:
curl -b "flipturn_session=$SESSION_ID" 'http://localhost:3000/v1/athletes/search?q=Felix+Bechtel'
# Expected: results array with sncId '5567334'.
```

- [ ] **Step 3: Open the PR.**
```bash
gh pr create --title "feat: athlete search index v2 (search-proxy + priority warmer)" --body "$(cat docs/superpowers/specs/2026-05-08-02-athlete-search-index-pivot.md | head -50)"
```

---

## Notes for the implementer

- **Use `f_unaccent`, not bare `unaccent`** in any new raw SQL touching `Athlete.searchVector`. Task 1's migration added IMMUTABLE wrappers because Postgres rejected STABLE functions in the `GENERATED ALWAYS AS STORED` expression. Bare `unaccent(...)` in a query won't match the index expression and the planner will fall back to a seq-scan.
- **DI pattern preserved.** Every job + service takes `{ prisma, fetch }` as args.
- **`INDEX_CRAWL_ENABLED=true`** gates the warmer cron only. Search-proxy + admin endpoints are not flag-gated.
- **PR-per-task vs single PR.** Project memory says every plan/refactor lands via PR. Single PR for the whole pivot is fine; the spec PR (#41) can absorb this and be retitled, or a fresh PR for the impl branch can be opened post-merge.
- **Use Opus 4.7 subagents for every superpowers dispatch** (implementers AND reviewers).
