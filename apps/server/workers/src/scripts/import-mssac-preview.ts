/**
 * One-off CLI: fetch MSSAC's public Hicken zip, parse it (.hy3), upsert into Postgres.
 *
 * Phase-4 preview slice — see docs/superpowers/specs/2026-05-08-03-data-substrate-transition.md §16
 * and docs/superpowers/plans/2026-05-08-04-sdif-parser-mssac-preview.md (Task 11).
 *
 * Run from repo root:
 *   pnpm --filter @flipturn/workers import:mssac
 *
 * Identity resolution is intentionally minimal:
 *   - Athletes: exact (firstName, lastName, dob, clubId) match. When the parser
 *     emits a swim whose athleteRef cannot be resolved by exact match, the
 *     swim is SKIPPED (logged) — not duplicated. Duplicates land only when an
 *     athlete with the same name+dob+club somehow exists twice already.
 *   - Events: upserted per-swim using @@unique(meetId, distanceM, stroke, gender, ageBand, round).
 *     ageBand is treated as the empty string `''` for v1 (the `.hy3` file
 *     lists per-swim results without per-event age divisions; an open-only
 *     sentinel keeps the upsert idempotent).
 *   - Event gender: derived from the athlete's gender for that swim. Age-group
 *     meets are gender-segregated, so athlete.gender == event.gender.
 *
 * KNOWN INEFFICIENCIES (acceptable for a one-off preview, do NOT ship into a
 * worker without rewriting):
 *   - N+1: one athlete.findFirst per parsed athlete (N=748).
 *   - N+1: one athlete.findFirst per parsed swim (N=5646).
 *   - N+1: one event.upsert per parsed swim (N=5646; the @@unique constraint
 *     makes them idempotent so it's correct, just slow).
 *   Expected wall-clock for the MSSAC fixture: 2-5 minutes.
 *
 * SCHEMA-LEVEL DEDUPLICATION:
 *   Swim has @@unique([athleteId, meetId, eventId]). The MSSAC fixture
 *   contains ~36 cases where the same athlete swam the same event in the
 *   same round (e.g., 50FR TIMED_FINAL) with different times — likely two
 *   heats both classified as TIMED_FINAL. These collapse to a single row
 *   on second-upsert (`update: {}` is a no-op). 5646 parsed swims → 5610
 *   DB rows. Acceptable for the preview slice; a future schema change
 *   could add a `heatNumber` to the Swim unique key if we need to keep both.
 *
 * The dataSource string `SDIF_HOST_UPLOAD_PREVIEW` is the audit handle:
 *   SELECT COUNT(*) FROM "Swim" WHERE "dataSource" = 'SDIF_HOST_UPLOAD_PREVIEW';
 *   DELETE FROM "Swim"  WHERE "dataSource" = 'SDIF_HOST_UPLOAD_PREVIEW';
 */

// loadSecrets must run BEFORE getPrisma() / getEnv() so DATABASE_URL is set.
import '../loadSecrets.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'undici';
import { extractHy3, parse } from '@flipturn/sdif-parser';
import { getPrisma, disconnectPrisma } from '@flipturn/db';
import { buildEventKey } from '@flipturn/shared';
import { CRAWLER_DEFAULT_HEADERS } from '../fetch.js';

// Best-effort: also load the repo-root `.env` for developer convenience
// (mirrors how Prisma's CLI auto-loads .env). loadSecrets only reads
// ~/.config/flipturn/secrets.env, which isn't where pnpm dev users keep DB URLs.
loadRepoDotEnv();

const ZIP_URL =
  'https://www.gomotionapp.com/onmac/UserFiles/Image/QuickUpload/' +
  'meet-results-2026-dr-ralph-hicken-invitational-30apr2026-001_008479.zip';

const DATA_SOURCE = 'SDIF_HOST_UPLOAD_PREVIEW';

/**
 * Fetch the MSSAC zip as binary using the same UA/From headers as `politeFetch`
 * (per ADR 0007). We don't go through `politeFetch` itself because that helper
 * stringifies the body for archival, which corrupts binary content.
 */
