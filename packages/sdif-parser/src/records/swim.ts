/**
 * E1 + E2 — individual swim record parser.
 *
 * Per `docs/sdif-format-notes.md`, an individual swim is encoded as a pair of
 * lines: an `E1` (principal time + entry metadata) followed by an `E2`
 * (round-of-this-pair + status flag + swim date). The two records carry
 * complementary information and must be parsed together because the **DQ flag
 * lives on the E2** (col 13), NOT on the E1 (which only ever shows `N` at
 * col 80 in the fixture).
 *
 * Signature
 * ---------
 * `parseSwim(e1Body, e2Body | undefined)` returns the swim minus its
 * `athleteRef`. The Task 9 assembler is responsible for buffering the most
 * recent D1 athlete and threading its identity into the returned object via
 * spread (`{ ...parseSwim(...), athleteRef: currentAthlete }`).
 *
 * If `e2Body` is undefined (no following E2 — defensive against future fixtures
 * with truncated tails), status defaults to `OFFICIAL`, round defaults to
 * `TIMED_FINAL`, and the time is read from the E1 finals slot (cols 43-50).
 *
 * Field map (1-indexed cols on the full line; body = line.slice(2))
 * ----------------------------------------------------------------
 * E1
 * | Cols   | Field                          | Notes |
 * | ------ | ------------------------------ | ----- |
 * | 16-21  | Distance                       | Right-aligned int (50 / 100 / .. / 1500). |
 * | 22     | Stroke letter                  | A=FR, B=BK, C=BR, D=FL, E=IM. |
 * | 43-50  | Final / principal time (s.hh)  | `0.00` = no swim. |
 * | 51     | Course of final time           | L/S/Y/blank. |
 *
 * E2
 * | Cols   | Field                | Notes |
 * | ------ | -------------------- | ----- |
 * | 3      | Round of this pair   | `F` = final/timed-final, `P` = prelim. |
 * | 4-11   | Time of this round   | s.hh; `0.00` when the round wasn't swum. |
 * | 12     | Course               | L/S/Y/blank. |
 * | 13     | Status flag          | ` `=normal, `Q`=DQ, `R`/`S`=not-a-swim. |
 *
 * Round mapping (v1)
 * ------------------
 * E2 col 3 = `P` → round `PRELIM`.
 * E2 col 3 = `F` → round `TIMED_FINAL`.
 * E2 missing   → round `TIMED_FINAL` (defensive default).
 *
 * Note: HY-TEK encodes a prelim+final swim as TWO complete E1+E2 pairs (one
 * per round — see lines 151/154 of the MSSAC fixture for an example), so each
 * pair is self-describing as PRELIM or TIMED_FINAL/FINAL. Distinguishing
 * `FINAL` from `TIMED_FINAL` requires cross-row analysis (does the same
 * athlete+event also have a `P`-round pair?) and is **deferred to the Task 9
 * assembler or beyond**. For v1, we conservatively label all `F`-round pairs
 * `TIMED_FINAL`; an analytics consumer that needs strict FINAL-vs-prelim
 * pairing can re-derive it post-hoc.
 *
 * Status mapping (v1)
 * -------------------
 * Per format-notes recommendation ("branch only on Q; treat any other
 * non-blank flag as not-a-swim"):
 *   ` ` (blank) → `OFFICIAL`
 *   `Q`         → `DQ`
 *   `R`         → `NS`  (no-second-round / placeholder; semantics ambiguous)
 *   `S`         → `NS`  (scratch)
 *   any other   → `NS`  (unknown not-a-swim)
 *
 * The `R`/`S`/other → `NS` mapping is documented in the format notes' "Open
 * questions" section as not-fully-disambiguated. When a non-MSSAC fixture
 * arrives with additional flag values, this mapping should be revisited.
 *
 * Splits and place
 * ----------------
 * The v1 slice deliberately does NOT parse splits (G1 records are out of
 * scope) or place (E2 cols 14-65 layout is not yet reverse-engineered against
 * the fixture per format-notes E2 section). Returned `splits` is always `[]`
 * and `place` is always `undefined`.
 *
 * Time conversion
 * ---------------
 * `.hy3` time fields are flat seconds with hundredths (e.g. `   27.98` or
 * ` 1153.72`). Convert to centiseconds via `Math.round(parseFloat(s) * 100)`
 * to avoid float drift (`38.21 * 100 = 3820.9999...`; rounded → 3821).
 */

