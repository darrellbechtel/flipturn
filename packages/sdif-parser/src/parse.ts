/**
 * Top-level `parse(text)` assembler.
 *
 * Glues Tasks 4-8 together: iterates the `tokenize()`d records, dispatches by
 * 2-char record code, and accumulates a `ParsedMeet`.
 *
 * State the assembler must thread between records (because `.hy3` is
 * positional — most records do NOT carry foreign keys back to their parents):
 *
 *   - `currentTeam` (from the most recent C1) — the team-code an immediately
 *     following D1 belongs to. The D1 record itself does not carry a club code.
 *   - `currentAthlete` (from the most recent D1) — the athlete an immediately
 *     following E1+E2 swim pair belongs to. E1/E2 records carry an internal
 *     numeric athlete id but nothing the rest of the file references, so we
 *     thread the more useful `{ lastName, firstName, dob }` ref instead.
 *
 * E1 + E2 PAIRING (critical, differs from the plan's draft):
 * Task 8 implements `parseSwim(e1Body, e2Body | undefined)` because the DQ
 * status flag lives on the E2 (col 13), not the E1. The E1 always appears
 * immediately before its E2 in the file. The assembler therefore BUFFERS the
 * E1's body until either:
 *   (a) the very next record is an E2 → call `parseSwim(e1, e2)`, or
 *   (b) the very next record is anything else (or EOF) → call
 *       `parseSwim(e1, undefined)` and process that next record normally.
 *
 * Records intentionally ignored in v1 (per `docs/sdif-format-notes.md` "what
 * we deliberately do NOT parse"):
 *   - B2 (host venue / class flags)
 *   - C2 (team postal address), C3 (team contact)
 *   - F1 (relay), F2 / F3 (relay swimmer entries)
 *   - G1 (split-detail rows)
 *   - Z0 (file footer)
 *
 * Failure modes:
 *   - D1 with no preceding C1 → throw with line number (would otherwise yield
 *     athletes orphaned from any team).
 *   - E1 with no preceding D1 → throw with line number (would otherwise yield
 *     swims orphaned from any athlete).
 *   - File with no B1 → throw (we cannot return a `ParsedMeet` without a meet).
 */

import { tokenize } from './tokenize.js';
import { parseHeader } from './records/header.js';
import { parseMeet } from './records/meet.js';
import { parseTeam } from './records/team.js';
import { parseAthlete } from './records/athlete.js';
import { parseSwim } from './records/swim.js';
import type { ParsedMeet, ParsedSwim } from './types.js';

/** The `{ lastName, firstName, dob? }` ref attached to every parsed swim. */
type AthleteRef = ParsedSwim['athleteRef'];

export function parse(text: string): ParsedMeet {
  const records = tokenize(text);

  let meet: ParsedMeet['meet'] | undefined;
  let currentTeam: string | undefined;
  let currentAthlete: AthleteRef | undefined;

  const teams: ParsedMeet['teams'] = [];
  const athletes: ParsedMeet['athletes'] = [];
  const swims: ParsedMeet['swims'] = [];

  // E1 + E2 pairing buffer. When `pendingE1` is defined we are mid-pair;
  // `pendingE1Athlete` is the athlete-ref that will be attached when the
  // pair flushes (captured at E1 time so a later D1 can't change it).
  let pendingE1: string | undefined;
  let pendingE1Athlete: AthleteRef | undefined;

  const flushPendingE1 = (e2Body: string | undefined): void => {
    if (pendingE1 === undefined || pendingE1Athlete === undefined) return;
    const swim = parseSwim(pendingE1, e2Body);
    swims.push({ ...swim, athleteRef: pendingE1Athlete });
    pendingE1 = undefined;
    pendingE1Athlete = undefined;
  };

  for (const r of records) {
    // If a non-E2 arrives while we have a buffered E1, flush the E1 alone.
    // (Defensive: in the MSSAC fixture every E1 is immediately followed by
    // an E2, but the spec leaves room for a truncated tail.)
    if (pendingE1 !== undefined && r.code !== 'E2') {
      flushPendingE1(undefined);
    }

    switch (r.code) {
      case 'A1':
        // Existence is the assertion; we don't surface header metadata in v1.
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
        if (currentTeam === undefined) {
          throw new Error(`D1 at line ${r.lineNumber} without preceding C1`);
        }
        const a = parseAthlete(r.body, currentTeam);
        athletes.push(a);
        // Use conditional spread to avoid a `dob: undefined` property under
        // `exactOptionalPropertyTypes`.
        currentAthlete = {
          lastName: a.lastName,
          firstName: a.firstName,
          ...(a.dob !== undefined ? { dob: a.dob } : {}),
        };
        break;
      }

      case 'E1': {
        if (currentAthlete === undefined) {
          throw new Error(`E1 at line ${r.lineNumber} without preceding D1`);
        }
        pendingE1 = r.body;
        pendingE1Athlete = currentAthlete;
        break;
      }

      case 'E2': {
        flushPendingE1(r.body);
        break;
      }

      // F1/F2/F3 (relays), G1 (split detail), B2, C2, C3, Z0 are intentionally
      // dropped in v1 — see file JSDoc + `docs/sdif-format-notes.md`.
      default:
        break;
    }
  }

  // EOF: any pending E1 with no E2 flushes as OFFICIAL with no DQ flag.
  flushPendingE1(undefined);

  if (meet === undefined) {
    throw new Error('No B1 meet record found in file');
  }

  return {
    source: { dataSource: 'SDIF_HOST_UPLOAD_PREVIEW', fixture: 'mssac-hicken-2026' },
    meet,
    teams,
    athletes,
    swims,
  };
}