async function fetchZip(url: string): Promise<Buffer> {
  const { statusCode, body } = await request(url, {
    method: 'GET',
    headers: { ...CRAWLER_DEFAULT_HEADERS },
  });
  if (statusCode < 200 || statusCode >= 300) {
    await body.dump().catch(() => undefined);
    throw new Error(`Fetch failed: HTTP ${statusCode} for ${url}`);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function main(): Promise<void> {
  const prisma = getPrisma();

  console.log('Fetching MSSAC zip…');
  const zipBytes = await fetchZip(ZIP_URL);
  console.log(`Got ${zipBytes.length} bytes`);

  const hy3 = extractHy3(zipBytes);
  const parsed = parse(hy3);
  console.log(
    `Parsed: meet="${parsed.meet.name}" teams=${parsed.teams.length} ` +
      `athletes=${parsed.athletes.length} swims=${parsed.swims.length}`,
  );

  // ── Meet ──────────────────────────────────────────────────────────────
  const meetExternalId = `mssac-hicken-${parsed.meet.startDate.toISOString().slice(0, 10)}`;
  const meet = await prisma.meet.upsert({
    where: { externalId: meetExternalId },
    create: {
      externalId: meetExternalId,
      name: parsed.meet.name,
      course: parsed.meet.course,
      startDate: parsed.meet.startDate,
      endDate: parsed.meet.endDate,
      sourceUrl: ZIP_URL,
    },
    update: {},
  });

  // ── Clubs ─────────────────────────────────────────────────────────────
  // Best-effort: assume Ontario provincial scope for MSSAC's preview. Club
  // rows reconciled to authoritative SNC data later will overwrite name/province.
  for (const t of parsed.teams) {
    await prisma.club.upsert({
      where: { id: t.code },
      create: { id: t.code, name: t.name, province: 'ON' },
      update: {},
    });
  }

  // ── Athletes ──────────────────────────────────────────────────────────
  // Build an in-memory lookup from (name, dob) → ParsedAthlete so each swim
  // can resolve its gender + teamCode. The parser's athletes list is the
  // only source of truth for gender (E1/E2 records carry no gender field).
  type ParsedAthlete = (typeof parsed.athletes)[number];
  const refToAthlete = new Map<string, ParsedAthlete>();
  const refKey = (firstName: string, lastName: string, dob: Date | undefined): string =>
    `${lastName.toLowerCase()}|${firstName.toLowerCase()}|${dob ? dob.toISOString().slice(0, 10) : ''}`;
  for (const a of parsed.athletes) {
    refToAthlete.set(refKey(a.firstName, a.lastName, a.dob), a);
  }

  let athletesCreated = 0;
  for (const a of parsed.athletes) {
    const existing = await prisma.athlete.findFirst({
      where: {
        primaryName: `${a.firstName} ${a.lastName}`,
        ...(a.dob !== undefined ? { dob: a.dob } : { dob: null }),
        clubId: a.teamCode,
      },
    });
    if (existing) continue;

    const yearStr = a.dob ? `${a.dob.getFullYear()}` : 'unknown';
    await prisma.athlete.create({
      data: {
        sncId: `sdif-preview-${a.teamCode}-${a.lastName}-${a.firstName}-${yearStr}`,
        primaryName: `${a.firstName} ${a.lastName}`,
        gender: a.gender,
        ...(a.dob !== undefined ? { dob: a.dob } : { dob: null }),
        ...(a.dob !== undefined ? { dobYear: a.dob.getFullYear() } : {}),
        clubId: a.teamCode,
        source: 'REMOTE_DISCOVERY',
      },
    });
    athletesCreated++;
  }
  console.log(`Athletes: created=${athletesCreated} (existing rows reused)`);

  // ── Events + Swims ────────────────────────────────────────────────────
  let swimsUpserted = 0;
  let swimsSkipped = 0;
  for (const s of parsed.swims) {
    // Resolve gender + teamCode via the parsed athlete list. athleteRef
    // carries name+dob but no gender (D1 holds gender). Age-group meets are
    // gender-segregated, so athlete.gender = event.gender.
    const parsedAthlete = refToAthlete.get(
      refKey(s.athleteRef.firstName, s.athleteRef.lastName, s.athleteRef.dob),
    );
    if (!parsedAthlete) {
      swimsSkipped++;
      continue;
    }

    // Upsert event using athlete's gender; ageBand sentinel '' for "open / no division".
    const event = await prisma.event.upsert({
      where: {
        meetId_distanceM_stroke_gender_ageBand_round: {
          meetId: meet.id,
          distanceM: s.distanceM,
          stroke: s.stroke,
          gender: parsedAthlete.gender,
          ageBand: '',
          round: s.round,
        },
      },
      create: {
        meetId: meet.id,
        distanceM: s.distanceM,
        stroke: s.stroke,
        gender: parsedAthlete.gender,
        ageBand: '',
        round: s.round,
      },
      update: {},
    });

    // Resolve the DB athlete row by exact (name, dob, clubId).
    const dbAthlete = await prisma.athlete.findFirst({
      where: {
        primaryName: `${s.athleteRef.firstName} ${s.athleteRef.lastName}`,
        ...(s.athleteRef.dob !== undefined ? { dob: s.athleteRef.dob } : { dob: null }),
        clubId: parsedAthlete.teamCode,
      },
    });
    if (!dbAthlete) {
      // Could not match this swim to an athlete row — skip rather than fail.
      swimsSkipped++;
      continue;
    }

    const eKey = buildEventKey({
      distanceM: s.distanceM,
      stroke: s.stroke,
      course: parsed.meet.course,
    });

    await prisma.swim.upsert({
      where: {
        athleteId_meetId_eventId: {
          athleteId: dbAthlete.id,
          meetId: meet.id,
          eventId: event.id,
        },
      },
      create: {
        athleteId: dbAthlete.id,
        meetId: meet.id,
        eventId: event.id,
        timeCentiseconds: s.timeCentiseconds,
        splits: s.splits,
        ...(s.place !== undefined ? { place: s.place } : {}),
        status: s.status,
        eventKey: eKey,
        dataSource: DATA_SOURCE,
        sourceUrl: ZIP_URL,
      },
      update: {},
    });
    swimsUpserted++;
  }

  console.log(`Swims: upserted=${swimsUpserted} skipped=${swimsSkipped}`);
  console.log(`Done. dataSource='${DATA_SOURCE}' rows are queryable for verification.`);
}

/**
 * Walk upward from this file's directory looking for a `.env` and merge any
 * keys that aren't already in `process.env`. Equivalent to
 * `dotenv-flow`-lite — kept in-script to avoid a new dependency.
 */
function loadRepoDotEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, '.env');
    try {
      const content = readFileSync(candidate, 'utf8');
      for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (process.env[key] === undefined || process.env[key] === '') {
          process.env[key] = value;
        }
      }
      return;
    } catch {
      // not here; keep walking
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

main()
  .catch((err) => {
    console.error('import-mssac-preview failed:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    void disconnectPrisma();
  });
