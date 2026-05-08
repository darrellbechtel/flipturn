import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseSwimmerProfile } from '../../src/parser/swimmerPage';

const html = readFileSync(join(__dirname, '__fixtures__/swimmer-5567334.html'), 'utf8');

describe('parseSwimmerProfile', () => {
  it('extracts primaryName "Felix Bechtel"', () => {
    const r = parseSwimmerProfile(html);
    expect(r.primaryName).toBe('Felix Bechtel');
  });

  it('extracts club name matching "Club Warrior"', () => {
    const r = parseSwimmerProfile(html);
    expect(r.clubName).toMatch(/Club Warrior/i);
    // Felix's club has the literal "@UW" suffix in the rendered DOM.
    expect(r.clubName).toBe('Club Warrior Swimmers@UW');
  });

  it('extracts gender M from the embedded data dump', () => {
    const r = parseSwimmerProfile(html);
    expect(r.gender).toBe('M');
  });

  it('extracts dobYear 2015 from the embedded [birthdate] field', () => {
    const r = parseSwimmerProfile(html);
    expect(r.dobYear).toBe(2015);
  });

  it('returns the documented ParsedSwimmer shape (no extra keys)', () => {
    const r = parseSwimmerProfile(html);
    expect(Object.keys(r).sort()).toEqual(['clubName', 'dobYear', 'gender', 'primaryName']);
  });

  it('throws on inputs that are clearly not a swimmer page', () => {
    expect(() => parseSwimmerProfile('<html><body>Page not found</body></html>')).toThrow();
    expect(() => parseSwimmerProfile('')).toThrow();
  });

  it('returns null for fields that are absent (synthetic page with no club/birthdate/gender)', () => {
    // Build a minimally-shaped HTML page that mirrors the SNC swimmer template
    // but omits the print_r dump and the Club row. Padding pushes the body
    // past the 200-byte minimum size guard in the parser.
    const padding = '<p>'.padEnd(400, 'x') + '</p>';
    const synthetic = [
      '<html><body>',
      '<section class="section--swimmer-details">',
      '<h2>Jane Doe</h2>',
      '<ul class="details-list">',
      '<li><span class="details-label">Age</span><span class="details-value">12</span></li>',
      '</ul>',
      '</section>',
      padding,
      '</body></html>',
    ].join('');
    const r = parseSwimmerProfile(synthetic);
    expect(r.primaryName).toBe('Jane Doe');
    expect(r.clubName).toBeNull();
    expect(r.gender).toBeNull();
    expect(r.dobYear).toBeNull();
  });
});
