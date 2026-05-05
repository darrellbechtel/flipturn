import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseMeetIndex } from '../src/parser/meetPage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '..', 'fixtures', 'snc-meet-sample.html');
const EXPECTED = join(__dirname, '..', 'fixtures', 'snc-meet-sample.expected.json');

describe('parseMeetIndex', () => {
  let html: string;
  let expected: {
    meet: Record<string, unknown>;
    events: Array<Record<string, unknown>>;
  };

  beforeAll(async () => {
    html = await readFile(FIXTURE, 'utf8');
    expected = JSON.parse(await readFile(EXPECTED, 'utf8'));
  });

  it('extracts meet header', () => {
    const snap = parseMeetIndex(html, { externalId: String(expected.meet.externalId) });
    expect(snap.externalId).toBe(String(expected.meet.externalId));
    expect(snap.name).toBe(expected.meet.name);
    expect(snap.course).toBe(expected.meet.course);
    expect(snap.dataSource).toBe('results.swimming.ca');
  });

  it('parses the SPLASH date range', () => {
    const snap = parseMeetIndex(html, { externalId: String(expected.meet.externalId) });
    expect(snap.startDate.toISOString().slice(0, 10)).toBe(
      String(expected.meet.startDate).slice(0, 10),
    );
    expect(snap.endDate.toISOString().slice(0, 10)).toBe(
      String(expected.meet.endDate).slice(0, 10),
    );
  });

  it('extracts events that match the golden expected output', () => {
    const snap = parseMeetIndex(html, { externalId: String(expected.meet.externalId) });
    expect(snap.events.length).toBeGreaterThanOrEqual(expected.events.length);
    for (const exp of expected.events) {
      const found = snap.events.find(
        (e) => e.distanceM === exp.distanceM && e.stroke === exp.stroke && e.gender === exp.gender,
      );
      expect(found, `missing event ${JSON.stringify(exp)}`).toBeDefined();
    }
  });

  it('throws on inputs that are clearly not a meet page', () => {
    expect(() => parseMeetIndex('<html>oops</html>', { externalId: 'X' })).toThrow();
    expect(() => parseMeetIndex('', { externalId: 'X' })).toThrow();
  });
});
