import { describe, it, expect } from 'vitest';
import { buildAthleteUrl, buildMeetUrl, classifyUrl } from '../src/url.js';

describe('buildAthleteUrl', () => {
  it('builds the canonical athlete URL on www.swimming.ca', () => {
    expect(buildAthleteUrl('4030816')).toBe('https://www.swimming.ca/swimmer/4030816/');
  });

  it('URL-encodes IDs with unsafe characters', () => {
    expect(buildAthleteUrl('A B/C')).toBe('https://www.swimming.ca/swimmer/A%20B%2FC/');
  });

  it('rejects empty or whitespace-only IDs', () => {
    expect(() => buildAthleteUrl('')).toThrow();
    expect(() => buildAthleteUrl('   ')).toThrow();
  });
});

describe('buildMeetUrl', () => {
  it('builds the canonical meet URL on results.swimming.ca', () => {
    expect(buildMeetUrl('2026-speedo-canadian-swimming-open')).toBe(
      'https://results.swimming.ca/2026-speedo-canadian-swimming-open/',
    );
  });

  it('rejects empty slugs', () => {
    expect(() => buildMeetUrl('')).toThrow();
  });
});

describe('classifyUrl', () => {
  it('classifies www.swimming.ca/swimmer/* as athlete', () => {
    expect(classifyUrl('https://www.swimming.ca/swimmer/4030816/')).toBe('athlete');
  });

  it('classifies results.swimming.ca/* as meet', () => {
    expect(classifyUrl('https://results.swimming.ca/some-meet/')).toBe('meet');
  });

  it('returns unknown for other URLs', () => {
    expect(classifyUrl('https://example.com/swimmer/1')).toBe('unknown');
    expect(classifyUrl('https://www.swimming.ca/result/123/')).toBe('unknown');
  });
});
