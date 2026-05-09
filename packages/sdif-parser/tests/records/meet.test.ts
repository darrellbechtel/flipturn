import { describe, it, expect } from 'vitest';
import { parseMeet } from '../../src/records/meet.js';

/**
 * The B1 body below is the exact body from the MSSAC 2026 Dr. Ralph Hicken
 * Invitational fixture (`tests/__fixtures__/mssac-hicken-2026.zip`), i.e., the
 * sole B1 line of the .hy3 with its leading "B1" record code stripped.
 *
 * Full B1 line (130 chars):
 *   B12026 Dr. Ralph Hicken Invitational           Etobicoke Olympium Pool                      043020260503202604302026   0        47
 *
 * Per docs/sdif-format-notes.md B1 section:
 *   - cols 3-47   → meet name   ("2026 Dr. Ralph Hicken Invitational" + spaces)
 *   - cols 48-92  → venue       ("Etobicoke Olympium Pool" + spaces)
 *   - cols 93-100 → start date  ("04302026" = MMDDYYYY = 2026-04-30)
 *   - cols 101-108 → end date   ("05032026" = MMDDYYYY = 2026-05-03)
 *   - cols 109-116 → age-up date ("04302026")
 *   - cols 129-130 → checksum   ("47")
 *
 * B1 does NOT carry course directly; the format notes say course-of-meet
 * should be derived from any E1.course (col 51). For v1, the parser
 * hardcodes 'LCM' (the value present in this fixture's E1 course flag).
 */
const FIXTURE_B1_BODY =
  '2026 Dr. Ralph Hicken Invitational           Etobicoke Olympium Pool                      043020260503202604302026   0        47';

describe('parseMeet (B1)', () => {
  it('extracts meet metadata from the MSSAC fixture B1 line', () => {
    const result = parseMeet(FIXTURE_B1_BODY);
    expect(result.name).toBe('2026 Dr. Ralph Hicken Invitational');
    // 04/30/2026, interpreted as UTC midnight.
    expect(result.startDate.toISOString()).toBe('2026-04-30T00:00:00.000Z');
    // 05/03/2026, interpreted as UTC midnight.
    expect(result.endDate.toISOString()).toBe('2026-05-03T00:00:00.000Z');
    // Hardcoded 'LCM' for this fixture (see parseMeet JSDoc).
    expect(result.course).toBe('LCM');
  });

  it('matches /Hicken/i in the meet name', () => {
    const result = parseMeet(FIXTURE_B1_BODY);
    expect(result.name).toMatch(/Hicken/i);
  });

  it('trims trailing whitespace from name', () => {
    const result = parseMeet(FIXTURE_B1_BODY);
    expect(result.name).not.toMatch(/\s+$/);
  });

  it('multi-day meet: end date is strictly after start date', () => {
    // The MSSAC fixture is a multi-day meet (Apr 30 – May 3, 2026).
    const result = parseMeet(FIXTURE_B1_BODY);
    expect(result.endDate.getTime()).toBeGreaterThan(result.startDate.getTime());
  });

  it('parses a synthetic single-day meet (start === end)', () => {
    // Synthetic body: same shape as fixture, but start and end dates both 05012026.
    const body =
      'One-Day Sprint Meet                          Some Pool                                    050120260501202605012026   0        00';
    const result = parseMeet(body);
    expect(result.startDate.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(result.endDate.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(result.startDate.getTime()).toBe(result.endDate.getTime());
  });
});
