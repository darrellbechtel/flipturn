# Athlete Search Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an internal Canada-wide athlete index sourced from `findaclub.swimming.ca` and `results.swimming.ca`, plus a name/club search API, so onboarding stops requiring a memorized SNC ID.

**Architecture:** Two new BullMQ jobs (`club-directory-crawl`, `club-roster-crawl`) inside the existing `apps/server/workers` process populate a thin `Athlete` index keyed on `sncId`. A new `GET /v1/athletes/search` route in `apps/server/api` searches via Postgres `tsvector` + `pg_trgm`. All scheduled crawls fire only inside a 16:00–22:30 ET window with three layers of jitter (day, time, per-request).

**Tech Stack:** TypeScript, Hono, BullMQ, Prisma + PostgreSQL (`pg_trgm` + `unaccent` extensions), Vitest, pnpm workspaces. **Spec:** [`docs/superpowers/specs/2026-05-08-01-athlete-search-index-design.md`](../specs/2026-05-08-01-athlete-search-index-design.md).

**Out of scope (separate plan):** Mobile onboarding screen swap. The backend (this plan) ships first; mobile integration follows in `2026-05-NN-02-athlete-search-mobile.md`.

---

## File Structure

**New files:**
```
apps/server/workers/src/parser/clubDirectory.ts
apps/server/workers/src/parser/clubRoster.ts
apps/server/workers/src/jobs/clubDirectoryCrawl.ts
apps/server/workers/src/jobs/clubRosterCrawl.ts
apps/server/workers/src/scheduler/window.ts
apps/server/workers/src/scheduler/scheduler.ts
apps/server/workers/src/scripts/seedBetaPriorities.ts
apps/server/api/src/services/athleteSearch.ts
apps/server/api/src/routes/admin.ts
packages/shared/src/schemas/athleteSearch.ts

apps/server/workers/tests/parser/clubDirectory.test.ts
apps/server/workers/tests/parser/clubRoster.test.ts
apps/server/workers/tests/parser/__fixtures__/club-directory.html
apps/server/workers/tests/parser/__fixtures__/club-roster.html
apps/server/workers/tests/jobs/clubDirectoryCrawl.test.ts
apps/server/workers/tests/jobs/clubRosterCrawl.test.ts
apps/server/workers/tests/scheduler/window.test.ts
apps/server/workers/tests/scheduler/scheduler.test.ts
apps/server/api/tests/services/athleteSearch.test.ts
apps/server/api/tests/routes/athleteSearch.test.ts
apps/server/api/tests/routes/admin.test.ts
packages/shared/tests/schemas/athleteSearch.test.ts
```

**Modified files:**
```
packages/db/prisma/schema.prisma                       (Club model, Athlete additions, AthleteSource enum)
packages/db/prisma/migrations/<ts>_athlete_search_index/migration.sql  (hand-edit for tsvector + extensions)
apps/server/workers/src/queue.ts                       (new queues + enqueue helpers)
apps/server/workers/src/worker.ts                      (register new processors, register cron)
apps/server/workers/src/politeness.ts                  (sampled delay instead of fixed)
apps/server/api/src/routes/athletes.ts                 (add GET /search)
apps/server/api/src/app.ts                             (mount /v1/admin)
packages/shared/src/index.ts                           (re-export new schemas)
```

---

## Task 1: Schema migration — Club model, Athlete additions, extensions

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_athlete_search_index/migration.sql`

- [ ] **Step 1: Edit `packages/db/prisma/schema.prisma`**

Add after the `Athlete` model (around line 64):

```prisma
enum AthleteSource {
  USER_ONBOARDED
  CRAWLED
}

model Club {
  id            String    @id              // SNC club code (e.g. "ON-CW")
  name          String
  shortName     String?
  province      String?                    // 2-letter (e.g. "ON")
  city          String?
  rosterUrl     String?
  lastCrawledAt DateTime?
  crawlPriority Int       @default(0)
  athletes      Athlete[]
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@index([province])
  @@index([name])
  @@index([crawlPriority, lastCrawledAt])
}
```

In the existing `Athlete` model (lines 49–64) add these fields and indexes:

```prisma
model Athlete {
  id             String           @id @default(cuid())
  sncId          String           @unique
  primaryName    String
  alternateNames String[]
  dob            DateTime?
  dobYear        Int?
  gender         Gender?
  homeClub       String?
  clubId         String?
  club           Club?            @relation(fields: [clubId], references: [id])
  source         AthleteSource    @default(USER_ONBOARDED)
  lastIndexedAt  DateTime?
  clubHistory    ClubMembership[]
  swims          Swim[]
  personalBests  PersonalBest[]
  users          UserAthlete[]
  lastScrapedAt  DateTime?
  createdAt      DateTime         @default(now())
  updatedAt      DateTime         @updatedAt

  @@index([clubId])
  @@index([dobYear])
}
```

(Do NOT add a `searchVector` field in Prisma — that column is added in a hand-written migration step below.)

- [ ] **Step 2: Generate the migration scaffold**

Run from repo root:
```bash
pnpm db:migrate dev --name athlete_search_index --create-only
```
Expected: a new directory `packages/db/prisma/migrations/<timestamp>_athlete_search_index/` containing `migration.sql` with the standard Prisma DDL. Do NOT apply yet.

- [ ] **Step 3: Hand-edit the migration to add extensions, the `tsvector` generated column, and the GIN indexes**

Open the new `migration.sql` and prepend:
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
```

After the `ALTER TABLE "Athlete" ADD COLUMN ...` lines, append:
```sql
ALTER TABLE "Athlete"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'simple',
      unaccent(
        coalesce("primaryName", '') || ' ' ||
        coalesce(array_to_string("alternateNames", ' '), '')
      )
    )
  ) STORED;

CREATE INDEX "Athlete_searchVector_idx" ON "Athlete" USING GIN ("searchVector");
CREATE INDEX "Athlete_primaryName_trgm_idx" ON "Athlete" USING GIN ("primaryName" gin_trgm_ops);
```

- [ ] **Step 4: Apply the migration**

```bash
pnpm db:migrate deploy
```
Expected: "Applied migration `<timestamp>_athlete_search_index`". No errors.

- [ ] **Step 5: Regenerate the Prisma client**

```bash
pnpm --filter @flipturn/db generate
```
Expected: "✔ Generated Prisma Client".

- [ ] **Step 6: Verify the schema in psql**

```bash
docker compose exec postgres psql -U flipturn -d flipturn \
  -c "\d \"Athlete\"" -c "\d \"Club\"" -c "\dx"
```
Expected: `Athlete` shows `clubId`, `dobYear`, `source`, `lastIndexedAt`, `searchVector` (with `tsvector` type and `generated always as`); `Club` exists; `\dx` lists `pg_trgm` and `unaccent`.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): athlete search index schema (Club model, Athlete additions, pg_trgm/unaccent, tsvector)"
```

---

## Task 2: Active-window + jitter helpers

**Files:**
- Create: `apps/server/workers/src/scheduler/window.ts`
- Test: `apps/server/workers/tests/scheduler/window.test.ts`

Pure functions, fully deterministic when given an injected RNG and clock. The implementer must use `luxon` for timezone handling; if not already a dependency, add it: `pnpm --filter @flipturn/workers add luxon` and `pnpm --filter @flipturn/workers add -D @types/luxon`.

- [ ] **Step 1: Write the failing tests**

Create `apps/server/workers/tests/scheduler/window.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import {
  isInActiveWindow,
  sampleFireTimeForDate,
  sampleInterRequestDelayMs,
  sampleReadPauseMs,
  pickWeekdayForWeek,
  CRAWL_TZ,
} from '../../src/scheduler/window';

const seededRng = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
};

describe('isInActiveWindow', () => {
  it('accepts 19:30 ET', () => {
    const t = DateTime.fromISO('2026-05-12T19:30', { zone: CRAWL_TZ });
    expect(isInActiveWindow(t)).toBe(true);
  });
  it('rejects 03:00 ET', () => {
    const t = DateTime.fromISO('2026-05-12T03:00', { zone: CRAWL_TZ });
    expect(isInActiveWindow(t)).toBe(false);
  });
  it('rejects 23:00 ET (after window)', () => {
    const t = DateTime.fromISO('2026-05-12T23:00', { zone: CRAWL_TZ });
    expect(isInActiveWindow(t)).toBe(false);
  });
});

describe('sampleFireTimeForDate', () => {
  it('1000 samples all land inside the 16:00–22:30 ET window', () => {
    const rng = seededRng(42);
    const date = DateTime.fromISO('2026-05-12', { zone: CRAWL_TZ });
    for (let i = 0; i < 1000; i++) {
      const t = sampleFireTimeForDate(date, rng);
      expect(isInActiveWindow(t)).toBe(true);
    }
  });
  it('triangular distribution: most samples near 19:30', () => {
    const rng = seededRng(7);
    const date = DateTime.fromISO('2026-05-12', { zone: CRAWL_TZ });
    let near = 0;
    for (let i = 0; i < 1000; i++) {
      const t = sampleFireTimeForDate(date, rng);
      const minutesFromPeak = Math.abs(t.hour * 60 + t.minute - (19 * 60 + 30));
      if (minutesFromPeak < 90) near++;
    }
    expect(near).toBeGreaterThan(400); // > 40% within 90 min of peak
  });
});

