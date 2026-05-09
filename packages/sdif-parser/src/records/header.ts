/**
 * A1 — file header parser.
 *
 * Per `docs/sdif-format-notes.md` (A1 section), the full A1 line layout is:
 *
 * | Cols    | Width | Field                  | Example                       |
 * | ------- | ----- | ---------------------- | ----------------------------- |
 * | 1-2     | 2     | Record code            | `A1`                          |
 * | 3-4     | 2     | Org / file-type code   | `07`                          |
 * | 5-29    | 25    | File description       | `Results From MM to TM    `   |
 * | 30-44   | 15    | Software vendor        | `Hy-Tek, Ltd    `             |
 * | 45-58   | 14    | Software version       | `MM5 7.0Gb     `              |
 * | 59-66   | 8     | File-creation date     | `05032026` (MMDDYYYY)         |
 * | 67-75   | 9     | File-creation time     | `  8:28 PM`                   |
 * | 76-128  | 53    | Host / file owner      | `Etobicoke Swim Club...`      |
 * | 129-130 | 2     | Checksum               | `05` (not validated)          |
 *
 * `body` here is `line.slice(2)`, i.e., the line with the leading "A1" code
 * removed. To map cols *a*-*b* (1-indexed, inclusive) on the full line to a
 * JS slice on the body: `body.slice(a - 3, b - 2)`.
 *
 * Timezone: `.hy3` files carry no timezone information. We interpret the
 * date+time as UTC for v1. Downstream record parsers (e.g. B1 meet dates,
 * D1 athlete DOB) adopt the same convention so meets, swims, and the file
 * header agree on a single time basis. The MMDDYYYY → UTC-midnight portion
 * is shared via `parseMMDDYYYY` in `src/util/date.ts`; only the AM/PM
 * time-of-day piece is unique to A1 and stays local.
 */

import { parseMMDDYYYY } from '../util/date.js';

export interface HeaderRecord {
  /** Software vendor (e.g., "Hy-Tek, Ltd"). */
  generator: string;
  /** Version / product string (e.g., "MM5 7.0Gb"). */
  generatorVersion: string;
  /** File-creation timestamp, interpreted as UTC. */
  generatedAt: Date;
}

/**
 * Parse an A1 record body (line with the leading `A1` code removed).
 *
 * @param body - the A1 line minus its first 2 characters (the record code).
 * @returns the file header metadata.
 */
export function parseHeader(body: string): HeaderRecord {
  const generator = body.slice(30 - 3, 44 - 2).trimEnd();
  const generatorVersion = body.slice(45 - 3, 58 - 2).trimEnd();
  const dateField = body.slice(59 - 3, 66 - 2);
  const timeField = body.slice(67 - 3, 75 - 2);

  const generatedAt = parseDateTime(dateField, timeField);

  return { generator, generatorVersion, generatedAt };
}

/**
 * Combine an MMDDYYYY date field and an "H:MM AM/PM" 9-char right-aligned
 * time field into a single UTC `Date`.
 *
 * The date portion is delegated to the shared `parseMMDDYYYY` helper; only
 * the AM/PM time-of-day parsing (unique to A1) lives here. The time field is
 * 9 characters wide with the form `[ ]H:MM AM` or `HH:MM AM` (right-aligned;
 * padded with leading spaces). The trailing `M` of the AM/PM suffix sits at
 * col 75.
 */
function parseDateTime(dateField: string, timeField: string): Date {
  const datePart = parseMMDDYYYY(dateField);
  if (!datePart) {
    // A1's file-creation date is mandatory; treat zero/blank as a format error
    // rather than silently producing an undefined timestamp.
    throw new Error(`A1 header: unrecognized date field: "${dateField}"`);
  }

  // Time: trim the leading-space padding, then split "H:MM AM" / "HH:MM PM".
  const trimmed = timeField.trim();
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(trimmed);
  if (!match) {
    throw new Error(`A1 header: unrecognized time field: "${timeField}"`);
  }
  let hour = Number.parseInt(match[1]!, 10);
  const minute = Number.parseInt(match[2]!, 10);
  const meridiem = match[3]!.toUpperCase();

  // 12 AM → 0; 12 PM → 12; otherwise PM adds 12.
  if (meridiem === 'AM' && hour === 12) hour = 0;
  else if (meridiem === 'PM' && hour !== 12) hour += 12;

  // Add the time-of-day onto the UTC-midnight returned by parseMMDDYYYY.
  return new Date(datePart.getTime() + (hour * 60 + minute) * 60_000);
}
