import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parseClubDirectory } from '../../src/parser/clubDirectory.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, '__fixtures__/club-directory.html');
const html = readFileSync(fixturePath, 'utf8');

// The live "Find a Club" directory (https://findaclub.swimming.ca/) is a SPA
// shell. The actual club list is loaded via a JSONP call to
// https://www.swimming.ca/club-list.php?preview=true&callback=load_clubs which
// returns ~400 clubs as a JSON array of {name, address, website, phone, lat,
// lng, ...}. There is no SNC club code (e.g. "ON-CW") in this feed and
// roughly 10% of rows have no address (so no postal code). The parser must
// therefore (a) pull the JSON out of the JSONP wrapper, (b) derive a province
// from the Canadian postal code in the address when present, and (c)
// synthesise a stable ID from the club name. These tests exercise that
// behaviour against the captured fixture.
describe('parseClubDirectory', () => {
  it('returns at least 400 clubs from the JSONP feed', () => {
    const clubs = parseClubDirectory(html);
    expect(clubs.length).toBeGreaterThan(400);
  });

  it('every club has a non-empty id and name; ids are slug-safe', () => {
    const clubs = parseClubDirectory(html);
    for (const c of clubs) {
      expect(c.id.length).toBeGreaterThan(0);
      expect(c.id).toMatch(/^[A-Z0-9-]+$/);
      expect(c.name.length).toBeGreaterThan(0);
    }
  });

  it('synthesised ids are unique across the directory', () => {
    const clubs = parseClubDirectory(html);
    const ids = new Set(clubs.map((c) => c.id));
    expect(ids.size).toBe(clubs.length);
  });

  it('most clubs have a 2-letter province derived from a postal code', () => {
    const clubs = parseClubDirectory(html);
    const withProvince = clubs.filter((c) => c.province !== undefined);
    // The fixture has ~22 clubs with no address at all, so ~93% should
    // resolve a province. Require at least 80% to leave room for upstream
    // data churn.
    expect(withProvince.length / clubs.length).toBeGreaterThan(0.8);
    for (const c of withProvince) {
      expect(c.province).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('finds at least one well-known Ontario club with province=ON', () => {
    const clubs = parseClubDirectory(html);
    // "Etobicoke Swim Club" is a long-running Ontario club whose address in
    // the live feed includes an "M..." postal code (Toronto/GTA → ON). If
    // that ever changes we can swap this for another reliable ON name.
    const known = clubs.find((c) => c.name.toLowerCase() === 'etobicoke swim club');
    expect(known, 'expected Etobicoke Swim Club in directory').toBeDefined();
    expect(known?.province).toBe('ON');
  });

  it('extracts website as rosterUrl when the JSONP entry has one', () => {
    const clubs = parseClubDirectory(html);
    const withRoster = clubs.filter((c) => c.rosterUrl !== undefined);
    expect(withRoster.length).toBeGreaterThan(0);
    for (const c of withRoster) {
      expect(c.rosterUrl).toMatch(/^https?:\/\//);
    }
  });
});
