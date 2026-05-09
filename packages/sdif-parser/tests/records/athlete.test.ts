import { describe, it, expect } from 'vitest';
import { parseAthlete } from '../../src/records/athlete.js';

/**
 * The D1 bodies below are the exact bodies from the MSSAC 2026 Dr. Ralph
 * Hicken Invitational fixture (`tests/__fixtures__/mssac-hicken-2026.zip`),
 * i.e., real D1 lines of the .hy3 with the leading "D1" record code stripped
 * (and the trailing CRLF removed).
 *
 * Per docs/sdif-format-notes.md D1 section:
 *   - col 3        → gender ("F" / "M")
 *   - cols 4-8     → internal athlete id (5 chars)
 *   - cols 9-28    → last name  (20 chars, padded right)
 *   - cols 29-48   → first name (20 chars, padded right)
 *   - cols 49-68   → middle name (20 chars; empty for most athletes)
 *   - col 69       → citizenship-status indicator (not parsed)
 *   - cols 70-78   → SNC registration id (9 digits)
 *   - cols 89-96   → DOB (MMDDYYYY)
 *
 * The 5 athletes below are deliberately diverse:
 *   - Bailey  → female, no middle name              (most common shape)
 *   - Belbin  → male,   no middle name
 *   - Davidov → female, populated middle name "Michal"
 *   - Williams-Browne → female, hyphenated last name
 *   - Van Mieghem → male, last name with embedded space
 *
 * teamCode is supplied as a SECOND argument (D1 records don't carry the team
 * code; the surrounding C1 scopes the athlete). For these unit tests we pass
 * "MSSAC" — every D1 in this fixture happens to come from MSSAC because that
 * is the host club's roster, but the parser does not depend on that.
 */

// D1F51553Bailey              Sophie                                   140224737      310509242015 10     0       CAN         N   21
const FIXTURE_D1_BAILEY =
  'F51553Bailey              Sophie                                   140224737      310509242015 10     0       CAN         N   21';

// D1M51516Belbin              Noah                                     129189639      306801302010 16     0       CAN         N   10
const FIXTURE_D1_BELBIN =
  'M51516Belbin              Noah                                     129189639      306801302010 16     0       CAN         N   10';

// D1F51551Davidov             Michal              Michal              N129220123      310309272010 15     0       CAN         N   64
const FIXTURE_D1_DAVIDOV =
  'F51551Davidov             Michal              Michal              N129220123      310309272010 15     0       CAN         N   64';

// D1F50963Williams-Browne     Maya                                     131018372      256004272014 12     0       CAN         N   24
const FIXTURE_D1_WILLIAMS_BROWNE =
  'F50963Williams-Browne     Maya                                     131018372      256004272014 12     0       CAN         N   24';

// D1M50959Van Mieghem         Arthur                                  B129234010      255610292009 16     0       CAN         N   23
const FIXTURE_D1_VAN_MIEGHEM =
  'M50959Van Mieghem         Arthur                                  B129234010      255610292009 16     0       CAN         N   23';

