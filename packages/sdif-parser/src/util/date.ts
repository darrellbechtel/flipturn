/**
 * Date helpers for `.hy3` records.
 *
 * `.hy3` files carry no timezone information; per the project convention used
 * by all date-bearing record parsers in this package (A1 file-creation date,
 * B1 meet start/end, D1 athlete DOB, E2 swim date), every date is interpreted
 * as **UTC midnight**. This module is the single source of truth for that
 * conversion so downstream record parsers stay consistent.
 */

/**
 * Parse an 8-character `MMDDYYYY` field into a UTC-midnight `Date`.
 *
 * Returns `undefined` for the all-zero (`00000000`) sentinel and for an
 * empty / all-blank field (per `docs/sdif-format-notes.md` edge-cases:
 * D1 cols 89-96 may be all-zero when the host has no DOB on file or has
 * suppressed it for privacy). Throws on a non-blank, non-numeric string —
 * format violations are surfaced rather than silently dropped.
 *
 * @param field - the 8-character `MMDDYYYY` slice from the source line.
 *                Whitespace-padding is tolerated; passing fewer than 8 chars
 *                is allowed if the trimmed result is empty.
 * @returns the date at UTC midnight, or `undefined` for the zero / blank sentinels.
 */
export function parseMMDDYYYY(field: string): Date | undefined {
  // Empty / all-blank: not a parse error, just absent.
  if (field.trim() === '') return undefined;

  // All-zero: documented sentinel for "DOB unknown / privacy-suppressed".
  if (field === '00000000') return undefined;

  const month = Number.parseInt(field.slice(0, 2), 10);
  const day = Number.parseInt(field.slice(2, 4), 10);
  const year = Number.parseInt(field.slice(4, 8), 10);
  if (
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(year)
  ) {
    throw new Error(`unrecognized MMDDYYYY date field: "${field}"`);
  }
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}
