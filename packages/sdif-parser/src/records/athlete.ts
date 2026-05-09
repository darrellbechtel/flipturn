/**
 * D1 — athlete record parser.
 *
 * Per `docs/sdif-format-notes.md` (D1 section), the full D1 line layout is:
 *
 * | Cols    | Width | Field                  | Example                       |
 * | ------- | ----- | ---------------------- | ----------------------------- |
 * | 1-2     | 2     | Record code            | `D1`                          |
 * | 3       | 1     | Gender                 | `F` / `M`                     |
 * | 4-8     | 5     | Internal athlete id    | `51553`                       |
 * | 9-28    | 20    | Last name              | `Williams-Browne     `        |
 * | 29-48   | 20    | First name             | `Sophie              `        |
 * | 49-68   | 20    | Middle name            | `Michal              ` / `""` |
 * | 69      | 1     | Citizenship status     | ` ` / `L` / `N` / ...         |
 * | 70-78   | 9     | SNC registration id    | `140224737`                   |
 * | 89-96   | 8     | Date of birth          | `09242015` (MMDDYYYY)         |
 * | 129-130 | 2     | Checksum               | `21` (not validated)          |
 *
 * `body` here is `line.slice(2)`, i.e., the line with the leading `D1` code
 * removed. To map cols *a*-*b* (1-indexed, inclusive) on the full line to a
 * JS slice on the body: `body.slice(a - 3, b - 2)`.
 *
 * teamCode is supplied as a SECOND parameter rather than extracted from the
 * D1 body: the D1 record itself does NOT carry a club code. Athletes are
 * scoped by the C1 record that precedes them in the file; the top-level
 * `parse()` assembler (Task 9) is responsible for tracking the current C1
 * and threading its team code through here.
 *
 * ⚠️ **Field-name discrepancy.** The `ParsedAthlete` type defined in
 * `src/types.ts` exposes `middleInitial?: string`, but the `.hy3` D1 record
 * carries a 20-char *full middle name* (cols 49-68), not an initial. We keep
 * the field name `middleInitial` for consistency with already-shipped types
 * and store the trimmed full middle name in it (e.g. `"Michal"` for Davidov).
 * Callers that need an actual initial can take `middleInitial.charAt(0)`.
 *
 * Edge cases handled (per format-notes edge-cases section):
 *   - DOB cols 89-96 may be `00000000` in non-MSSAC files (privacy-suppressed
 *     or unknown DOB). The shared `parseMMDDYYYY` helper returns `undefined`
 *     for this sentinel; we propagate it.
 *   - Middle name slot may be all spaces. Empty after trim → `undefined`,
 *     never the empty string.
 *   - SNC registration id (cols 70-78) may be all spaces in non-MSSAC files.
 *     Empty after trim → `undefined`.
 */

import type { ParsedAthlete } from '../types.js';
import { parseMMDDYYYY } from '../util/date.js';

/**
 * Parse a D1 record body (line with the leading `D1` code removed).
 *
 * @param body - the D1 line minus its first 2 characters (the record code).
 * @param teamCode - the trimmed team/club code from the surrounding C1 record.
 * @returns the parsed athlete.
 */
export function parseAthlete(body: string, teamCode: string): ParsedAthlete {
  const genderChar = body.slice(3 - 3, 3 - 2);
  if (genderChar !== 'M' && genderChar !== 'F') {
    throw new Error(`D1 athlete: unrecognized gender char: "${genderChar}"`);
  }
  const gender: 'M' | 'F' = genderChar;

  const lastName = body.slice(9 - 3, 28 - 2).trimEnd();
  const firstName = body.slice(29 - 3, 48 - 2).trimEnd();

  const middleRaw = body.slice(49 - 3, 68 - 2).trimEnd();
  const middleInitial = middleRaw === '' ? undefined : middleRaw;

  const preferredIdRaw = body.slice(70 - 3, 78 - 2).trim();
  const preferredId = preferredIdRaw === '' ? undefined : preferredIdRaw;

  const dob = parseMMDDYYYY(body.slice(89 - 3, 96 - 2));

  const result: ParsedAthlete = {
    teamCode,
    lastName,
    firstName,
    gender,
  };
  if (middleInitial !== undefined) result.middleInitial = middleInitial;
  if (dob !== undefined) result.dob = dob;
  if (preferredId !== undefined) result.preferredId = preferredId;
  return result;
}