describe('sampleInterRequestDelayMs', () => {
  it('returns values in [1500, 4000]', () => {
    const rng = seededRng(1);
    for (let i = 0; i < 1000; i++) {
      const d = sampleInterRequestDelayMs(rng);
      expect(d).toBeGreaterThanOrEqual(1500);
      expect(d).toBeLessThanOrEqual(4000);
    }
  });
  it('mean is between 2.5s and 3.0s', () => {
    const rng = seededRng(2);
    let sum = 0;
    const n = 5000;
    for (let i = 0; i < n; i++) sum += sampleInterRequestDelayMs(rng);
    const mean = sum / n;
    expect(mean).toBeGreaterThan(2500);
    expect(mean).toBeLessThan(3000);
  });
});

describe('sampleReadPauseMs', () => {
  it('returns 0 about 80% of the time', () => {
    const rng = seededRng(3);
    let zero = 0;
    const n = 5000;
    for (let i = 0; i < n; i++) if (sampleReadPauseMs(rng) === 0) zero++;
    expect(zero / n).toBeGreaterThan(0.75);
    expect(zero / n).toBeLessThan(0.85);
  });
  it('non-zero values are in [1, 800]', () => {
    const rng = seededRng(4);
    for (let i = 0; i < 5000; i++) {
      const v = sampleReadPauseMs(rng);
      if (v > 0) {
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(800);
      }
    }
  });
});

