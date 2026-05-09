import { describe, it, expect } from 'vitest';
import { parseMMDDYYYY } from '../../src/util/date.js';

/**
 * Shared MMDDYYYY → UTC-midnight `Date` helper. Used by A1 (file-creation
 * date), B1 (meet start/end), D1 (athlete DOB), and any future date-bearing
 * record. Per the project convention all `.hy3` dates are interpreted as UTC
 * midnight (no timezone information in the source).
 *
 * The helper additionally handles the zero-DOB sentinel called out in
 * `docs/sdif-format-notes.md` edge-cases section: an all-zero or all-blank
 * 8-char field MUST return `undefined`, not a `Date(year=0)`.
 */
describe('parseMMDDYYYY', () => {
  it('parses a valid MMDDYYYY into a UTC-midnight Date', () => {
    const result = parseMMDDYYYY('05032026');
    expect(result).toBeInstanceOf(Date);
    expect(result?.toISOString()).toBe('2026-05-03T00:00:00.000Z');
  });

  it('parses a leap-year February date (02292024 → 2024-02-29)', () => {
    const result = parseMMDDYYYY('02292024');
    expect(result?.toISOString()).toBe('2024-02-29T00:00:00.000Z');
  });

  it('returns undefined for the all-zero sentinel "00000000"', () => {
    // Per format-notes edge-cases: zero-DOB means "unknown / suppressed";
    // MUST be undefined, not Date(year=0).
    expect(parseMMDDYYYY('00000000')).toBeUndefined();
  });

  it('returns undefined for an all-blank field "        "', () => {
    expect(parseMMDDYYYY('        ')).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(parseMMDDYYYY('')).toBeUndefined();
  });

  it('throws on a non-numeric, non-blank field', () => {
    // Format violations are surfaced rather than silently returning undefined.
    expect(() => parseMMDDYYYY('abcdefgh')).toThrow();
  });
});
