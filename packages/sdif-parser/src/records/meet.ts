/**
 * B1 — meet info parser.
 *
 * Per `docs/sdif-format-notes.md` (B1 section), the full B1 line layout is:
 *
 * | Cols    | Width | Field                | Example                                  |
 * | ------- | ----- | -------------------- | ---------------------------------------- |
 * | 1-2     | 2     | Record code          | `B1`                                     |
 * | 3-47    | 45    | Meet name            | `2026 Dr. Ralph Hicken Invitational    ` |
 * | 48-92   | 45    | Facility / venue     | `Etobicoke Olympium Pool              `  |
 * | 93-100  | 8     | Meet start date      | `04302026` (MMDDYYYY)                    |
 * | 101-108 | 8     | Meet end date        | `05032026` (MMDDYYYY)                    |
 * | 109-116 | 8     | Meet age-up date     | `04302026` (MMDDYYYY; usually = start)   |
 * | 117-128 | 12    | Misc (altitude/etc)  | `   0        `                           |
 * | 129-130 | 2     | Checksum             | `47` (not validated)                     |
 *
 * `body` here is `line.slice(2)`, i.e., the line with the leading `B1` code
 * removed. To map cols *a*-*b* (1-indexed, inclusive) on the full line to a
 * JS slice on the body: `body.slice(a - 3, b - 2)`.
 *
 * Course of meet: B1 does NOT carry a course-of-meet flag. The accompanying
 * B2 record holds class/course/qualification flags but is not parsed in v1
 * (see format notes "What we deliberately do NOT parse"). For now, the
 * parser hardcodes `'LCM'` because every E1 in the MSSAC fixture has
 * `course='L'`. **This is a fixture-specific assumption** and must be
 * revisited once we ingest a non-LCM meet — at that point, the recommended
 * fix is to derive course from any E1.course (col 51) at the parse() layer,
 * or wire in a B2 parser, rather than to read course from B1 (B1 doesn't
 * carry it).
 *
 * Timezone: dates are interpreted as UTC midnight, matching the A1 header
 * convention. `.hy3` files carry no timezone information.
 */

export interface MeetRecord {
  /** Meet name, trimmed of trailing whitespace. */
  name: string;
  /** Meet start date at UTC midnight. */
  startDate: Date;
  /** Meet end date at UTC midnight. */
  endDate: Date;
  /** Course of meet. Hardcoded `'LCM'` for v1 — see file JSDoc. */
  course: 'SCM' | 'LCM' | 'SCY';
}

/**
 * Parse a B1 record body (line with the leading `B1` code removed).
 *
 * @param body - the B1 line minus its first 2 characters (the record code).
 * @returns the meet metadata.
 */
export function parseMeet(body: string): MeetRecord {
  const name = body.slice(3 - 3, 47 - 2).trimEnd();
  const startDate = parseDate(body.slice(93 - 3, 100 - 2));
  const endDate = parseDate(body.slice(101 - 3, 108 - 2));

  // See file JSDoc: B1 doesn't carry course; v1 hardcodes LCM (matches all
  // 5,646 E1.course flags in the MSSAC fixture). Revisit when ingesting a
  // non-LCM meet.
  const course: MeetRecord['course'] = 'LCM';

  return { name, startDate, endDate, course };
}

/**
 * Parse an MMDDYYYY date field into a UTC-midnight `Date`.
 */
function parseDate(field: string): Date {
  const month = Number.parseInt(field.slice(0, 2), 10);
  const day = Number.parseInt(field.slice(2, 4), 10);
  const year = Number.parseInt(field.slice(4, 8), 10);
  if (
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(year)
  ) {
    throw new Error(`B1 meet: unrecognized date field: "${field}"`);
  }
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}
