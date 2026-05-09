import { describe, it, expect } from 'vitest';
import { parseHeader } from '../../src/records/header.js';

/**
 * The A1 body below is the exact body from the MSSAC 2026 Dr. Ralph Hicken
 * Invitational fixture (`tests/__fixtures__/mssac-hicken-2026.zip`), i.e., the
 * first line of the .hy3 with its leading "A1" record code stripped.
 *
 * Full A1 line (130 chars):
 *   A107Results From MM to TM    Hy-Tek, Ltd    MM5 7.0Gb     05032026  8:28 PMEtobicoke Swim Club                                  05
 *
 * Per docs/sdif-format-notes.md A1 section:
 *   - cols 30-44 → vendor      ("Hy-Tek, Ltd    ")
 *   - cols 45-58 → version     ("MM5 7.0Gb     ")
 *   - cols 59-66 → date        ("05032026" = MMDDYYYY = 2026-05-03)
 *   - cols 67-75 → time        ("  8:28 PM")
 */
const FIXTURE_A1_BODY =
  '07Results From MM to TM    Hy-Tek, Ltd    MM5 7.0Gb     05032026  8:28 PMEtobicoke Swim Club                                  05';

describe('parseHeader (A1)', () => {
  it('extracts file generation metadata from the MSSAC fixture A1 line', () => {
    const result = parseHeader(FIXTURE_A1_BODY);
    expect(result.generator).toBe('Hy-Tek, Ltd');
    expect(result.generatorVersion).toBe('MM5 7.0Gb');
    // 05/03/2026 8:28 PM, interpreted as UTC (no timezone in .hy3).
    expect(result.generatedAt.toISOString()).toBe('2026-05-03T20:28:00.000Z');
  });

  it('trims trailing whitespace from string fields', () => {
    const result = parseHeader(FIXTURE_A1_BODY);
    expect(result.generator).not.toMatch(/\s+$/);
    expect(result.generatorVersion).not.toMatch(/\s+$/);
  });

  it('parses 12:00 AM as midnight (00:00)', () => {
    // Synthetic A1 body: same shape as fixture, but date+time tweaked to 12:00 AM.
    // cols 59-66 = "01152026" (MMDDYYYY = 2026-01-15)
    // cols 67-75 = " 12:00 AM"
    const body =
      '07Results From MM to TM    Hy-Tek, Ltd    MM5 7.0Gb     01152026 12:00 AMEtobicoke Swim Club                                  00';
    const result = parseHeader(body);
    expect(result.generatedAt.toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });

  it('parses 12:34 PM as noon-hour (12:34)', () => {
    // 12 PM should remain hour 12, not roll to 0.
    const body =
      '07Results From MM to TM    Hy-Tek, Ltd    MM5 7.0Gb     01152026 12:34 PMEtobicoke Swim Club                                  00';
    const result = parseHeader(body);
    expect(result.generatedAt.toISOString()).toBe('2026-01-15T12:34:00.000Z');
  });
});
