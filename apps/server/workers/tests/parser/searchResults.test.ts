import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseSearchResults } from '../../src/parser/searchResults';

const html = readFileSync(join(__dirname, '__fixtures__/search-results.html'), 'utf8');

describe('parseSearchResults', () => {
  it('extracts numeric /swimmer/<id>/ results', () => {
    const rows = parseSearchResults(html);
    const numeric = rows.filter(r => /^\d+$/.test(r.sncId));
    expect(numeric.length).toBeGreaterThan(0);
    expect(numeric.some(r => r.sncId === '5567334')).toBe(true);
  });

  it('skips curated WP-CPT slug results (non-numeric sncId)', () => {
    const rows = parseSearchResults(html);
    expect(rows.every(r => /^\d+$/.test(r.sncId))).toBe(true);
  });

  it('returns a non-empty displayName for each result', () => {
    const rows = parseSearchResults(html);
    for (const r of rows) {
      expect(r.displayName.length).toBeGreaterThan(0);
    }
  });
});
