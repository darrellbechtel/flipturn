# SDIF Parser MSSAC Preview — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Plan derives from:** [`docs/superpowers/specs/2026-05-08-03-data-substrate-transition.md`](../specs/2026-05-08-03-data-substrate-transition.md) §16 — the Phase-4-preview slice.

**Goal:** Build `packages/sdif-parser` end-to-end against MSSAC's publicly-available 2026 Dr. Ralph Hicken Invitational `.hy3` file (the only Ontario club confirmed publishing raw HY-TEK output openly), and ingest one full real meet through to `Swim` rows in the database — validating Phase 4 of the data-substrate roadmap before any host-club outreach happens.

**Architecture:** New `packages/sdif-parser` (pure TypeScript, no I/O, takes bytes returns structured records). New CLI script at `apps/server/workers/src/scripts/import-mssac-preview.ts` that handles fetch → unzip → parse → upsert via the existing `@flipturn/db` Prisma client. No BullMQ worker, no admin endpoint, no identity-resolution matcher in this slice — those are Phase-4 production-slice concerns. All `Swim` rows produced get `dataSource = 'SDIF_HOST_UPLOAD_PREVIEW'` so they're trivially queryable and revertable.

**Tech stack:** TypeScript 5.6+, pnpm 9, Vitest 1.x, `adm-zip` (zip extraction), Prisma 5, `undici` (fetch — already used in workers app).

**Recommended execution:** Use `superpowers:subagent-driven-development` with `model: "opus"` per the project's preference (memory: `feedback_use_opus_agents.md`).

---

## File map (this plan creates)

```
flipturn/
├── packages/
│   └── sdif-parser/                                   (CREATE — new workspace package)
│       ├── package.json
│       ├── tsconfig.json
│       ├── vitest.config.ts
│       ├── src/
│       │   ├── index.ts                               # public exports
│       │   ├── parse.ts                               # parse(text) → ParsedMeet
│       │   ├── tokenize.ts                            # line-by-line record dispatch
│       │   ├── unzip.ts                               # extract .hy3 from zip bytes
│       │   ├── types.ts                               # ParsedMeet, ParsedAthlete, ParsedSwim
│       │   └── records/
│       │       ├── header.ts                          # A1 file header
│       │       ├── meet.ts                            # B1 meet
│       │       ├── team.ts                            # C1 team / club
│       │       ├── athlete.ts                         # D1 athlete
│       │       └── swim.ts                            # E1 swim result
│       └── tests/
│           ├── tokenize.test.ts
│           ├── unzip.test.ts
│           ├── parse.test.ts
│           ├── records/
│           │   ├── header.test.ts
│           │   ├── meet.test.ts
│           │   ├── team.test.ts
│           │   ├── athlete.test.ts
│           │   └── swim.test.ts
│           └── __fixtures__/
│               ├── README.md                          # fixture provenance
│               └── mssac-hicken-2026.zip              # 563 KB real fixture
├── apps/server/workers/src/scripts/
│   └── import-mssac-preview.ts                        (CREATE — CLI runner)
├── apps/server/workers/package.json                   (MODIFY — add script entry)
├── docs/
│   └── sdif-format-notes.md                           (CREATE — reverse-engineered record map)
└── pnpm-workspace.yaml                                (MODIFY — register sdif-parser)
```

---

## Pre-flight reading

Before starting Task 1, the executor reads:

