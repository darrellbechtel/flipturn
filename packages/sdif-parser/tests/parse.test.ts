/**
 * Integration test for the top-level `parse()` assembler against the full
 * MSSAC Hicken 2026 fixture.
 *
 * Counts are pinned to Task 1's record-code survey of the fixture, confirmed
 * during this task's first green run:
 *
 *   - 10  C1 records   → 10  parsed teams
 *   - 748 D1 records   → 748 parsed athletes
 *   - 5646 E1 records  → 5646 parsed swims (every E1 has a paired E2)
 *   - 53  E2 col-13=Q  → 53  swims with status = 'DQ'
 *
 * If a future fixture change shifts these numbers, update the assertions and
 * re-confirm against `docs/sdif-format-notes.md`.
 */

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import AdmZip from 'adm-zip';
import { parse } from '../src/parse.js';

describe('parse (full MSSAC fixture)', () => {
  const zipPath = resolve(__dirname, '__fixtures__/mssac-hicken-2026.zip');
  const zip = new AdmZip(zipPath);
  const hy3 = zip
    .getEntries()
    .find((e) => e.entryName.toLowerCase().endsWith('.hy3'))!
    .getData()
    .toString('utf8');
  const result = parse(hy3);

  it('identifies the meet', () => {
    expect(result.meet.name).toMatch(/Hicken/i);
    expect(result.meet.startDate.toISOString().slice(0, 10)).toBe('2026-04-30');
  });

  it('parses exactly 10 teams', () => {
    expect(result.teams.length).toBe(10);
  });

  it('parses exactly 748 athletes', () => {
    expect(result.athletes.length).toBe(748);
  });

  it('parses exactly 5646 swims', () => {
    expect(result.swims.length).toBe(5646);
  });

  it('includes the host club MSSAC', () => {
    expect(result.teams.some((t) => /MSSAC|Mississauga/i.test(t.name))).toBe(true);
  });

  it('contains exactly 53 DQ swims', () => {
    expect(result.swims.filter((s) => s.status === 'DQ').length).toBe(53);
  });

  it('attaches athleteRef to every swim', () => {
    expect(result.swims.every((s) => s.athleteRef.lastName.length > 0)).toBe(true);
  });
});