import type { ParsedSwim } from '../types.js';

const STROKE_MAP: Record<string, ParsedSwim['stroke']> = {
  A: 'FR',
  B: 'BK',
  C: 'BR',
  D: 'FL',
  E: 'IM',
};

const ROUND_MAP: Record<string, ParsedSwim['round']> = {
  P: 'PRELIM',
  F: 'TIMED_FINAL',
};

/**
 * Parse an E1 + E2 record pair into a swim minus its athleteRef.
 *
 * @param e1Body - the E1 line minus the leading `E1` code (i.e. line.slice(2)).
 * @param e2Body - the immediately-following E2 line's body, or `undefined` if
 *                 the source has no E2 follower.
 * @returns the parsed swim. The caller (Task 9 assembler) is responsible for
 *          attaching the `athleteRef` from the surrounding D1 record.
 */
export function parseSwim(
  e1Body: string,
  e2Body: string | undefined,
): Omit<ParsedSwim, 'athleteRef'> {
  // ---- E1 fields ----
  // cols 16-21 → body.slice(13, 19)
  const distanceField = e1Body.slice(13, 19);
  const distanceM = Number.parseInt(distanceField.trim(), 10);
  if (!Number.isFinite(distanceM)) {
    throw new Error(`E1 swim: unrecognized distance field "${distanceField}"`);
  }

  // col 22 → body[19]
  const strokeChar = e1Body.slice(19, 20);
  const stroke = STROKE_MAP[strokeChar];
  if (stroke === undefined) {
    throw new Error(`E1 swim: unrecognized stroke letter "${strokeChar}"`);
  }

  // cols 43-50 → body.slice(40, 48)
  const e1TimeField = e1Body.slice(40, 48);
  const e1TimeSeconds = Number.parseFloat(e1TimeField);
  if (!Number.isFinite(e1TimeSeconds)) {
    throw new Error(`E1 swim: unrecognized time field "${e1TimeField}"`);
  }

  // ---- E2 fields (when present) ----
  let round: ParsedSwim['round'] = 'TIMED_FINAL';
  let status: ParsedSwim['status'] = 'OFFICIAL';
  // Default: use E1 time. If E2 is present and carries a non-zero time, that
  // time is the canonical swum-time of THIS round.
  let timeSeconds = e1TimeSeconds;

  if (e2Body !== undefined) {
    // col 3 → body[0]
    const roundChar = e2Body.slice(0, 1);
    const mapped = ROUND_MAP[roundChar];
    // Unknown round chars: keep the defensive default (TIMED_FINAL).
    if (mapped !== undefined) round = mapped;

    // cols 4-11 → body.slice(1, 9)
    const e2TimeField = e2Body.slice(1, 9);
    const e2TimeSeconds = Number.parseFloat(e2TimeField);
    if (Number.isFinite(e2TimeSeconds) && e2TimeSeconds > 0) {
      timeSeconds = e2TimeSeconds;
    }

    // col 13 → body[10]
    const statusChar = e2Body.slice(10, 11);
    if (statusChar === 'Q') {
      status = 'DQ';
    } else if (statusChar !== ' ' && statusChar !== '') {
      // Any other non-blank flag (R, S, or unknown): treat as not-a-swim.
      status = 'NS';
    }
  }

  const timeCentiseconds = Math.round(timeSeconds * 100);

  return {
    distanceM,
    stroke,
    round,
    timeCentiseconds,
    splits: [],
    status,
  };
}
