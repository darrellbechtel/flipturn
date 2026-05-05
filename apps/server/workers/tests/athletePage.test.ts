import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseAthletePage } from '../src/parser/athletePage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '..', 'fixtures', 'snc-athlete-sample.html');
const EXPECTED = join(__dirname, '..', 'fixtures', 'snc-athlete-sample.expected.json');

describe('parseAthletePage', () => {
  let html: string;
  // The shape of the expected JSON depends on what the spike captured —
  // read the actual file and adapt the destructuring if needed.
  let expected: { athlete: Record<string, unknown>; swims: Array<Record<string, unknown>> };

  beforeAll(async () => {
    html = await readFile(FIXTURE, 'utf8');
    expected = JSON.parse(await readFile(EXPECTED, 'utf8'));
  });

  it('extracts athlete identity', () => {
    const snap = parseAthletePage(html, { sncId: '4030816' });
    // sncId is supplied by the caller, not parsed from the page.
    expect(snap.sncId).toBe('4030816');
    expect(snap.primaryName).toBe(expected.athlete.primaryName);
    expect(snap.dataSource).toBe('www.swimming.ca');
  });

  it('extracts swims that match the golden expected output', () => {
    const snap = parseAthletePage(html, { sncId: '4030816' });
    expect(snap.swims.length).toBeGreaterThanOrEqual(expected.swims.length);

    for (const exp of expected.swims) {
      const found = snap.swims.find(
        (s) =>
          s.distanceM === exp.distanceM &&
          s.stroke === exp.stroke &&
          s.course === exp.course &&
          s.timeCentiseconds === exp.timeCentiseconds,
      );
      expect(found, `missing swim ${JSON.stringify(exp)}`).toBeDefined();
    }
  });

  it('derives athlete gender from per-swim event headers when present', () => {
    const snap = parseAthletePage(html, { sncId: '4030816' });
    // Ryan Cochrane is male — if derivation works, snap.gender === 'M'.
    expect(snap.gender).toBe('M');
  });

  it('every swim has a non-empty meetExternalId (real or synthesized)', () => {
    const snap = parseAthletePage(html, { sncId: '4030816' });
    for (const s of snap.swims) {
      expect(s.meetExternalId).toBeTruthy();
    }
    // synthesized IDs are deterministic — re-parsing produces the same set.
    const snap2 = parseAthletePage(html, { sncId: '4030816' });
    expect(new Set(snap2.swims.map((s) => s.meetExternalId))).toEqual(
      new Set(snap.swims.map((s) => s.meetExternalId)),
    );
  });

  it('every swim has positive timeCentiseconds and valid enum values', () => {
    const snap = parseAthletePage(html, { sncId: '4030816' });
    for (const s of snap.swims) {
      expect(s.timeCentiseconds).toBeGreaterThan(0);
      expect(['SCM', 'LCM', 'SCY']).toContain(s.course);
      expect(['FR', 'BK', 'BR', 'FL', 'IM']).toContain(s.stroke);
      expect(s.distanceM).toBeGreaterThan(0);
    }
  });

  it('throws on inputs that are clearly not a swimmer page', () => {
    expect(() =>
      parseAthletePage('<html><body>Page not found</body></html>', { sncId: 'X' }),
    ).toThrow();
    expect(() => parseAthletePage('', { sncId: 'X' })).toThrow();
  });
});