describe('parseAthlete (D1)', () => {
  it('parses Bailey (female, no middle name) from the fixture', () => {
    const result = parseAthlete(FIXTURE_D1_BAILEY, 'MSSAC');
    expect(result.teamCode).toBe('MSSAC');
    expect(result.lastName).toBe('Bailey');
    expect(result.firstName).toBe('Sophie');
    expect(result.gender).toBe('F');
    expect(result.middleInitial).toBeUndefined();
    expect(result.dob).toBeInstanceOf(Date);
    // 09/24/2015 at UTC midnight.
    expect(result.dob?.toISOString()).toBe('2015-09-24T00:00:00.000Z');
    expect(result.preferredId).toBe('140224737');
  });

  it('parses Belbin (male, no middle name)', () => {
    const result = parseAthlete(FIXTURE_D1_BELBIN, 'MSSAC');
    expect(result.lastName).toBe('Belbin');
    expect(result.firstName).toBe('Noah');
    expect(result.gender).toBe('M');
    expect(result.middleInitial).toBeUndefined();
    // 01/30/2010
    expect(result.dob?.toISOString()).toBe('2010-01-30T00:00:00.000Z');
    expect(result.preferredId).toBe('129189639');
  });

  it('parses Davidov with a populated middle name ("Michal")', () => {
    // Per format-notes, the .hy3 carries the FULL middle name (20 chars), not
    // an initial. The ParsedAthlete type field is nonetheless named
    // `middleInitial` for consistency with already-shipped types — the value
    // here is the full middle name string.
    const result = parseAthlete(FIXTURE_D1_DAVIDOV, 'MSSAC');
    expect(result.lastName).toBe('Davidov');
    expect(result.firstName).toBe('Michal');
    expect(result.gender).toBe('F');
    expect(result.middleInitial).toBe('Michal');
    // 09/27/2010
    expect(result.dob?.toISOString()).toBe('2010-09-27T00:00:00.000Z');
    expect(result.preferredId).toBe('129220123');
  });

  it('parses a hyphenated last name (Williams-Browne)', () => {
    const result = parseAthlete(FIXTURE_D1_WILLIAMS_BROWNE, 'MSSAC');
    expect(result.lastName).toBe('Williams-Browne');
    expect(result.firstName).toBe('Maya');
    expect(result.gender).toBe('F');
    expect(result.middleInitial).toBeUndefined();
    // 04/27/2014
    expect(result.dob?.toISOString()).toBe('2014-04-27T00:00:00.000Z');
  });

  it('parses a compound last name with an embedded space (Van Mieghem)', () => {
    // Verifies trailing-only trim: the internal space in "Van Mieghem" must
    // be preserved.
    const result = parseAthlete(FIXTURE_D1_VAN_MIEGHEM, 'MSSAC');
    expect(result.lastName).toBe('Van Mieghem');
    expect(result.firstName).toBe('Arthur');
    expect(result.gender).toBe('M');
    expect(result.middleInitial).toBeUndefined();
    // 10/29/2009
    expect(result.dob?.toISOString()).toBe('2009-10-29T00:00:00.000Z');
  });

  it('passes through the supplied teamCode', () => {
    // teamCode is parser input (from the surrounding C1), not extracted from
    // the D1 body. Different team codes should round-trip.
    const result = parseAthlete(FIXTURE_D1_BAILEY, 'ESWIM');
    expect(result.teamCode).toBe('ESWIM');
  });

  it('handles the all-zero DOB sentinel by returning undefined', () => {
    // Synthetic D1: same Bailey body, but DOB cols 89-96 swapped to "00000000"
    // (per format-notes edge-cases: zero-DOB means privacy-suppressed /
    // unknown). The parser MUST return dob=undefined, not Date(year=0).
    //
    // Original: ...      310509242015 10... (DOB at body cols 87..94)
    // Modified: ...      310500000000 10...
    const ORIGINAL = FIXTURE_D1_BAILEY;
    // Body slice for DOB: a=89, b=96 on the full line → body.slice(89-3, 96-2) = slice(86, 94).
    const dobStart = 86;
    const dobEnd = 94;
    const zeroDob =
      ORIGINAL.slice(0, dobStart) + '00000000' + ORIGINAL.slice(dobEnd);
    const result = parseAthlete(zeroDob, 'MSSAC');
    expect(result.dob).toBeUndefined();
    // Other fields should remain intact.
    expect(result.lastName).toBe('Bailey');
    expect(result.firstName).toBe('Sophie');
  });

  it('treats a blank middle-name slot as undefined (not empty string)', () => {
    // Bailey's middle-name field is already all-spaces in the fixture; the
    // assertion in the Bailey test above already checks toBeUndefined(). Here
    // we add an explicit cross-check that the field is NOT the empty string,
    // since an over-eager `trimEnd()` could leak `""`.
    const result = parseAthlete(FIXTURE_D1_BAILEY, 'MSSAC');
    expect(result.middleInitial).not.toBe('');
    expect(result.middleInitial).toBeUndefined();
  });
});
