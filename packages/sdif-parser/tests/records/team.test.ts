import { describe, it, expect } from 'vitest';
import { parseTeam } from '../../src/records/team.js';

/**
 * The C1 bodies below are the exact bodies from the MSSAC 2026 Dr. Ralph
 * Hicken Invitational fixture (`tests/__fixtures__/mssac-hicken-2026.zip`),
 * i.e., real C1 lines of the .hy3 with the leading "C1" record code stripped
 * (and the trailing CRLF removed).
 *
 * Per docs/sdif-format-notes.md C1 section:
 *   - cols 3-7    → team code  (5 chars, padded right with spaces)
 *   - cols 8-37   → team name  (30 chars, padded right with spaces)
 *   - cols 38-118 → misc / blank (not parsed)
 *   - cols 119-122 → athlete counts (not parsed)
 *   - cols 129-130 → checksum (not validated)
 *
 * The fixture's C1s in order of appearance:
 *   1. BAD   → Burlington Aquatic Devilrays
 *   2. CW    → Club Warriors Swimming
 *   3. ESWIM → Etobicoke Swim Club
 *   4. FINS  → Halton Hills Blue Fins
 *   5. MST   → Mallards Swim Team
 *   6. MSSAC → Mississauga Aquatic Club  (canonical fixture host)
 *   7. RAMAC → RAMAC Aquatic Club
 *   8. NL    → Team NL
 *   9. TORCH → TORCH Swimming
 *   10. YORK → York Swim Club
 *
 * BAD ("BAD  ") and CW ("CW   ") are deliberately included to exercise
 * trailing-space trimming on the team code field; MSSAC fills the full
 * 5-char code slot exactly. The ESWIM body has a particularly tight layout
 * (no spaces between code and name).
 */

// Body for the first C1 in the fixture: Burlington Aquatic Devilrays.
// Full line:
//   C1BAD  Burlington Aquatic Devilrays                                                                                   0  0      04
const FIXTURE_C1_BAD =
  'BAD  Burlington Aquatic Devilrays                                                                                   0  0      04';

// Body for the second C1 in the fixture: Club Warriors Swimming.
// Full line:
//   C1CW   Club Warriors Swimming                                                                                         0  0      21
const FIXTURE_C1_CW =
  'CW   Club Warriors Swimming                                                                                         0  0      21';

// Body for the canonical MSSAC C1 in the fixture.
// Full line:
//   C1MSSACMississauga Aquatic Club                                                                                       0  0      03
const FIXTURE_C1_MSSAC =
  'MSSACMississauga Aquatic Club                                                                                       0  0      03';

describe('parseTeam (C1)', () => {
  it('parses the canonical MSSAC team from the fixture', () => {
    const result = parseTeam(FIXTURE_C1_MSSAC);
    expect(result.code).toBe('MSSAC');
    expect(result.name).toMatch(/Mississauga/i);
    expect(result.name).toBe('Mississauga Aquatic Club');
  });

  it('trims trailing whitespace from code and name', () => {
    // BAD's code slot is "BAD  " (3 chars + 2 padding); name is followed by
    // many spaces. Both must come back trimmed.
    const result = parseTeam(FIXTURE_C1_BAD);
    expect(result.code).toBe('BAD');
    expect(result.code).not.toMatch(/\s+$/);
    expect(result.name).toBe('Burlington Aquatic Devilrays');
    expect(result.name).not.toMatch(/\s+$/);
  });

  it('parses a second fixture team correctly (Club Warriors)', () => {
    // The second C1 in fixture order; proves the parser works for >1 club,
    // not just MSSAC.
    const result = parseTeam(FIXTURE_C1_CW);
    expect(result.code).toBe('CW');
    expect(result.name).toBe('Club Warriors Swimming');
  });
});