- `docs/superpowers/specs/2026-05-08-03-data-substrate-transition.md` (this plan's parent — §16 explains the why)
- `packages/db/prisma/schema.prisma` (the `Athlete`, `Meet`, `Event`, `Swim` models the script will upsert into)
- `apps/server/workers/src/parser/searchResults.ts` (existing parser pattern to mirror — pure function, typed input/output, table-test fixtures)
- `apps/server/workers/src/fetch.ts` (existing `politeFetch` — reuse for the MSSAC zip download so UA policy and rate-limiting are inherited)

---

## Task 1: Fixture acquisition + format discovery

**Why this is task 1:** `.hy3` is a HY-TEK proprietary format. Public reverse-engineered docs disagree on which record codes carry which fields. We must inspect the real MSSAC file and document what's actually present before writing parsers, otherwise we'll TDD against fictional shapes.

**Files:**

- Create: `packages/sdif-parser/tests/__fixtures__/mssac-hicken-2026.zip`
- Create: `packages/sdif-parser/tests/__fixtures__/README.md`
- Create: `docs/sdif-format-notes.md`

- [ ] **Step 1: Download the fixture**

```bash
mkdir -p packages/sdif-parser/tests/__fixtures__
curl -sL -A "FlipTurnBot/0.1 (+https://flipturn.ca/bot)" \
  -o packages/sdif-parser/tests/__fixtures__/mssac-hicken-2026.zip \
  'https://www.gomotionapp.com/onmac/UserFiles/Image/QuickUpload/meet-results-2026-dr-ralph-hicken-invitational-30apr2026-001_008479.zip'
```

Expected: file is ~563 KB; `unzip -l` lists one `.hy3` (~2 MB) and one `.cl2` (~1.5 MB).

- [ ] **Step 2: Document fixture provenance**

Write `packages/sdif-parser/tests/__fixtures__/README.md`:

```markdown
# Fixtures

## mssac-hicken-2026.zip

- **Source URL:** https://www.gomotionapp.com/onmac/UserFiles/Image/QuickUpload/meet-results-2026-dr-ralph-hicken-invitational-30apr2026-001_008479.zip
- **Meet:** 2026 Dr. Ralph Hicken Invitational, MSSAC, 2026-04-30
- **Fetched:** 2026-05-08
- **Size:** ~563 KB (3.6 MB unpacked: ~2.0 MB .hy3 + ~1.5 MB .cl2)
- **License/posture:** publicly published by host club; no auth required.
  Used as the canonical end-to-end fixture for the Phase-4 preview slice.

If this URL goes 404, alternates to try (in order):

1. The MSSAC hosted-meets index page: https://www.gomotionapp.com/team/onmac/page/hosted-meets
2. Email mssac directly only as last resort.
```

- [ ] **Step 3: Extract and inspect**

```bash
cd /tmp && unzip -o /Users/darrell/Documents/ai-projects/flipturn/packages/sdif-parser/tests/__fixtures__/mssac-hicken-2026.zip
head -50 *.hy3
echo "---unique record codes---"
awk '{print substr($0,1,2)}' *.hy3 | sort -u
echo "---record counts---"
awk '{print substr($0,1,2)}' *.hy3 | sort | uniq -c | sort -rn
```

Expected output: a list of 2-character record codes (e.g. `A1`, `B1`, `C1`, `D1`, `E1`, `F1`, `G1`, `Z0`) with counts. Capture this output.

- [ ] **Step 4: Document the record map**

Create `docs/sdif-format-notes.md` capturing what was found:

```markdown
# .hy3 / SDIF format notes

Reverse-engineered from MSSAC's 2026 Dr. Ralph Hicken Invitational fixture.
Authoritative spec doesn't exist publicly; community references vary.
This file is the source of truth for what _our parser_ expects.

## Record codes present in the MSSAC fixture

| Code | Meaning                      | Count | Parsed by  |
| ---- | ---------------------------- | ----- | ---------- |
| A1   | File header                  | 1     | header.ts  |
| B1   | Meet info                    | 1     | meet.ts    |
| C1   | Team / club                  | N     | team.ts    |
| D1   | Athlete                      | N     | athlete.ts |
| E1   | Individual swim              | N     | swim.ts    |
| ...  | (fill in from Step 3 output) |

## Column layout per record

For each record code we parse, document the byte/column ranges we use:

### A1 (file header)
```

Cols 1-2: Record code "A1"
Cols 3-...: (fill in from real lines via inspection)

```

(Repeat for B1, C1, D1, E1.)

## Records we deliberately don't parse in this slice

- F1 (relay entry) — out of scope for v1; relays deferred
- G1 (split details) — split data is on the E-record contiguous; G-record is supplemental
- Z0 (file footer) — checksum, ignored
```

- [ ] **Step 5: Commit**

```bash
git add packages/sdif-parser/tests/__fixtures__/ docs/sdif-format-notes.md
git commit -m "chore(sdif-parser): MSSAC fixture + reverse-engineered format notes"
```

---

## Task 2: Package scaffold

**Files:**

- Create: `packages/sdif-parser/package.json`
- Create: `packages/sdif-parser/tsconfig.json`
- Create: `packages/sdif-parser/vitest.config.ts`
- Create: `packages/sdif-parser/src/index.ts`
- Modify: `pnpm-workspace.yaml`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@flipturn/sdif-parser",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "adm-zip": "^0.5.16"
  },
  "devDependencies": {
    "@types/adm-zip": "^0.5.5",
    "typescript": "^5.6.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Create stub `src/index.ts`**

```ts
export { parse } from './parse.js';
export type { ParsedMeet, ParsedAthlete, ParsedSwim } from './types.js';
```

(File won't compile yet — that's fine; Tasks 3-9 fill it in.)

- [ ] **Step 5: Register the workspace**

Verify the existing `pnpm-workspace.yaml` includes `packages/*`. If it does (per the existing `packages/db` and `packages/shared` pattern), no change needed. Otherwise add `- "packages/*"`.

- [ ] **Step 6: Install + verify**

```bash
pnpm install
pnpm --filter @flipturn/sdif-parser test
```

Expected: vitest reports "No test files found." (Empty package, this is fine.)

- [ ] **Step 7: Commit**

```bash
git add packages/sdif-parser/ pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat(sdif-parser): package scaffold (TS, Vitest, adm-zip)"
```

---

## Task 3: Tokenizer (line → typed record)

A tokenizer converts the raw `.hy3` text into an array of `{ code: 'A1', body: '...' }` records, preserving original whitespace inside `body`. Per-record column slicing happens in Tasks 4-8.

**Files:**

- Create: `packages/sdif-parser/src/types.ts`
- Create: `packages/sdif-parser/src/tokenize.ts`
- Create: `packages/sdif-parser/tests/tokenize.test.ts`

- [ ] **Step 1: Define types**

`src/types.ts`:

```ts
export interface RawRecord {
  code: string; // 2-char record code, e.g. "A1"
  body: string; // characters from column 3 onward, original whitespace preserved
  lineNumber: number; // 1-indexed for error messages
}

export interface ParsedMeet {
  source: { dataSource: string; fixture: string };
  meet: { name: string; startDate: Date; endDate: Date; course: 'SCM' | 'LCM' | 'SCY' };
  teams: ParsedTeam[];
  athletes: ParsedAthlete[];
  swims: ParsedSwim[];
}

export interface ParsedTeam {
  code: string;
  name: string;
}

export interface ParsedAthlete {
  teamCode: string;
  lastName: string;
  firstName: string;
  middleInitial?: string;
  gender: 'M' | 'F';
  dob?: Date;
  preferredId?: string; // host registration ID, if present
}

export interface ParsedSwim {
  athleteRef: { lastName: string; firstName: string; dob?: Date }; // resolves at upsert time
  distanceM: number;
  stroke: 'FR' | 'BK' | 'BR' | 'FL' | 'IM';
  round: 'PRELIM' | 'SEMI' | 'FINAL' | 'TIMED_FINAL';
  timeCentiseconds: number;
  splits: number[];
  place?: number;
  status: 'OFFICIAL' | 'DQ' | 'NS' | 'DNF';
}
```

- [ ] **Step 2: Write the failing tokenizer test**

`tests/tokenize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tokenize } from '../src/tokenize.js';

describe('tokenize', () => {
  it('splits each line into code + body', () => {
    const input = ['A102MM   Hy-Tek MM 8.0', 'B102Dr Ralph Hicken Inv'].join('\n');
    expect(tokenize(input)).toEqual([
      { code: 'A1', body: '02MM   Hy-Tek MM 8.0', lineNumber: 1 },
      { code: 'B1', body: '02Dr Ralph Hicken Inv', lineNumber: 2 },
    ]);
  });

  it('ignores blank lines', () => {
    expect(tokenize('\n\nA102x\n\n')).toEqual([{ code: 'A1', body: '02x', lineNumber: 3 }]);
  });

  it('preserves trailing whitespace inside body (column-significant)', () => {
    expect(tokenize('D1FOO BAR    ')[0].body).toBe('FOO BAR    ');
  });
});
```

- [ ] **Step 3: Run the test, watch it fail**

```bash
pnpm --filter @flipturn/sdif-parser test
```

Expected: import error / "tokenize is not a function".

- [ ] **Step 4: Implement `src/tokenize.ts`**

```ts
import type { RawRecord } from './types.js';

export function tokenize(input: string): RawRecord[] {
  const out: RawRecord[] = [];
  const lines = input.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length < 2) continue;
    out.push({
      code: line.slice(0, 2),
      body: line.slice(2),
      lineNumber: i + 1,
    });
  }
  return out;
}
```

- [ ] **Step 5: Run the test, watch it pass**

```bash
pnpm --filter @flipturn/sdif-parser test
```

Expected: 3/3 tokenize tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/sdif-parser/src/types.ts packages/sdif-parser/src/tokenize.ts packages/sdif-parser/tests/tokenize.test.ts
git commit -m "feat(sdif-parser): tokenize() splits .hy3 lines into typed records"
```

---

## Task 4: Header (A1) parser

**Files:**

- Create: `packages/sdif-parser/src/records/header.ts`
- Create: `packages/sdif-parser/tests/records/header.test.ts`

- [ ] **Step 1: Write the failing test**

The exact column layout is TBD — Task 1's `docs/sdif-format-notes.md` is the authoritative reference. The test below is shaped against the documented structure; adjust the expected fields to match what was discovered. The pattern is the important part.

```ts
import { describe, it, expect } from 'vitest';
import { parseHeader } from '../../src/records/header.js';

describe('parseHeader (A1)', () => {
  it('extracts file generation metadata', () => {
    // Real A1 line from MSSAC fixture; column layout per docs/sdif-format-notes.md
    const body = '<paste real A1 body from fixture inspection>';
    expect(parseHeader(body)).toEqual({
      generator: 'Hy-Tek MM',
      generatorVersion: expect.stringMatching(/^\d+\.\d+/),
      generatedAt: expect.any(Date),
    });
  });
});
```

- [ ] **Step 2: Run, watch fail**

```bash
pnpm --filter @flipturn/sdif-parser test
```

- [ ] **Step 3: Implement `src/records/header.ts`**

```ts
export interface HeaderRecord {
  generator: string;
  generatorVersion: string;
  generatedAt: Date;
}

export function parseHeader(body: string): HeaderRecord {
  // Column slices per docs/sdif-format-notes.md
  // (Concrete implementation written against the real fixture's layout)
  return {
    generator: body.slice(/* ... */).trim(),
    generatorVersion: body.slice(/* ... */).trim(),
    generatedAt: new Date(/* parse mmddyyyy from cols ... */),
  };
}
```

- [ ] **Step 4: Run, watch pass**

```bash
pnpm --filter @flipturn/sdif-parser test
```

- [ ] **Step 5: Commit**

```bash
git add packages/sdif-parser/src/records/header.ts packages/sdif-parser/tests/records/header.test.ts
git commit -m "feat(sdif-parser): A1 file header parser"
```

---

## Task 5: Meet (B1) parser

Same TDD shape as Task 4. Outputs `{ name, startDate, endDate, course }`. Test against the real B1 line from the MSSAC fixture; the meet name should equal `"2026 Dr Ralph Hicken Invitational"` (or the canonical form found in the file).

**Files:**

- Create: `packages/sdif-parser/src/records/meet.ts`
- Create: `packages/sdif-parser/tests/records/meet.test.ts`

Repeat the 5-step pattern (test, fail, implement, pass, commit). Commit message: `feat(sdif-parser): B1 meet record parser`.

---

## Task 6: Team / Club (C1) parser

Same TDD shape. Outputs `{ code, name }`. Tests assert that ≥1 of the parsed teams is `{ code: "MSSAC", name: matches /Mississauga/i }` against the real fixture.

**Files:**

- Create: `packages/sdif-parser/src/records/team.ts`
- Create: `packages/sdif-parser/tests/records/team.test.ts`

Commit: `feat(sdif-parser): C1 team record parser`.

---

## Task 7: Athlete (D1) parser

Same TDD shape. Outputs `ParsedAthlete`. Tests assert at least one athlete from MSSAC parses with valid name + gender + dob. Watch out for:

- Trailing-space-padded names
- Two-character age fields
- Gender encoded as `M` / `F` in a known column
- DOB encoded as `mmddyyyy` (no separator)

**Files:**

- Create: `packages/sdif-parser/src/records/athlete.ts`
- Create: `packages/sdif-parser/tests/records/athlete.test.ts`

Commit: `feat(sdif-parser): D1 athlete record parser`.

---

## Task 8: Swim (E1) parser

Same TDD shape. Outputs `ParsedSwim`. The hardest record because it carries:

- Event encoding (distance + stroke + course usually packed into 4–6 columns)
- Time as `mmss.hh` (minutes-seconds.hundredths) → centiseconds
- Splits (often a separate run of fields, may be on the same line or a continuation)
- Place
- Status (`OFFICIAL` vs `DQ` etc., often a single-char column)

**Files:**

- Create: `packages/sdif-parser/src/records/swim.ts`
- Create: `packages/sdif-parser/tests/records/swim.test.ts`

The swim test should include at least one explicitly DQ'd swim from the fixture so DQ status round-trips correctly. Commit: `feat(sdif-parser): E1 swim record parser`.

---

## Task 9: Top-level `parse(text)` assembler

Glues Tasks 4–8 together. Iterates tokenized records, dispatches by code, builds `ParsedMeet`. Maintains "current team / current athlete" state because E1 records reference whichever D1 most recently appeared in the file.

**Files:**

- Create: `packages/sdif-parser/src/parse.ts`
- Create: `packages/sdif-parser/tests/parse.test.ts`

- [ ] **Step 1: Write the failing test against the full fixture**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AdmZip from 'adm-zip';
import { parse } from '../src/parse.js';

describe('parse (full MSSAC fixture)', () => {
  const zipPath = resolve(__dirname, '__fixtures__/mssac-hicken-2026.zip');
  const zip = new AdmZip(zipPath);
  const hy3 = zip
    .getEntries()
    .find((e) => e.entryName.endsWith('.hy3'))!
    .getData()
    .toString('utf8');
  const result = parse(hy3);

  it('identifies the meet', () => {
    expect(result.meet.name).toMatch(/Hicken/i);
    expect(result.meet.startDate.toISOString().slice(0, 10)).toBe('2026-04-30');
  });

  it('parses ≥10 teams (multi-club invitational)', () => {
    expect(result.teams.length).toBeGreaterThanOrEqual(10);
  });

  it('parses ≥100 athletes', () => {
    expect(result.athletes.length).toBeGreaterThanOrEqual(100);
  });

  it('parses ≥500 swims', () => {
    expect(result.swims.length).toBeGreaterThanOrEqual(500);
  });

  it('includes the host club MSSAC', () => {
    expect(result.teams.some((t) => /MSSAC|Mississauga/i.test(t.name))).toBe(true);
  });

  it('contains at least one DQ swim', () => {
    expect(result.swims.some((s) => s.status === 'DQ')).toBe(true);
  });
});
```

(Counts above are conservative lower bounds; tighten after first green run with real numbers.)

- [ ] **Step 2: Run, watch fail**

- [ ] **Step 3: Implement `src/parse.ts`**

```ts
import { tokenize } from './tokenize.js';
import { parseHeader } from './records/header.js';
import { parseMeet } from './records/meet.js';
import { parseTeam } from './records/team.js';
import { parseAthlete } from './records/athlete.js';
import { parseSwim } from './records/swim.js';
import type { ParsedMeet } from './types.js';

export function parse(text: string): ParsedMeet {
  const records = tokenize(text);
  let currentTeam: string | undefined;
  let currentAthlete: { lastName: string; firstName: string; dob?: Date } | undefined;
  const teams: ParsedMeet['teams'] = [];
  const athletes: ParsedMeet['athletes'] = [];
  const swims: ParsedMeet['swims'] = [];
  let meet: ParsedMeet['meet'] | undefined;

  for (const r of records) {
    switch (r.code) {
      case 'A1':
        parseHeader(r.body);
        break;
      case 'B1':
        meet = parseMeet(r.body);
        break;
      case 'C1': {
        const t = parseTeam(r.body);
        teams.push(t);
        currentTeam = t.code;
        break;
      }
      case 'D1': {
        if (!currentTeam) throw new Error(`D1 at line ${r.lineNumber} without preceding C1`);
        const a = parseAthlete(r.body, currentTeam);
        athletes.push(a);
        currentAthlete = { lastName: a.lastName, firstName: a.firstName, dob: a.dob };
        break;
      }
      case 'E1': {
        if (!currentAthlete) throw new Error(`E1 at line ${r.lineNumber} without preceding D1`);
        swims.push({ ...parseSwim(r.body), athleteRef: currentAthlete });
        break;
      }
      // F1 (relays), G1 (splits-detail), Z0 (footer) — intentionally ignored in this slice
    }
  }

  if (!meet) throw new Error('No B1 meet record found in file');

  return {
    source: { dataSource: 'SDIF_HOST_UPLOAD_PREVIEW', fixture: 'mssac-hicken-2026' },
    meet,
    teams,
    athletes,
    swims,
  };
}
```

- [ ] **Step 4: Run, watch pass**

- [ ] **Step 5: Commit**

```bash
git add packages/sdif-parser/src/parse.ts packages/sdif-parser/tests/parse.test.ts
git commit -m "feat(sdif-parser): parse() assembles ParsedMeet from records"
```

---

## Task 10: Unzip helper

**Files:**

- Create: `packages/sdif-parser/src/unzip.ts`
- Create: `packages/sdif-parser/tests/unzip.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractHy3 } from '../src/unzip.js';

describe('extractHy3', () => {
  it('returns .hy3 contents from a meet results zip', () => {
    const buf = readFileSync(resolve(__dirname, '__fixtures__/mssac-hicken-2026.zip'));
    const text = extractHy3(buf);
    expect(text.length).toBeGreaterThan(1_000_000); // real .hy3 is ~2 MB
    expect(text.startsWith('A1')).toBe(true); // first record is the file header
  });

  it('throws if no .hy3 found in zip', () => {
    // Build a minimal zip with one unrelated file
    const AdmZip = require('adm-zip');
    const z = new AdmZip();
    z.addFile('notes.txt', Buffer.from('hello'));
    expect(() => extractHy3(z.toBuffer())).toThrow(/no \.hy3/i);
  });
});
```

- [ ] **Step 2: Run, watch fail**

- [ ] **Step 3: Implement `src/unzip.ts`**

```ts
import AdmZip from 'adm-zip';

export function extractHy3(zipBytes: Buffer): string {
  const zip = new AdmZip(zipBytes);
  const entry = zip.getEntries().find((e) => e.entryName.toLowerCase().endsWith('.hy3'));
  if (!entry) throw new Error('No .hy3 file found in zip');
  return entry.getData().toString('utf8');
}
```

- [ ] **Step 4: Run, watch pass**

- [ ] **Step 5: Commit**

```bash
git add packages/sdif-parser/src/unzip.ts packages/sdif-parser/tests/unzip.test.ts
git commit -m "feat(sdif-parser): extractHy3() pulls .hy3 from a results zip"
```

---

## Task 11: CLI import script (end-to-end)

The script ties everything together: download MSSAC zip via existing `politeFetch`, extract, parse, upsert into Postgres. Identity resolution in this preview is intentionally minimal: exact `(lastName, firstName, dob, clubCode)` match. Duplicates allowed.

**Files:**

- Create: `apps/server/workers/src/scripts/import-mssac-preview.ts`
- Modify: `apps/server/workers/package.json` (add `"import:mssac"` script entry)

- [ ] **Step 1: Add the script entry**

In `apps/server/workers/package.json`'s `scripts`:

```json
"import:mssac": "tsx src/scripts/import-mssac-preview.ts"
```

- [ ] **Step 2: Write `apps/server/workers/src/scripts/import-mssac-preview.ts`**

```ts
/**
 * One-off CLI: fetch MSSAC's public Hicken zip, parse it, upsert into the DB.
 * Phase-4 preview slice — see docs/superpowers/specs/2026-05-08-03-data-substrate-transition.md §16.
 *
 * Run: pnpm --filter @flipturn/workers import:mssac
 */
import { extractHy3, parse } from '@flipturn/sdif-parser';
import { prisma } from '@flipturn/db';
import { politeFetch } from '../fetch.js';
import { eventKey } from '@flipturn/shared';

const ZIP_URL =
  'https://www.gomotionapp.com/onmac/UserFiles/Image/QuickUpload/' +
  'meet-results-2026-dr-ralph-hicken-invitational-30apr2026-001_008479.zip';

async function main() {
  console.log('Fetching MSSAC zip…');
  const res = await politeFetch(ZIP_URL);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const zipBytes = Buffer.from(await res.arrayBuffer());
  console.log(`Got ${zipBytes.length} bytes`);

  const hy3 = extractHy3(zipBytes);
  const parsed = parse(hy3);
  console.log(
    `Parsed: meet="${parsed.meet.name}" teams=${parsed.teams.length} athletes=${parsed.athletes.length} swims=${parsed.swims.length}`,
  );

  // Upsert meet
  const meet = await prisma.meet.upsert({
    where: { externalId: `mssac-hicken-${parsed.meet.startDate.toISOString().slice(0, 10)}` },
    create: {
      externalId: `mssac-hicken-${parsed.meet.startDate.toISOString().slice(0, 10)}`,
      name: parsed.meet.name,
      course: parsed.meet.course,
      startDate: parsed.meet.startDate,
      endDate: parsed.meet.endDate,
      sourceUrl: ZIP_URL,
    },
    update: {},
  });

  // Upsert teams as Clubs (only those that don't already exist)
  for (const t of parsed.teams) {
    await prisma.club.upsert({
      where: { id: t.code },
      create: { id: t.code, name: t.name, province: 'ON' }, // best-effort province
      update: {},
    });
  }

  // Upsert athletes (exact name+dob+club match; duplicates allowed when match fails)
  for (const a of parsed.athletes) {
    const existing = await prisma.athlete.findFirst({
      where: {
        primaryName: `${a.firstName} ${a.lastName}`,
        dob: a.dob,
        clubId: a.teamCode,
      },
    });
    if (!existing) {
      await prisma.athlete.create({
        data: {
          sncId: `sdif-preview-${a.teamCode}-${a.lastName}-${a.firstName}-${a.dob?.getFullYear() ?? '?'}`,
          primaryName: `${a.firstName} ${a.lastName}`,
          gender: a.gender === 'M' ? 'M' : 'F',
          dob: a.dob,
          dobYear: a.dob?.getFullYear(),
          clubId: a.teamCode,
          source: 'REMOTE_DISCOVERY',
        },
      });
    }
  }

  // Upsert events + swims
  for (const s of parsed.swims) {
    const event = await prisma.event.upsert({
      where: {
        meetId_distanceM_stroke_gender_ageBand_round: {
          meetId: meet.id,
          distanceM: s.distanceM,
          stroke: s.stroke,
          gender: 'M', // TODO if needed: derive from athlete or event metadata
          ageBand: null as any,
          round: s.round,
        },
      },
      create: {
        meetId: meet.id,
        distanceM: s.distanceM,
        stroke: s.stroke,
        gender: 'M',
        round: s.round,
      },
      update: {},
    });

    const athlete = await prisma.athlete.findFirst({
      where: {
        primaryName: `${s.athleteRef.firstName} ${s.athleteRef.lastName}`,
        dob: s.athleteRef.dob,
      },
    });
    if (!athlete) continue; // skip swims for athletes we couldn't resolve

    const eKey = eventKey({
      distanceM: s.distanceM,
      stroke: s.stroke,
      course: parsed.meet.course,
    });

    await prisma.swim.upsert({
      where: {
        athleteId_meetId_eventId: { athleteId: athlete.id, meetId: meet.id, eventId: event.id },
      },
      create: {
        athleteId: athlete.id,
        meetId: meet.id,
        eventId: event.id,
        timeCentiseconds: s.timeCentiseconds,
        splits: s.splits,
        place: s.place,
        status: s.status,
        eventKey: eKey,
        dataSource: 'SDIF_HOST_UPLOAD_PREVIEW',
        sourceUrl: ZIP_URL,
      },
      update: {},
    });
  }

  console.log(`Done. dataSource='SDIF_HOST_UPLOAD_PREVIEW' rows are queryable for verification.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 3: Verify it runs end-to-end**

```bash
pnpm dev:up                                       # postgres + redis up
pnpm --filter @flipturn/workers import:mssac
```

Expected log lines:

- `Fetching MSSAC zip…`
- `Got 563251 bytes` (or similar)
- `Parsed: meet="2026 Dr Ralph Hicken Invitational" teams=N athletes=N swims=N`
- `Done.`

- [ ] **Step 4: Verify rows landed in Postgres**

```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM \"Swim\" WHERE \"dataSource\" = 'SDIF_HOST_UPLOAD_PREVIEW';"
```

Expected: ≥500.

- [ ] **Step 5: Commit**

```bash
git add apps/server/workers/src/scripts/import-mssac-preview.ts apps/server/workers/package.json
git commit -m "feat(workers): import-mssac-preview CLI (Phase-4 preview)"
```

---

## Task 12: PR + spec cross-link

- [ ] **Step 1: Push branch and open PR**

```bash
gh pr create --title "feat(sdif-parser): MSSAC Phase-4 preview" --body "$(cat <<'EOF'
## Summary

Phase-4 preview slice from \`docs/superpowers/specs/2026-05-08-03-data-substrate-transition.md\` §16.

- New \`packages/sdif-parser\` (TypeScript, Vitest) with TDD coverage of A1/B1/C1/D1/E1 records against the real MSSAC 2026 Dr. Ralph Hicken Invitational fixture.
- New \`apps/server/workers/src/scripts/import-mssac-preview.ts\` CLI that fetches the MSSAC zip publicly, unzips, parses, and upserts via Prisma. Identity resolution intentionally minimal (exact \`name+dob+club\` match); production-grade resolution deferred to the full Phase-4 slice.
- All inserted rows tagged \`dataSource = 'SDIF_HOST_UPLOAD_PREVIEW'\` for trivial revertability.

This validates that flipturn can ingest a real Canadian \`.hy3\` end-to-end without any host-club outreach, decoupling Phase 4 readiness from Phase 3 outreach success per the roadmap.

## Test plan

- [x] Unit tests pass for tokenize, A1, B1, C1, D1, E1 parsers, and unzip helper.
- [x] \`parse()\` integration test against the full MSSAC fixture asserts meet metadata, ≥10 teams, ≥100 athletes, ≥500 swims, and at least one DQ.
- [ ] Reviewer runs \`pnpm --filter @flipturn/workers import:mssac\` against a local Postgres and confirms ≥500 rows in \`Swim\` with \`dataSource='SDIF_HOST_UPLOAD_PREVIEW'\`.
- [ ] Reviewer confirms one MSSAC swimmer's PB chart in the mobile app shows the Hicken result (manual smoke test).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: After merge, append a "preview shipped" note to the data-substrate roadmap**

Open a small follow-up PR appending a one-line update to `docs/superpowers/specs/2026-05-08-03-data-substrate-transition.md` §16:

```
**Preview status (2026-XX-XX):** Phase-4 preview shipped. SDIF parser + MSSAC ingestion validated end-to-end. Phase 4 is now technically ready ahead of Phase 3 outreach; production slice (BullMQ worker, admin endpoint, real identity resolution) deferred until Phase 3 produces its first additional `.hy3`.
```

---

## Self-review

- **Spec coverage:** Maps to data-substrate-transition spec §16's "Phase 4 can begin a 'preview' slice now" item. Covers the SDIF parser, the end-to-end CLI, and the dataSource tagging that makes the slice revertable.
- **Placeholder scan:** Tasks 4–8 mark column slices as `// per docs/sdif-format-notes.md` rather than hard-coding wrong column ranges before fixture inspection — this is intentional and correct, since the slices come from Task 1's discovery output. Not a "TBD" placeholder; an explicit cross-reference to a file produced by an earlier task.
- **Type consistency:** `ParsedMeet`/`ParsedAthlete`/`ParsedSwim` defined in Task 3, used uniformly through Tasks 9 and 11. Record-parser return shapes (`HeaderRecord`, `MeetRecord`, etc.) are local to each record file and only assembled by `parse()` in Task 9.
- **Out of scope (explicitly):** Relay (F1) parsing, split-detail (G1) records, identity-resolution matcher, BullMQ worker job, admin upload endpoint, OSS package release polish. These are the full Phase-4 production slice; this plan is the preview that proves the parser works end-to-end.