describe('pickWeekdayForWeek', () => {
  it('always returns Mon–Fri (1..5 in ISO weekday)', () => {
    const rng = seededRng(5);
    const weekStart = DateTime.fromISO('2026-05-11', { zone: CRAWL_TZ }); // Mon
    for (let i = 0; i < 100; i++) {
      const d = pickWeekdayForWeek(weekStart, rng);
      expect(d.weekday).toBeGreaterThanOrEqual(1);
      expect(d.weekday).toBeLessThanOrEqual(5);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @flipturn/workers test scheduler/window
```
Expected: FAIL with "Cannot find module '../../src/scheduler/window'".

- [ ] **Step 3: Implement `apps/server/workers/src/scheduler/window.ts`**

```typescript
import { DateTime } from 'luxon';

export const CRAWL_TZ = 'America/Toronto';
export const WINDOW_START_HOUR = 16;          // 16:00 ET inclusive
export const WINDOW_END_HOUR = 22;            // 22:30 ET exclusive (end + 30 min)
export const WINDOW_END_MIN = 30;
export const PEAK_HOUR = 19;
export const PEAK_MIN = 30;

export type Rng = () => number;
const defaultRng: Rng = Math.random;

export function isInActiveWindow(t: DateTime): boolean {
  const local = t.setZone(CRAWL_TZ);
  const minutes = local.hour * 60 + local.minute;
  const start = WINDOW_START_HOUR * 60;
  const end = WINDOW_END_HOUR * 60 + WINDOW_END_MIN;
  return minutes >= start && minutes < end;
}

// Triangular distribution peaked at PEAK_HOUR:PEAK_MIN.
export function sampleFireTimeForDate(date: DateTime, rng: Rng = defaultRng): DateTime {
  const local = date.setZone(CRAWL_TZ).startOf('day');
  const startMin = WINDOW_START_HOUR * 60;
  const endMin = WINDOW_END_HOUR * 60 + WINDOW_END_MIN;
  const peakMin = PEAK_HOUR * 60 + PEAK_MIN;
  // Triangular: U = rng(); split point = (peak-start)/(end-start)
  const u = rng();
  const c = (peakMin - startMin) / (endMin - startMin);
  let m: number;
  if (u < c) {
    m = startMin + Math.sqrt(u * (endMin - startMin) * (peakMin - startMin));
  } else {
    m = endMin - Math.sqrt((1 - u) * (endMin - startMin) * (endMin - peakMin));
  }
  const minutes = Math.floor(m);
  return local.plus({ minutes });
}

export function sampleInterRequestDelayMs(rng: Rng = defaultRng): number {
  return 1500 + Math.floor(rng() * (4000 - 1500 + 1));
}

export function sampleReadPauseMs(rng: Rng = defaultRng): number {
  if (rng() < 0.2) return 1 + Math.floor(rng() * 800);
  return 0;
}

// 2026 Canadian statutory holidays (federal/Ontario subset; sufficient for v1).
const STAT_HOLIDAYS_2026 = new Set([
  '2026-01-01', '2026-02-16', '2026-04-03', '2026-05-18', '2026-07-01',
  '2026-08-03', '2026-09-07', '2026-10-12', '2026-12-25', '2026-12-28',
]);

export function pickWeekdayForWeek(mondayInWeek: DateTime, rng: Rng = defaultRng): DateTime {
  const candidates: DateTime[] = [];
  for (let i = 0; i < 5; i++) {
    const d = mondayInWeek.plus({ days: i }).startOf('day');
    if (!STAT_HOLIDAYS_2026.has(d.toISODate() ?? '')) candidates.push(d);
  }
  if (candidates.length === 0) return mondayInWeek; // degenerate; caller can skip
  const idx = Math.floor(rng() * candidates.length);
  return candidates[idx];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @flipturn/workers test scheduler/window
```
Expected: 8 passing tests.

- [ ] **Step 5: Commit**

```bash
git add apps/server/workers/src/scheduler/window.ts apps/server/workers/tests/scheduler/window.test.ts apps/server/workers/package.json pnpm-lock.yaml
git commit -m "feat(workers): scheduler window + jitter helpers (16:00–22:30 ET, triangular)"
```

---

## Task 3: Replace fixed politeness delay with sampled delay

**Files:**
- Modify: `apps/server/workers/src/politeness.ts`
- Test: `apps/server/workers/tests/politeness.test.ts` (add new test or update existing)

- [ ] **Step 1: Read the existing `politeness.ts`** to find the line that defines the fixed inter-request delay (the explore step indicates it lives near line 49 with a `setTimeout` and a `rateLimitMs` config).

```bash
sed -n '1,80p' apps/server/workers/src/politeness.ts
```

- [ ] **Step 2: Update `politeness.ts` to sample the delay per request**

Replace the fixed-delay computation. Show the diff conceptually:

```typescript
// Before (illustrative — match the actual existing code):
//   const waitMs = config.rateLimitMs;
//   await new Promise(r => setTimeout(r, waitMs));

// After:
import {
  sampleInterRequestDelayMs,
  sampleReadPauseMs,
} from './scheduler/window';

// inside acquireToken (or wherever the delay is enforced):
const waitMs = sampleInterRequestDelayMs() + sampleReadPauseMs();
await new Promise(r => setTimeout(r, waitMs));
```

Keep the existing daily budget logic and Redis token-bucket primitives intact. Only the per-request delay computation changes. If there is an exposed `rateLimitMs` config field, leave it as a fallback floor (`Math.max(rateLimitMs, sampleInterRequestDelayMs())`) so callers that pass a higher floor still work.

- [ ] **Step 3: Add or update tests in `apps/server/workers/tests/politeness.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('politeness sampled delay', () => {
  it('inter-request delays are not all identical', async () => {
    const delays: number[] = [];
    vi.useFakeTimers();
    const setSpy = vi.spyOn(global, 'setTimeout');
    setSpy.mockImplementation(((fn: () => void, ms: number) => {
      delays.push(ms);
      fn();
      return 0 as unknown as NodeJS.Timeout;
    }) as unknown as typeof setTimeout);

    // Call the path that triggers the sleep — replace with the actual exposed
    // helper from politeness.ts (e.g. waitForToken('results.swimming.ca')).
    // ...

    const distinct = new Set(delays);
    expect(distinct.size).toBeGreaterThan(1);
    vi.useRealTimers();
  });
});
```

(If the politeness module currently lacks an injectable seam for testing, add one: export `sleepBetweenRequests(host: string)` that does the sampled wait, and call it from `acquireToken`.)

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @flipturn/workers test politeness
```
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/server/workers/src/politeness.ts apps/server/workers/tests/politeness.test.ts
git commit -m "feat(workers): sample inter-request delay 1500–4000 ms + occasional read pause"
```

---

## Task 4: `parseClubDirectory` parser

**Files:**
- Create: `apps/server/workers/src/parser/clubDirectory.ts`
- Create: `apps/server/workers/tests/parser/clubDirectory.test.ts`
- Create: `apps/server/workers/tests/parser/__fixtures__/club-directory.html`

- [ ] **Step 1: Capture a real fixture from `findaclub.swimming.ca`**

```bash
mkdir -p apps/server/workers/tests/parser/__fixtures__
curl -sS \
  -A "FlipturnBot/0.1 (+https://flipturn.ca/about/bot)" \
  "https://findaclub.swimming.ca/" \
  -o apps/server/workers/tests/parser/__fixtures__/club-directory.html
wc -l apps/server/workers/tests/parser/__fixtures__/club-directory.html
```
Expected: a non-empty HTML file (at least a few hundred lines). Open it locally and identify the DOM structure that lists clubs (likely a `<table>` or repeated `<div>` blocks — confirm before writing the parser).

- [ ] **Step 2: Write the failing test**

```typescript
// apps/server/workers/tests/parser/clubDirectory.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseClubDirectory } from '../../src/parser/clubDirectory';

const fixturePath = join(__dirname, '__fixtures__/club-directory.html');
const html = readFileSync(fixturePath, 'utf8');

describe('parseClubDirectory', () => {
  it('returns at least 500 clubs', () => {
    const clubs = parseClubDirectory(html);
    expect(clubs.length).toBeGreaterThan(500);
  });
  it('every club has id, name, province', () => {
    const clubs = parseClubDirectory(html);
    for (const c of clubs) {
      expect(c.id).toMatch(/^[A-Z0-9-]+$/);
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.province).toMatch(/^[A-Z]{2}$/);
    }
  });
  it('finds Club Warriors among Ontario clubs', () => {
    const clubs = parseClubDirectory(html);
    const cw = clubs.find(c => c.name.toLowerCase().includes('club warriors'));
    expect(cw).toBeDefined();
    expect(cw?.province).toBe('ON');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
pnpm --filter @flipturn/workers test parser/clubDirectory
```
Expected: FAIL with "Cannot find module".

- [ ] **Step 4: Implement `parseClubDirectory`**

Use `cheerio` (already in the workers `package.json` for `parseAthletePage`; if not, add it). Inspect the fixture and write selectors that match the actual DOM. Sketch:

```typescript
// apps/server/workers/src/parser/clubDirectory.ts
import { load } from 'cheerio';

export type ParsedClub = {
  id: string;
  name: string;
  shortName?: string;
  province: string;
  city?: string;
  rosterUrl?: string;
};

export function parseClubDirectory(html: string): ParsedClub[] {
  const $ = load(html);
  const clubs: ParsedClub[] = [];
  // EXAMPLE selector — adapt to the real DOM after inspecting the fixture:
  $('tr.club-row').each((_, row) => {
    const $r = $(row);
    const id = $r.attr('data-club-id')?.trim();
    const name = $r.find('.club-name').text().trim();
    const province = $r.find('.club-province').text().trim();
    const city = $r.find('.club-city').text().trim() || undefined;
    const rosterUrl = $r.find('a.club-link').attr('href') || undefined;
    if (!id || !name || !province) return;
    clubs.push({ id, name, province, city, rosterUrl });
  });
  return clubs;
}
```

- [ ] **Step 5: Run the tests; iterate on selectors until they pass**

```bash
pnpm --filter @flipturn/workers test parser/clubDirectory
```
Expected: 3 passing tests.

- [ ] **Step 6: Commit**

```bash
git add apps/server/workers/src/parser/clubDirectory.ts apps/server/workers/tests/parser/clubDirectory.test.ts apps/server/workers/tests/parser/__fixtures__/club-directory.html
git commit -m "feat(workers): parseClubDirectory parser + fixture"
```

---

## Task 5: `parseClubRoster` parser

**Files:**
- Create: `apps/server/workers/src/parser/clubRoster.ts`
- Create: `apps/server/workers/tests/parser/clubRoster.test.ts`
- Create: `apps/server/workers/tests/parser/__fixtures__/club-roster.html`

- [ ] **Step 1: Capture a fixture for one known club** (Club Warriors example; substitute the real URL once the directory parser is run and the canonical roster URL is known)

```bash
curl -sS \
  -A "FlipturnBot/0.1 (+https://flipturn.ca/about/bot)" \
  "https://results.swimming.ca/clubs/<KNOWN-CLUB-ID>/" \
  -o apps/server/workers/tests/parser/__fixtures__/club-roster.html
```

- [ ] **Step 2: Write the failing test**

```typescript
// apps/server/workers/tests/parser/clubRoster.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseClubRoster } from '../../src/parser/clubRoster';

const html = readFileSync(join(__dirname, '__fixtures__/club-roster.html'), 'utf8');

describe('parseClubRoster', () => {
  it('returns at least one swimmer with sncId, primaryName, gender', () => {
    const rows = parseClubRoster(html);
    expect(rows.length).toBeGreaterThan(0);
    const r = rows[0];
    expect(r.sncId).toMatch(/^\d{6,}$/);
    expect(r.primaryName.length).toBeGreaterThan(0);
    expect(['M', 'F', 'X', null]).toContain(r.gender);
  });
  it('dobYear is a 4-digit year when present', () => {
    const rows = parseClubRoster(html);
    for (const r of rows) {
      if (r.dobYear !== null) {
        expect(r.dobYear).toBeGreaterThanOrEqual(1950);
        expect(r.dobYear).toBeLessThanOrEqual(new Date().getFullYear());
      }
    }
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
pnpm --filter @flipturn/workers test parser/clubRoster
```
Expected: FAIL.

- [ ] **Step 4: Implement `parseClubRoster`**

```typescript
// apps/server/workers/src/parser/clubRoster.ts
import { load } from 'cheerio';

export type ParsedRosterRow = {
  sncId: string;
  primaryName: string;
  alternateNames: string[];
  dobYear: number | null;
  gender: 'M' | 'F' | 'X' | null;
};

export function parseClubRoster(html: string): ParsedRosterRow[] {
  const $ = load(html);
  const rows: ParsedRosterRow[] = [];
  // EXAMPLE selector — adapt to the real DOM after inspecting the fixture:
  $('tr.swimmer-row').each((_, row) => {
    const $r = $(row);
    const sncId = $r.attr('data-snc-id')?.trim();
    const primaryName = $r.find('.swimmer-name').text().trim();
    const dobText = $r.find('.swimmer-dob').text().trim();
    const dobYear = /(\d{4})/.exec(dobText)?.[1] ? parseInt(/(\d{4})/.exec(dobText)![1], 10) : null;
    const genderRaw = $r.find('.swimmer-gender').text().trim().toUpperCase();
    const gender = (['M', 'F', 'X'] as const).includes(genderRaw as 'M' | 'F' | 'X')
      ? (genderRaw as 'M' | 'F' | 'X')
      : null;
    if (!sncId || !primaryName) return;
    rows.push({ sncId, primaryName, alternateNames: [], dobYear, gender });
  });
  return rows;
}
```

- [ ] **Step 5: Run tests; iterate on selectors until they pass**

```bash
pnpm --filter @flipturn/workers test parser/clubRoster
```
Expected: 2 passing tests.

- [ ] **Step 6: Commit**

```bash
git add apps/server/workers/src/parser/clubRoster.ts apps/server/workers/tests/parser/clubRoster.test.ts apps/server/workers/tests/parser/__fixtures__/club-roster.html
git commit -m "feat(workers): parseClubRoster parser + fixture"
```

---

## Task 6: New BullMQ queues + enqueue helpers

**Files:**
- Modify: `apps/server/workers/src/queue.ts`
- Test: `apps/server/workers/tests/queue.test.ts` (extend existing or create)

- [ ] **Step 1: Add queue constants and enqueue helpers**

Edit `apps/server/workers/src/queue.ts` and add (alongside the existing `SCRAPE_ATHLETE_QUEUE`):

```typescript
export const CLUB_DIRECTORY_QUEUE = 'club-directory-crawl';
export const CLUB_ROSTER_QUEUE = 'club-roster-crawl';

export type ClubDirectoryCrawlJob = {
  reason: 'cron' | 'admin';
};

export type ClubRosterCrawlJob = {
  clubId: string;
  reason: 'cron' | 'admin' | 'bootstrap';
};

import { Queue } from 'bullmq';
import { getRedis } from './redis'; // adjust path to match existing import

let _directoryQueue: Queue<ClubDirectoryCrawlJob> | null = null;
let _rosterQueue: Queue<ClubRosterCrawlJob> | null = null;

function directoryQueue() {
  if (!_directoryQueue) {
    _directoryQueue = new Queue<ClubDirectoryCrawlJob>(CLUB_DIRECTORY_QUEUE, {
      connection: getRedis(),
    });
  }
  return _directoryQueue;
}

function rosterQueue() {
  if (!_rosterQueue) {
    _rosterQueue = new Queue<ClubRosterCrawlJob>(CLUB_ROSTER_QUEUE, {
      connection: getRedis(),
    });
  }
  return _rosterQueue;
}

export async function enqueueClubDirectoryCrawl(
  reason: ClubDirectoryCrawlJob['reason'] = 'cron',
  delayMs = 0,
): Promise<void> {
  await directoryQueue().add(
    'crawl',
    { reason },
    { delay: delayMs, attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
  );
}

export async function enqueueClubRosterCrawl(
  clubId: string,
  reason: ClubRosterCrawlJob['reason'] = 'cron',
  delayMs = 0,
): Promise<void> {
  await rosterQueue().add(
    `crawl:${clubId}`,
    { clubId, reason },
    {
      delay: delayMs,
      attempts: 5,
      backoff: { type: 'exponential', delay: 60_000 },
      jobId: `crawl:${clubId}:${Math.floor(Date.now() / (24 * 60 * 60 * 1000))}`, // dedup per day
    },
  );
}
```

- [ ] **Step 2: Add tests** that assert the helpers add jobs with the right shape (mock the Queue constructor or use `bullmq`'s in-memory mode).

```typescript
// apps/server/workers/tests/queue.test.ts (extend)
import { describe, it, expect, vi } from 'vitest';
import {
  enqueueClubDirectoryCrawl,
  enqueueClubRosterCrawl,
  CLUB_DIRECTORY_QUEUE,
  CLUB_ROSTER_QUEUE,
} from '../src/queue';

vi.mock('bullmq', () => {
  const adds: Array<{ queueName: string; jobName: string; data: unknown; opts: unknown }> = [];
  return {
    Queue: vi.fn().mockImplementation((name: string) => ({
      add: vi.fn(async (jobName: string, data: unknown, opts: unknown) => {
        adds.push({ queueName: name, jobName, data, opts });
      }),
    })),
    __adds: adds,
  };
});

it('enqueueClubDirectoryCrawl adds a job with reason', async () => {
  await enqueueClubDirectoryCrawl('admin');
  const { __adds } = await import('bullmq');
  const last = (__adds as { queueName: string; data: { reason: string } }[]).at(-1)!;
  expect(last.queueName).toBe(CLUB_DIRECTORY_QUEUE);
  expect(last.data.reason).toBe('admin');
});

it('enqueueClubRosterCrawl uses a daily-dedup jobId', async () => {
  await enqueueClubRosterCrawl('ON-CW', 'bootstrap');
  const { __adds } = await import('bullmq');
  const last = (__adds as { queueName: string; opts: { jobId: string } }[]).at(-1)!;
  expect(last.queueName).toBe(CLUB_ROSTER_QUEUE);
  expect(last.opts.jobId).toMatch(/^crawl:ON-CW:\d+$/);
});
```

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @flipturn/workers test queue
```
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add apps/server/workers/src/queue.ts apps/server/workers/tests/queue.test.ts
git commit -m "feat(workers): club-directory-crawl + club-roster-crawl queues + enqueue helpers"
```

---

## Task 7: `clubDirectoryCrawl` job processor

**Files:**
- Create: `apps/server/workers/src/jobs/clubDirectoryCrawl.ts`
- Test: `apps/server/workers/tests/jobs/clubDirectoryCrawl.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/server/workers/tests/jobs/clubDirectoryCrawl.test.ts
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { runClubDirectoryCrawl } from '../../src/jobs/clubDirectoryCrawl';

const html = readFileSync(
  join(__dirname, '..', 'parser', '__fixtures__', 'club-directory.html'),
  'utf8',
);

describe('runClubDirectoryCrawl', () => {
  it('upserts every parsed club into the DB', async () => {
    const upserts: Array<{ where: { id: string }; create: { name: string } }> = [];
    const prisma = {
      club: {
        upsert: vi.fn(async (args) => {
          upserts.push(args as never);
          return { id: (args as { where: { id: string } }).where.id } as never;
        }),
      },
    } as unknown as PrismaClient;
    const fetcher = vi.fn().mockResolvedValue({ status: 200, body: html });

    const result = await runClubDirectoryCrawl({ prisma, fetch: fetcher });

    expect(fetcher).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://findaclub.swimming.ca/' }),
    );
    expect(result.upserted).toBeGreaterThan(500);
    expect(upserts.every(u => u.where.id && u.create.name)).toBe(true);
  });
  it('throws ParserMismatchError on empty parse', async () => {
    const prisma = { club: { upsert: vi.fn() } } as unknown as PrismaClient;
    const fetcher = vi.fn().mockResolvedValue({ status: 200, body: '<html/>' });
    await expect(runClubDirectoryCrawl({ prisma, fetch: fetcher })).rejects.toThrow(
      /ParserMismatchError/,
    );
  });
});
```

- [ ] **Step 2: Run tests; expect failure**

```bash
pnpm --filter @flipturn/workers test jobs/clubDirectoryCrawl
```
Expected: FAIL.

- [ ] **Step 3: Implement the job**

```typescript
// apps/server/workers/src/jobs/clubDirectoryCrawl.ts
import type { PrismaClient } from '@prisma/client';
import { parseClubDirectory } from '../parser/clubDirectory';

export class ParserMismatchError extends Error {
  constructor(parser: string) {
    super(`ParserMismatchError: ${parser} returned 0 rows`);
    this.name = 'ParserMismatchError';
  }
}

export type FetchFn = (req: { url: string }) => Promise<{ status: number; body: string }>;

export async function runClubDirectoryCrawl(deps: {
  prisma: PrismaClient;
  fetch: FetchFn;
}): Promise<{ upserted: number }> {
  const res = await deps.fetch({ url: 'https://findaclub.swimming.ca/' });
  if (res.status !== 200) throw new Error(`directory fetch failed: ${res.status}`);
  const parsed = parseClubDirectory(res.body);
  if (parsed.length === 0) throw new ParserMismatchError('parseClubDirectory');
  for (const c of parsed) {
    await deps.prisma.club.upsert({
      where: { id: c.id },
      create: {
        id: c.id,
        name: c.name,
        shortName: c.shortName,
        province: c.province,
        city: c.city,
        rosterUrl: c.rosterUrl,
      },
      update: {
        name: c.name,
        shortName: c.shortName,
        province: c.province,
        city: c.city,
        rosterUrl: c.rosterUrl,
      },
    });
  }
  return { upserted: parsed.length };
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @flipturn/workers test jobs/clubDirectoryCrawl
```
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/server/workers/src/jobs/clubDirectoryCrawl.ts apps/server/workers/tests/jobs/clubDirectoryCrawl.test.ts
git commit -m "feat(workers): club-directory-crawl job processor"
```

---

## Task 8: `clubRosterCrawl` job processor

**Files:**
- Create: `apps/server/workers/src/jobs/clubRosterCrawl.ts`
- Test: `apps/server/workers/tests/jobs/clubRosterCrawl.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/server/workers/tests/jobs/clubRosterCrawl.test.ts
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { runClubRosterCrawl } from '../../src/jobs/clubRosterCrawl';

const html = readFileSync(
  join(__dirname, '..', 'parser', '__fixtures__', 'club-roster.html'),
  'utf8',
);

const buildPrisma = (existingFor?: Record<string, { source: 'USER_ONBOARDED' | 'CRAWLED'; primaryName: string }>) => {
  const created: Array<Record<string, unknown>> = [];
  const updated: Array<Record<string, unknown>> = [];
  return {
    created, updated,
    prisma: {
      athlete: {
        findUnique: vi.fn(async (args: unknown) => {
          const a = args as { where: { sncId: string } };
          return existingFor?.[a.where.sncId] ?? null;
        }),
        create: vi.fn(async (args: unknown) => { created.push((args as { data: Record<string, unknown> }).data); return {}; }),
        update: vi.fn(async (args: unknown) => { updated.push(args as Record<string, unknown>); return {}; }),
      },
      club: {
        update: vi.fn(async () => ({})),
        findUnique: vi.fn(async () => ({ id: 'ON-CW', rosterUrl: 'https://results.swimming.ca/clubs/ON-CW/' })),
      },
    } as unknown as PrismaClient,
  };
};

describe('runClubRosterCrawl', () => {
  it('creates new athletes with source=CRAWLED for the given club', async () => {
    const { prisma, created } = buildPrisma();
    const fetcher = vi.fn().mockResolvedValue({ status: 200, body: html });
    const result = await runClubRosterCrawl({ prisma, fetch: fetcher, clubId: 'ON-CW' });
    expect(result.upserted).toBeGreaterThan(0);
    expect(created.every(c => c.clubId === 'ON-CW' && c.source === 'CRAWLED')).toBe(true);
  });

  it('flips source USER_ONBOARDED → CRAWLED when primaryName matches', async () => {
    // Pick the first parsed sncId to seed an existing USER_ONBOARDED record.
    const { parseClubRoster } = await import('../../src/parser/clubRoster');
    const first = parseClubRoster(html)[0];
    const { prisma, updated } = buildPrisma({
      [first.sncId]: { source: 'USER_ONBOARDED', primaryName: first.primaryName },
    });
    const fetcher = vi.fn().mockResolvedValue({ status: 200, body: html });
    await runClubRosterCrawl({ prisma, fetch: fetcher, clubId: 'ON-CW' });
    const target = updated.find(u => (u as { where: { sncId: string } }).where.sncId === first.sncId);
    expect(target).toBeDefined();
    expect((target as { data: { source?: string } }).data.source).toBe('CRAWLED');
  });

  it('does NOT flip source when primaryName differs (sanity guard)', async () => {
    const { parseClubRoster } = await import('../../src/parser/clubRoster');
    const first = parseClubRoster(html)[0];
    const { prisma, updated } = buildPrisma({
      [first.sncId]: { source: 'USER_ONBOARDED', primaryName: 'A Different Name' },
    });
    const fetcher = vi.fn().mockResolvedValue({ status: 200, body: html });
    await runClubRosterCrawl({ prisma, fetch: fetcher, clubId: 'ON-CW' });
    const target = updated.find(u => (u as { where: { sncId: string } }).where.sncId === first.sncId);
    expect((target as { data: { source?: string } }).data.source).toBeUndefined();
  });

  it('leaves source=CRAWLED untouched on subsequent crawls', async () => {
    const { parseClubRoster } = await import('../../src/parser/clubRoster');
    const first = parseClubRoster(html)[0];
    const { prisma, updated } = buildPrisma({
      [first.sncId]: { source: 'CRAWLED', primaryName: first.primaryName },
    });
    const fetcher = vi.fn().mockResolvedValue({ status: 200, body: html });
    await runClubRosterCrawl({ prisma, fetch: fetcher, clubId: 'ON-CW' });
    const target = updated.find(u => (u as { where: { sncId: string } }).where.sncId === first.sncId);
    expect((target as { data: { source?: string } }).data.source).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests; expect failure**

```bash
pnpm --filter @flipturn/workers test jobs/clubRosterCrawl
```
Expected: FAIL.

- [ ] **Step 3: Implement the job**

```typescript
// apps/server/workers/src/jobs/clubRosterCrawl.ts
import type { PrismaClient } from '@prisma/client';
import { parseClubRoster } from '../parser/clubRoster';
import { ParserMismatchError, type FetchFn } from './clubDirectoryCrawl';

export async function runClubRosterCrawl(deps: {
  prisma: PrismaClient;
  fetch: FetchFn;
  clubId: string;
}): Promise<{ upserted: number }> {
  const club = await deps.prisma.club.findUnique({ where: { id: deps.clubId } });
  if (!club) throw new Error(`unknown clubId: ${deps.clubId}`);
  const url = club.rosterUrl ?? `https://results.swimming.ca/clubs/${deps.clubId}/`;

  const res = await deps.fetch({ url });
  if (res.status !== 200) throw new Error(`roster fetch failed: ${res.status}`);
  const rows = parseClubRoster(res.body);
  if (rows.length === 0) throw new ParserMismatchError('parseClubRoster');

  const now = new Date();
  for (const r of rows) {
    const existing = await deps.prisma.athlete.findUnique({ where: { sncId: r.sncId } });

    if (!existing) {
      await deps.prisma.athlete.create({
        data: {
          sncId: r.sncId,
          primaryName: r.primaryName,
          alternateNames: r.alternateNames,
          dobYear: r.dobYear ?? null,
          gender: r.gender ?? undefined,
          clubId: deps.clubId,
          source: 'CRAWLED',
          lastIndexedAt: now,
        },
      });
      continue;
    }

    // Spec §4.4: flip USER_ONBOARDED → CRAWLED only when names match (sanity guard).
    const shouldFlipToCrawled =
      existing.source === 'USER_ONBOARDED' && existing.primaryName === r.primaryName;

    await deps.prisma.athlete.update({
      where: { sncId: r.sncId },
      data: {
        primaryName: r.primaryName,
        alternateNames: r.alternateNames,
        dobYear: r.dobYear ?? null,
        gender: r.gender ?? undefined,
        clubId: deps.clubId,
        lastIndexedAt: now,
        ...(shouldFlipToCrawled ? { source: 'CRAWLED' as const } : {}),
      },
    });
  }

  await deps.prisma.club.update({
    where: { id: deps.clubId },
    data: { lastCrawledAt: now },
  });

  return { upserted: rows.length };
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @flipturn/workers test jobs/clubRosterCrawl
```
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/server/workers/src/jobs/clubRosterCrawl.ts apps/server/workers/tests/jobs/clubRosterCrawl.test.ts
git commit -m "feat(workers): club-roster-crawl job processor"
```

---

## Task 9: Daily fan-out scheduler

**Files:**
- Create: `apps/server/workers/src/scheduler/scheduler.ts`
- Test: `apps/server/workers/tests/scheduler/scheduler.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/server/workers/tests/scheduler/scheduler.test.ts
import { describe, it, expect, vi } from 'vitest';
import { DateTime } from 'luxon';
import type { PrismaClient } from '@prisma/client';
import { planDailyCrawls, BATCHES_PER_CYCLE } from '../../src/scheduler/scheduler';
import { CRAWL_TZ, isInActiveWindow } from '../../src/scheduler/window';

const seededRng = (seed: number) => {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
};

describe('planDailyCrawls', () => {
  it('returns ⌈total/30⌉ entries ordered by priority then lastCrawledAt', async () => {
    const clubs = [
      { id: 'A', crawlPriority: 1000, lastCrawledAt: null },
      { id: 'B', crawlPriority: 500,  lastCrawledAt: new Date('2026-04-01') },
      { id: 'C', crawlPriority: 0,    lastCrawledAt: new Date('2026-01-01') },
      { id: 'D', crawlPriority: 0,    lastCrawledAt: new Date('2026-04-15') },
    ];
    const prisma = {
      club: {
        count: vi.fn(async () => clubs.length),
        findMany: vi.fn(async (args: unknown) => {
          const a = args as { take: number };
          return clubs.slice(0, a.take);
        }),
      },
    } as unknown as PrismaClient;
    const today = DateTime.fromISO('2026-05-12', { zone: CRAWL_TZ });

    const plan = await planDailyCrawls({ prisma, today, rng: seededRng(1) });

    expect(plan.length).toBe(Math.ceil(clubs.length / BATCHES_PER_CYCLE));
    for (const entry of plan) {
      expect(isInActiveWindow(entry.fireAt)).toBe(true);
    }
  });

  it('refuses to plan if the active window for today has already passed', async () => {
    const prisma = {
      club: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
    } as unknown as PrismaClient;
    const today = DateTime.fromISO('2026-05-12T23:30', { zone: CRAWL_TZ });
    await expect(planDailyCrawls({ prisma, today, rng: seededRng(1) })).rejects.toThrow(/window/);
  });
});
```

- [ ] **Step 2: Run tests; expect failure**

```bash
pnpm --filter @flipturn/workers test scheduler/scheduler
```
Expected: FAIL.

- [ ] **Step 3: Implement the scheduler**

```typescript
// apps/server/workers/src/scheduler/scheduler.ts
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

export const BATCHES_PER_CYCLE = 30; // refresh every ~30 active days

export type PlannedCrawl = { clubId: string; fireAt: DateTime };

export async function planDailyCrawls(deps: {
  prisma: PrismaClient;
  today: DateTime;
  rng?: Rng;
}): Promise<PlannedCrawl[]> {
  const today = deps.today.setZone(CRAWL_TZ);
  // If the window has already closed for today, refuse.
  const windowEnd = today.startOf('day').plus({ hours: WINDOW_END_HOUR, minutes: WINDOW_END_MIN });
  if (today > windowEnd) {
    throw new Error('planDailyCrawls: active window has already closed for today');
  }

  const total = await deps.prisma.club.count();
  if (total === 0) return [];
  const take = Math.ceil(total / BATCHES_PER_CYCLE);

  const clubs = await deps.prisma.club.findMany({
    select: { id: true },
    orderBy: [{ crawlPriority: 'desc' }, { lastCrawledAt: { sort: 'asc', nulls: 'first' } }],
    take,
  });

  // Shuffle (Fisher–Yates with injected RNG)
  const rng = deps.rng ?? Math.random;
  const arr = [...clubs];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  const plan: PlannedCrawl[] = [];
  for (const c of arr) {
    let fireAt = sampleFireTimeForDate(today, rng);
    // Clamp: never in the past.
    if (fireAt < today) fireAt = today.plus({ minutes: 1 });
    if (!isInActiveWindow(fireAt)) continue;
    plan.push({ clubId: c.id, fireAt });
  }
  return plan;
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @flipturn/workers test scheduler/scheduler
```
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/server/workers/src/scheduler/scheduler.ts apps/server/workers/tests/scheduler/scheduler.test.ts
git commit -m "feat(workers): daily fan-out scheduler with priority + jittered fire times"
```

---

## Task 10: Wire processors and cron into `worker.ts`

**Files:**
- Modify: `apps/server/workers/src/worker.ts`

- [ ] **Step 1: Read the current `worker.ts`** to find where the `SCRAPE_ATHLETE_QUEUE` worker is constructed and where bootstrapping happens.

```bash
sed -n '1,80p' apps/server/workers/src/worker.ts
```

- [ ] **Step 2: Add new BullMQ workers and a daily cron**

Append (or merge) this near the bottom of `worker.ts`:

```typescript
import { Worker, Queue } from 'bullmq';
import { DateTime } from 'luxon';
import {
  CLUB_DIRECTORY_QUEUE,
  CLUB_ROSTER_QUEUE,
  type ClubDirectoryCrawlJob,
  type ClubRosterCrawlJob,
  enqueueClubRosterCrawl,
} from './queue';
import { politeFetch } from './fetch';
import { runClubDirectoryCrawl } from './jobs/clubDirectoryCrawl';
import { runClubRosterCrawl } from './jobs/clubRosterCrawl';
import { planDailyCrawls } from './scheduler/scheduler';
import { CRAWL_TZ, pickWeekdayForWeek } from './scheduler/window';
import { getRedis } from './redis'; // adjust if path differs
import { prisma } from './prisma'; // adjust to existing prisma export

const indexCrawlEnabled = process.env.INDEX_CRAWL_ENABLED === 'true';

if (indexCrawlEnabled) {
  new Worker<ClubDirectoryCrawlJob>(
    CLUB_DIRECTORY_QUEUE,
    async (_job) => {
      return runClubDirectoryCrawl({ prisma, fetch: politeFetch });
    },
    { connection: getRedis(), concurrency: 1 },
  );

  new Worker<ClubRosterCrawlJob>(
    CLUB_ROSTER_QUEUE,
    async (job) => {
      return runClubRosterCrawl({ prisma, fetch: politeFetch, clubId: job.data.clubId });
    },
    { connection: getRedis(), concurrency: 1 },
  );

  // Daily fan-out planner — runs once a day at 15:55 ET (just before the window).
  // We use a BullMQ repeatable job rather than node-cron so the scheduling state lives in Redis.
  const planQueue = new Queue('club-roster-plan', { connection: getRedis() });
  planQueue.add(
    'plan',
    {},
    {
      repeat: { pattern: '55 15 * * *', tz: CRAWL_TZ },
      jobId: 'club-roster-plan-cron',
    },
  );

  new Worker(
    'club-roster-plan',
    async () => {
      const today = DateTime.now().setZone(CRAWL_TZ);
      const plan = await planDailyCrawls({ prisma, today });
      for (const { clubId, fireAt } of plan) {
        const delayMs = Math.max(0, fireAt.toMillis() - today.toMillis());
        await enqueueClubRosterCrawl(clubId, 'cron', delayMs);
      }
    },
    { connection: getRedis(), concurrency: 1 },
  );

  // Weekly directory crawl — picks a random Mon–Fri inside the window.
  const dirPlanQueue = new Queue('club-directory-plan', { connection: getRedis() });
  dirPlanQueue.add(
    'plan',
    {},
    {
      repeat: { pattern: '0 14 * * 0', tz: CRAWL_TZ }, // Sun 14:00 ET → schedule for the upcoming week
      jobId: 'club-directory-plan-cron',
    },
  );
  new Worker(
    'club-directory-plan',
    async () => {
      const now = DateTime.now().setZone(CRAWL_TZ);
      const monday = now.plus({ days: ((1 - now.weekday + 7) % 7) || 7 }).startOf('day');
      const day = pickWeekdayForWeek(monday);
      const fireAt = day.set({ hour: 19, minute: 30 }); // approx peak
      const delayMs = Math.max(0, fireAt.toMillis() - now.toMillis());
      const { enqueueClubDirectoryCrawl } = await import('./queue');
      await enqueueClubDirectoryCrawl('cron', delayMs);
    },
    { connection: getRedis(), concurrency: 1 },
  );
}
```

- [ ] **Step 3: Run the existing test suite to confirm nothing regressed**

```bash
pnpm --filter @flipturn/workers test
```
Expected: all existing tests still pass; no new tests for this wiring (it's a thin orchestration layer best validated by the integration test in Task 12).

- [ ] **Step 4: Commit**

```bash
git add apps/server/workers/src/worker.ts
git commit -m "feat(workers): register crawl processors + daily/weekly plan crons (flag-gated)"
```

---

## Task 11: Beta priority seed script

**Files:**
- Create: `apps/server/workers/src/scripts/seedBetaPriorities.ts`
- Test: `apps/server/workers/tests/scripts/seedBetaPriorities.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/server/workers/tests/scripts/seedBetaPriorities.test.ts
import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { resolveAndSeedPriorities, BETA_SEED } from '../../src/scripts/seedBetaPriorities';

describe('resolveAndSeedPriorities', () => {
  it('matches single-result names by ILIKE and updates crawlPriority', async () => {
    const updates: Array<{ where: { id: string }; data: { crawlPriority: number } }> = [];
    const prisma = {
      club: {
        findMany: vi.fn(async (args: unknown) => {
          const a = args as { where: { name: { contains: string } } };
          if (a.where.name.contains.toLowerCase().includes('club warriors'))
            return [{ id: 'ON-CW', name: 'Club Warriors' }];
          return [];
        }),
        update: vi.fn(async (args) => { updates.push(args as never); return {} as never; }),
      },
    } as unknown as PrismaClient;
    const ambiguities = await resolveAndSeedPriorities({
      prisma,
      seed: [{ name: 'Club Warriors', priority: 1000 }],
      onAmbiguous: vi.fn(),
    });
    expect(updates).toEqual([{ where: { id: 'ON-CW' }, data: { crawlPriority: 1000 } }]);
    expect(ambiguities).toEqual([]);
  });

  it('reports ambiguities to the callback when multiple matches are found', async () => {
    const prisma = {
      club: {
        findMany: vi.fn(async () => [
          { id: 'ON-X', name: 'Guelph Marlin Aquatic Club' },
          { id: 'ON-Y', name: 'Guelph Gryphons Swim Club' },
        ]),
        update: vi.fn(),
      },
    } as unknown as PrismaClient;
    const cb = vi.fn();
    const ambiguities = await resolveAndSeedPriorities({
      prisma,
      seed: [{ name: 'Guelph Gryphon', priority: 1000 }],
      onAmbiguous: cb,
    });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(ambiguities).toHaveLength(1);
  });

  it('BETA_SEED contains P1 and P2 entries with documented priorities', () => {
    const p1 = BETA_SEED.filter(e => e.priority === 1000);
    const p2 = BETA_SEED.filter(e => e.priority === 500);
    expect(p1.map(e => e.name)).toContain('Club Warriors');
    expect(p1.map(e => e.name)).toContain('Region of Waterloo Swim Club');
    expect(p2.length).toBeGreaterThanOrEqual(8);
  });
});
```

- [ ] **Step 2: Run tests; expect failure**

```bash
pnpm --filter @flipturn/workers test scripts/seedBetaPriorities
```
Expected: FAIL.

- [ ] **Step 3: Implement the script**

```typescript
// apps/server/workers/src/scripts/seedBetaPriorities.ts
import type { PrismaClient } from '@prisma/client';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

export type SeedEntry = { name: string; priority: number };

export const BETA_SEED: SeedEntry[] = [
  // P1 — Owner home clubs (Waterloo)
  { name: 'Club Warriors', priority: 1000 },
  { name: 'Region of Waterloo Swim Club', priority: 1000 },
  { name: 'Guelph Gryphon', priority: 1000 },
  // P2 — WOSA-region clubs likely at Windsor Regionals
  { name: 'Windsor Aquatic Club', priority: 500 },
  { name: 'Sarnia Rapids', priority: 500 },
  { name: 'London Aquatic Club', priority: 500 },
  { name: 'Cambridge Aquatic Jets', priority: 500 },
  { name: 'Brantford Aquatic Club', priority: 500 },
  { name: 'Burlington Aquatic Devilrays', priority: 500 },
  { name: 'Oakville Aquatic Club', priority: 500 },
  { name: 'Etobicoke Pepsi Swimming', priority: 500 },
  { name: 'Mississauga Aquatic Club', priority: 500 },
  { name: 'North York Aquatic Club', priority: 500 },
];

export type Ambiguity = { seed: SeedEntry; candidates: { id: string; name: string }[] };

export async function resolveAndSeedPriorities(deps: {
  prisma: PrismaClient;
  seed: SeedEntry[];
  onAmbiguous: (a: Ambiguity) => Promise<{ id: string } | null> | { id: string } | null;
}): Promise<Ambiguity[]> {
  const ambiguities: Ambiguity[] = [];
  for (const entry of deps.seed) {
    const matches = await deps.prisma.club.findMany({
      where: { name: { contains: entry.name, mode: 'insensitive' } },
      select: { id: true, name: true },
    });
    if (matches.length === 1) {
      await deps.prisma.club.update({
        where: { id: matches[0].id },
        data: { crawlPriority: entry.priority },
      });
    } else if (matches.length > 1) {
      const choice = await deps.onAmbiguous({ seed: entry, candidates: matches });
      if (choice) {
        await deps.prisma.club.update({ where: { id: choice.id }, data: { crawlPriority: entry.priority } });
      }
      ambiguities.push({ seed: entry, candidates: matches });
    } else {
      ambiguities.push({ seed: entry, candidates: [] });
    }
  }
  return ambiguities;
}

// Interactive entry point — invoked via `pnpm --filter @flipturn/workers seed:beta-priorities`
async function main() {
  const { prisma } = await import('../prisma');
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const ambiguities = await resolveAndSeedPriorities({
    prisma,
    seed: BETA_SEED,
    onAmbiguous: async (a) => {
      console.log(`\nAmbiguity for "${a.seed.name}":`);
      a.candidates.forEach((c, i) => console.log(`  [${i}] ${c.id}  ${c.name}`));
      const ans = (await rl.question('Pick index (or blank to skip): ')).trim();
      if (!ans) return null;
      const idx = parseInt(ans, 10);
      return Number.isFinite(idx) && a.candidates[idx] ? { id: a.candidates[idx].id } : null;
    },
  });
  console.log(`\nSeeding complete. ${ambiguities.length} unresolved/ambiguous entries.`);
  await rl.close();
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
```

Add a script alias in `apps/server/workers/package.json`:
```json
"scripts": {
  "seed:beta-priorities": "tsx src/scripts/seedBetaPriorities.ts"
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @flipturn/workers test scripts/seedBetaPriorities
```
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/server/workers/src/scripts/seedBetaPriorities.ts apps/server/workers/tests/scripts/seedBetaPriorities.test.ts apps/server/workers/package.json
git commit -m "feat(workers): beta priority seed script (Waterloo + WOSA region)"
```

---

## Task 12: Zod schemas for the search API

**Files:**
- Create: `packages/shared/src/schemas/athleteSearch.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/tests/schemas/athleteSearch.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/shared/tests/schemas/athleteSearch.test.ts
import { describe, it, expect } from 'vitest';
import {
  AthleteSearchQuerySchema,
  AthleteSearchResultSchema,
  AthleteSearchResponseSchema,
} from '../../src/schemas/athleteSearch';

describe('AthleteSearchQuerySchema', () => {
  it('accepts a minimal query', () => {
    expect(AthleteSearchQuerySchema.parse({ q: 'felix' })).toEqual({ q: 'felix', limit: 20 });
  });
  it('rejects q shorter than 2 chars', () => {
    expect(() => AthleteSearchQuerySchema.parse({ q: 'f' })).toThrow();
  });
  it('caps limit at 50', () => {
    expect(() => AthleteSearchQuerySchema.parse({ q: 'felix', limit: 100 })).toThrow();
  });
  it('uppercases province', () => {
    expect(AthleteSearchQuerySchema.parse({ q: 'felix', province: 'on' }).province).toBe('ON');
  });
});

describe('AthleteSearchResultSchema', () => {
  it('accepts a fully-populated result', () => {
    expect(() =>
      AthleteSearchResultSchema.parse({
        sncId: '1234567',
        displayName: 'Felix Bechtel',
        alternateNames: [],
        dobYear: 2014,
        gender: 'M',
        club: { id: 'ON-CW', name: 'Club Warriors', province: 'ON' },
        hasFlipturnProfile: false,
        alreadyLinkedToMe: false,
      }),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests; expect failure**

```bash
pnpm --filter @flipturn/shared test schemas/athleteSearch
```
Expected: FAIL.

- [ ] **Step 3: Implement the schemas**

```typescript
// packages/shared/src/schemas/athleteSearch.ts
import { z } from 'zod';

export const AthleteSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(80),
  clubId: z.string().trim().min(1).max(80).optional(),
  province: z.string().trim().length(2).transform(s => s.toUpperCase()).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type AthleteSearchQuery = z.infer<typeof AthleteSearchQuerySchema>;

export const AthleteSearchResultSchema = z.object({
  sncId: z.string(),
  displayName: z.string(),
  alternateNames: z.array(z.string()),
  dobYear: z.number().int().nullable(),
  gender: z.enum(['M', 'F', 'X']).nullable(),
  club: z.object({
    id: z.string(),
    name: z.string(),
    province: z.string().nullable(),
  }).nullable(),
  hasFlipturnProfile: z.boolean(),
  alreadyLinkedToMe: z.boolean(),
});
export type AthleteSearchResult = z.infer<typeof AthleteSearchResultSchema>;

export const AthleteSearchResponseSchema = z.object({
  results: z.array(AthleteSearchResultSchema),
  total: z.number().int().nonnegative(),
});
export type AthleteSearchResponse = z.infer<typeof AthleteSearchResponseSchema>;
```

Re-export from `packages/shared/src/index.ts`:
```typescript
export * from './schemas/athleteSearch';
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @flipturn/shared test schemas/athleteSearch
```
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schemas/athleteSearch.ts packages/shared/src/index.ts packages/shared/tests/schemas/athleteSearch.test.ts
git commit -m "feat(shared): zod schemas for athlete search API"
```

---

## Task 13: `athleteSearch` service (raw SQL)

**Files:**
- Create: `apps/server/api/src/services/athleteSearch.ts`
- Test: `apps/server/api/tests/services/athleteSearch.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/server/api/tests/services/athleteSearch.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { searchAthletes } from '../../src/services/athleteSearch';
import { prisma } from '../../src/prisma'; // adjust path

beforeAll(async () => {
  await prisma.club.upsert({
    where: { id: 'ON-CW' },
    create: { id: 'ON-CW', name: 'Club Warriors', province: 'ON', crawlPriority: 1000 },
    update: {},
  });
  await prisma.athlete.upsert({
    where: { sncId: '9999991' },
    create: { sncId: '9999991', primaryName: 'Felix Bechtel', alternateNames: ['Felix B.'], dobYear: 2014, gender: 'M', clubId: 'ON-CW', source: 'CRAWLED' },
    update: {},
  });
  await prisma.athlete.upsert({
    where: { sncId: '9999992' },
    create: { sncId: '9999992', primaryName: 'Felix Bechtel', alternateNames: [], dobYear: 2010, gender: 'M', clubId: 'ON-CW', source: 'CRAWLED' },
    update: {},
  });
  await prisma.athlete.upsert({
    where: { sncId: '9999993' },
    create: { sncId: '9999993', primaryName: 'Anna Smith', alternateNames: [], dobYear: 2012, gender: 'F', clubId: 'ON-CW', source: 'CRAWLED' },
    update: {},
  });
});

afterAll(async () => {
  await prisma.athlete.deleteMany({ where: { sncId: { in: ['9999991', '9999992', '9999993'] } } });
  await prisma.club.delete({ where: { id: 'ON-CW' } }).catch(() => {});
});

describe('searchAthletes', () => {
  it('finds Felix Bechtel by exact name', async () => {
    const r = await searchAthletes({ prisma, q: 'Felix Bechtel', limit: 20, userId: 'test-user' });
    expect(r.results.length).toBe(2);
    expect(r.results[0].displayName).toBe('Felix Bechtel');
  });

  it('matches with a typo via pg_trgm (Felx Bechtel)', async () => {
    const r = await searchAthletes({ prisma, q: 'Felx Bechtel', limit: 20, userId: 'test-user' });
    expect(r.results.length).toBeGreaterThan(0);
  });

  it('clubId filter narrows results', async () => {
    const r = await searchAthletes({ prisma, q: 'Felix', clubId: 'ON-CW', limit: 20, userId: 'test-user' });
    expect(r.results.every(x => x.club?.id === 'ON-CW')).toBe(true);
  });

  it('returns hasFlipturnProfile + alreadyLinkedToMe flags', async () => {
    const r = await searchAthletes({ prisma, q: 'Felix', limit: 20, userId: 'test-user' });
    for (const item of r.results) {
      expect(typeof item.hasFlipturnProfile).toBe('boolean');
      expect(typeof item.alreadyLinkedToMe).toBe('boolean');
    }
  });
});
```

- [ ] **Step 2: Run tests; expect failure**

```bash
pnpm --filter @flipturn/api test services/athleteSearch
```
Expected: FAIL.

- [ ] **Step 3: Implement the service**

```typescript
// apps/server/api/src/services/athleteSearch.ts
import type { PrismaClient } from '@prisma/client';
import type { AthleteSearchResponse } from '@flipturn/shared';

export async function searchAthletes(args: {
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
    rank: number;
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
        CASE WHEN unaccent(lower(a."primaryName")) = unaccent(lower(${q})) THEN 1.0 ELSE 0 END,
        ts_rank(a."searchVector", plainto_tsquery('simple', unaccent(${q}))),
        similarity(a."primaryName", ${q})
      ) AS rank
    FROM "Athlete" a
    LEFT JOIN "Club" c ON c.id = a."clubId"
    WHERE
      (
        a."searchVector" @@ plainto_tsquery('simple', unaccent(${q}))
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

- [ ] **Step 4: Run tests against the dev DB**

```bash
pnpm --filter @flipturn/api test services/athleteSearch
```
Expected: 4 passing tests.

- [ ] **Step 5: Commit**

```bash
git add apps/server/api/src/services/athleteSearch.ts apps/server/api/tests/services/athleteSearch.test.ts
git commit -m "feat(api): athleteSearch service (tsvector + pg_trgm + UserAthlete join)"
```

---

## Task 14: `GET /v1/athletes/search` route

**Files:**
- Modify: `apps/server/api/src/routes/athletes.ts` (add the search handler)
- Test: `apps/server/api/tests/routes/athleteSearch.test.ts`

- [ ] **Step 1: Read the existing athletes routes file** to follow its style:

```bash
sed -n '1,80p' apps/server/api/src/routes/athletes.ts
```

- [ ] **Step 2: Write the failing integration test**

```typescript
// apps/server/api/tests/routes/athleteSearch.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app'; // adjust path
import { prisma } from '../../src/prisma';

let app: ReturnType<typeof buildApp>;
let cookie: string;

beforeAll(async () => {
  app = buildApp();
  // Seed: a known user + session, plus an athlete to search.
  // Reuse existing test helpers if any; otherwise insert directly:
  const user = await prisma.user.create({ data: { email: 'search-test@example.com' } });
  const session = await prisma.session.create({
    data: { userId: user.id, expiresAt: new Date(Date.now() + 86_400_000) },
  });
  cookie = `flipturn_session=${session.id}`;
  await prisma.club.upsert({ where: { id: 'ON-CW' }, create: { id: 'ON-CW', name: 'Club Warriors', province: 'ON' }, update: {} });
  await prisma.athlete.upsert({
    where: { sncId: '8888881' },
    create: { sncId: '8888881', primaryName: 'Test Felix', alternateNames: [], dobYear: 2014, gender: 'M', clubId: 'ON-CW', source: 'CRAWLED' },
    update: {},
  });
});

afterAll(async () => {
  await prisma.athlete.delete({ where: { sncId: '8888881' } }).catch(() => {});
});

describe('GET /v1/athletes/search', () => {
  it('returns 401 without a session', async () => {
    const res = await app.request('/v1/athletes/search?q=Felix');
    expect(res.status).toBe(401);
  });

  it('returns 400 if q is too short', async () => {
    const res = await app.request('/v1/athletes/search?q=F', { headers: { cookie } });
    expect(res.status).toBe(400);
  });

  it('returns matching athletes for a valid session', async () => {
    const res = await app.request('/v1/athletes/search?q=Felix', { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results[0].sncId).toBe('8888881');
  });
});
```

- [ ] **Step 3: Run tests; expect failure**

```bash
pnpm --filter @flipturn/api test routes/athleteSearch
```
Expected: FAIL (404 from the route not existing).

- [ ] **Step 4: Add the search handler** in `apps/server/api/src/routes/athletes.ts`

Inside the `athletesRoutes(deps)` factory (next to the existing `/onboard` and list routes):

```typescript
import { AthleteSearchQuerySchema } from '@flipturn/shared';
import { searchAthletes } from '../services/athleteSearch';

// ...inside athletesRoutes(deps), after the existing routes:
app.get('/search', sessionMiddleware(deps.prisma), rateLimit({ limit: 50, windowSec: 60 }), async (c) => {
  const parsed = AthleteSearchQuerySchema.safeParse({
    q: c.req.query('q'),
    clubId: c.req.query('clubId'),
    province: c.req.query('province'),
    limit: c.req.query('limit'),
  });
  if (!parsed.success) {
    return c.json({ error: 'invalid_query', issues: parsed.error.issues }, 400);
  }
  // sessionMiddleware sets some user identifier on the context. Verify the
  // exact key by reading apps/server/api/src/middleware/session.ts before
  // wiring this — it's commonly `c.get('userId')` or `c.get('user').id`.
  const userId = c.get('userId') as string;
  const result = await searchAthletes({
    prisma: deps.prisma,
    q: parsed.data.q,
    clubId: parsed.data.clubId,
    province: parsed.data.province,
    limit: parsed.data.limit,
    userId,
  });
  return c.json(result);
});
```

(If the existing `rateLimit` middleware signature differs, match its actual API — likely `rateLimit(redis, { route: 'athlete-search', ... })`.)

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @flipturn/api test routes/athleteSearch
```
Expected: 3 passing tests.

- [ ] **Step 6: Commit**

```bash
git add apps/server/api/src/routes/athletes.ts apps/server/api/tests/routes/athleteSearch.test.ts
git commit -m "feat(api): GET /v1/athletes/search route"
```

---

## Task 15: Admin one-shot crawl endpoints

**Files:**
- Create: `apps/server/api/src/routes/admin.ts`
- Modify: `apps/server/api/src/app.ts` (mount the route)
- Test: `apps/server/api/tests/routes/admin.test.ts`

These bypass the active-window check so the bootstrap (§5.6 of the spec) can run on demand.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/server/api/tests/routes/admin.test.ts
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { buildApp } from '../../src/app';

vi.mock('@flipturn/workers/queue', () => ({
  enqueueClubDirectoryCrawl: vi.fn(async () => undefined),
  enqueueClubRosterCrawl: vi.fn(async () => undefined),
}));

let app: ReturnType<typeof buildApp>;
beforeAll(() => { app = buildApp(); });

describe('admin crawl endpoints', () => {
  it('rejects without admin token', async () => {
    const res = await app.request('/v1/admin/crawl/club-directory', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('enqueues the directory crawl with valid token', async () => {
    const res = await app.request('/v1/admin/crawl/club-directory', {
      method: 'POST',
      headers: { 'x-admin-token': process.env.ADMIN_TOKEN ?? 'test-admin-token' },
    });
    expect(res.status).toBe(202);
  });

  it('enqueues per-club roster crawls', async () => {
    const res = await app.request('/v1/admin/crawl/club-roster', {
      method: 'POST',
      headers: {
        'x-admin-token': process.env.ADMIN_TOKEN ?? 'test-admin-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ clubIds: ['ON-CW', 'ON-ROW'] }),
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.enqueued).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests; expect failure**

```bash
pnpm --filter @flipturn/api test routes/admin
```
Expected: FAIL.

- [ ] **Step 3: Implement the route**

```typescript
// apps/server/api/src/routes/admin.ts
import { Hono } from 'hono';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import {
  enqueueClubDirectoryCrawl,
  enqueueClubRosterCrawl,
} from '@flipturn/workers/queue';

const RosterBody = z.object({ clubIds: z.array(z.string().min(1)).min(1).max(100) });

export function adminRoutes(_prisma: PrismaClient) {
  // _prisma reserved for Task 16's index-stats handler; unused in this task.
  const app = new Hono();

  app.use('*', async (c, next) => {
    const expected = process.env.ADMIN_TOKEN;
    const got = c.req.header('x-admin-token');
    if (!expected || got !== expected) return c.json({ error: 'unauthorized' }, 401);
    await next();
  });

  app.post('/crawl/club-directory', async (c) => {
    await enqueueClubDirectoryCrawl('admin');
    return c.json({ enqueued: 1 }, 202);
  });

  app.post('/crawl/club-roster', async (c) => {
    const body = RosterBody.safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid_body', issues: body.error.issues }, 400);
    for (const id of body.data.clubIds) await enqueueClubRosterCrawl(id, 'admin');
    return c.json({ enqueued: body.data.clubIds.length }, 202);
  });

  return app;
}
```

Mount in `apps/server/api/src/app.ts`:
```typescript
import { adminRoutes } from './routes/admin';
// ... after the other app.route() calls:
app.route('/v1/admin', adminRoutes(deps.prisma));
```

- [ ] **Step 4: Run tests**

```bash
ADMIN_TOKEN=test-admin-token pnpm --filter @flipturn/api test routes/admin
```
Expected: 3 passing tests.

- [ ] **Step 5: Commit**

```bash
git add apps/server/api/src/routes/admin.ts apps/server/api/src/app.ts apps/server/api/tests/routes/admin.test.ts
git commit -m "feat(api): admin one-shot crawl endpoints (token-gated, bypass window)"
```

---

## Task 16: Index-stats observability endpoint

**Files:**
- Modify: `apps/server/api/src/routes/admin.ts` (add `GET /index-stats`)
- Test: `apps/server/api/tests/routes/admin.test.ts` (extend)

Covers spec §8.5: lightweight admin visibility into index health without a separate dashboard service.

- [ ] **Step 1: Extend the admin test file**

Append to `apps/server/api/tests/routes/admin.test.ts`:

```typescript
describe('GET /v1/admin/index-stats', () => {
  it('rejects without admin token', async () => {
    const res = await app.request('/v1/admin/index-stats');
    expect(res.status).toBe(401);
  });
  it('returns counts and recent crawls with a valid token', async () => {
    const res = await app.request('/v1/admin/index-stats', {
      headers: { 'x-admin-token': process.env.ADMIN_TOKEN ?? 'test-admin-token' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.totalClubs).toBe('number');
    expect(typeof body.totalAthletes).toBe('number');
    expect(Array.isArray(body.recentCrawls)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests; expect failure**

```bash
ADMIN_TOKEN=test-admin-token pnpm --filter @flipturn/api test routes/admin
```
Expected: the new tests fail (`/index-stats` is 404).

- [ ] **Step 3: Add the handler in `apps/server/api/src/routes/admin.ts`**

Rename the parameter from `_prisma` to `prisma` (Task 15 reserved it) and add the handler after the existing crawl routes:

```typescript
export function adminRoutes(prisma: PrismaClient) {
  const app = new Hono();
  // ... existing auth middleware + crawl routes unchanged ...

  app.get('/index-stats', async (c) => {
    const [totalClubs, totalAthletes, recentCrawls] = await Promise.all([
      prisma.club.count(),
      prisma.athlete.count(),
      prisma.club.findMany({
        where: { lastCrawledAt: { not: null } },
        select: { id: true, name: true, lastCrawledAt: true, crawlPriority: true },
        orderBy: { lastCrawledAt: 'desc' },
        take: 50,
      }),
    ]);
    return c.json({ totalClubs, totalAthletes, recentCrawls });
  });

  return app;
}
```

The mount in `app.ts` already passes `deps.prisma` (set up in Task 15) so no further wiring is needed.

- [ ] **Step 4: Run tests**

```bash
ADMIN_TOKEN=test-admin-token pnpm --filter @flipturn/api test routes/admin
```
Expected: all 5 admin tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/server/api/src/routes/admin.ts apps/server/api/src/app.ts apps/server/api/tests/routes/admin.test.ts
git commit -m "feat(api): admin index-stats endpoint (totals + recent crawls)"
```

---

## Task 17: Full suite + manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Run the full workspace test suite**

```bash
pnpm typecheck && pnpm lint && pnpm test
```
Expected: all green. The pre-existing 143+ test count plus the ~ 25 new tests added by Tasks 2–15.

- [ ] **Step 2: Manual smoke against the dev DB**

```bash
# 1. Bootstrap:
ADMIN_TOKEN=$ADMIN_TOKEN INDEX_CRAWL_ENABLED=true pnpm --filter @flipturn/workers start &
WORKER_PID=$!
curl -X POST -H "x-admin-token: $ADMIN_TOKEN" http://localhost:3000/v1/admin/crawl/club-directory
sleep 30  # wait for the directory crawl to complete

# 2. Verify Club table populated:
docker compose exec postgres psql -U flipturn -d flipturn -c 'SELECT count(*) FROM "Club"'
# Expected: ~1500

# 3. Run priority seed:
pnpm --filter @flipturn/workers seed:beta-priorities
# Expected: prompts on Guelph Gryphon ambiguity; rest auto-resolve.

# 4. Manually fire roster crawls for P1+P2:
curl -X POST -H "x-admin-token: $ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"clubIds":["<resolved-IDs-from-step-3>"]}' \
  http://localhost:3000/v1/admin/crawl/club-roster

# 5. Verify search:
curl -b "flipturn_session=$SESSION_ID" "http://localhost:3000/v1/athletes/search?q=Felix+Bechtel"
# Expected: results array containing Felix's sncId.

kill $WORKER_PID
```

- [ ] **Step 3: Open the PR**

Per the project's PR-based workflow:
```bash
gh pr create --title "feat: athlete search index (backend)" --body-file - <<'EOF'
## Summary
Implements the backend half of the [athlete search spec](docs/superpowers/specs/2026-05-08-01-athlete-search-index-design.md): Canada-wide athlete index with name/club search, sourced from public Swimming Canada pages, scheduled inside a 16:00–22:30 ET window with three layers of jitter.

- New: `Club` model + `Athlete` index columns + `pg_trgm`/`unaccent` extensions + `tsvector` GIN index.
- New: `club-directory-crawl` (weekly) + `club-roster-crawl` (daily fan-out, priority-weighted) BullMQ jobs.
- New: `GET /v1/athletes/search` (auth, rate-limited, fuzzy + tsvector ranked).
- New: admin one-shot endpoints + beta priority seed script.

## Test plan
- [x] Unit + integration tests pass (`pnpm test`).
- [x] Manual smoke: bootstrap → seed → roster crawl → search returns Felix Bechtel's sncId.
- [ ] Reviewer verifies fire-time samples land in 16:00–22:30 ET via `INDEX_CRAWL_ENABLED=true` worker logs.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

---

## Notes for the implementer

- **DI pattern** — every job processor and service takes its dependencies as an argument (`{ prisma, fetch }`). This matches the existing `parseAthletePage` / scrape flow and makes the tests above work without booting BullMQ or hitting the network.
- **Feature flag** — `INDEX_CRAWL_ENABLED=true` gates the cron and processors. Search and admin endpoints are not gated; they're safe with an empty index (returns `{ results: [], total: 0 }`).
- **Don't add `searchVector` in the Prisma schema** — Prisma's TS type would otherwise expect it on every `Athlete` insert. The column is generated; reads can use `Prisma.$queryRaw`.
- **Time zone** — every scheduled timestamp goes through Luxon with `America/Toronto`. Never compare with `new Date()` directly in scheduling code; convert via `DateTime.now().setZone(CRAWL_TZ)`.
- **PR-per-task vs single PR** — project memory says every plan/refactor lands via PR. A single PR for the whole plan is fine; if the diff gets unwieldy, split at Task 12 boundary (data + workers below, search API above).
- **Use Opus 4.7 subagents** for non-trivial tasks per project memory.
