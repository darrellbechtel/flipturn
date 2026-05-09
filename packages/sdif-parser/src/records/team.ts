/**
 * C1 — team / club identification parser.
 *
 * Per `docs/sdif-format-notes.md` (C1 section), the full C1 line layout is:
 *
 * | Cols    | Width | Field          | Example                          |
 * | ------- | ----- | -------------- | -------------------------------- |
 * | 1-2     | 2     | Record code    | `C1`                             |
 * | 3-7     | 5     | Team code      | `MSSAC`, `BAD  `, `ESWIM`        |
 * | 8-37    | 30    | Team name      | `Mississauga Aquatic Club     `  |
 * | 38-118  | 81    | Misc / blank   | mostly spaces (not parsed in v1) |
 * | 119-122 | 4     | Athlete counts | `0  0` (HY-TEK leaves zero)      |
 * | 129-130 | 2     | Checksum       | `04` (not validated)             |
 *
 * `body` here is `line.slice(2)`, i.e., the line with the leading `C1` code
 * removed. To map cols *a*-*b* (1-indexed, inclusive) on the full line to a
 * JS slice on the body: `body.slice(a - 3, b - 2)`.
 *
 * Both the team code and team name are left-aligned, padded right with
 * spaces; `trimEnd()` is the consistent convention used by the A1 / B1
 * parsers in this package.
 *
 * Each C1 in the .hy3 is followed by a C2 (postal address) and optionally
 * a C3 (contact). This parser only handles the C1 line itself; the
 * top-level `parse()` assembler (Task 9) is responsible for skipping past
 * any subsequent C2/C3 lines for a given team.
 */

export interface TeamRecord {
  /** SNC / HY-TEK club code, e.g. `"MSSAC"`. Trimmed. */
  code: string;
  /** Full club name, e.g. `"Mississauga Aquatic Club"`. Trimmed. */
  name: string;
}

/**
 * Parse a C1 record body (line with the leading `C1` code removed).
 *
 * @param body - the C1 line minus its first 2 characters (the record code).
 * @returns the team's `{ code, name }`.
 */
export function parseTeam(body: string): TeamRecord {
  const code = body.slice(3 - 3, 7 - 2).trimEnd();
  const name = body.slice(8 - 3, 37 - 2).trimEnd();
  return { code, name };
}
