import { describe, it, expect } from 'vitest';
import {
  parseSplashDateRange,
  deriveGenderFromEventHeader,
  hashMeetExternalId,
} from '../src/parser/helpers.js';

describe('parseSplashDateRange', () => {
  it('parses the canonical SPLASH range format', () => {
    expect(parseSplashDateRange('9- - 11-4-2026')).toEqual({
      startDate: new Date(Date.UTC(2026, 3, 9)),
      endDate: new Date(Date.UTC(2026, 3, 11)),
    });
  });

  it('parses single-day events', () => {
    expect(parseSplashDateRange('15-3-2025')).toEqual({
      startDate: new Date(Date.UTC(2025, 2, 15)),
      endDate: new Date(Date.UTC(2025, 2, 15)),
    });
  });

  it('parses ranges with two-digit months', () => {
    expect(parseSplashDateRange('1- - 3-12-2024')).toEqual({
      startDate: new Date(Date.UTC(2024, 11, 1)),
      endDate: new Date(Date.UTC(2024, 11, 3)),
    });
  });

  it('throws on unrecognized formats', () => {
    expect(() => parseSplashDateRange('')).toThrow();
    expect(() => parseSplashDateRange('April 9 2026')).toThrow();
    expect(() => parseSplashDateRange('9-13-2026')).toThrow(); // invalid month
    expect(() => parseSplashDateRange('32-4-2026')).toThrow(); // invalid day
  });
});

describe('deriveGenderFromEventHeader', () => {
  it('returns F for Girls/Women/Female', () => {
    expect(deriveGenderFromEventHeader('Girls 100 Freestyle')).toBe('F');
    expect(deriveGenderFromEventHeader('Women 200 IM')).toBe('F');
    expect(deriveGenderFromEventHeader('Female 50 Free')).toBe('F');
  });

  it('returns M for Boys/Men/Male', () => {
    expect(deriveGenderFromEventHeader('Boys 100 Backstroke')).toBe('M');
    expect(deriveGenderFromEventHeader('Men 1500 Free')).toBe('M');
    expect(deriveGenderFromEventHeader('Male 50 Fly')).toBe('M');
  });

  it('returns null when not present', () => {
    expect(deriveGenderFromEventHeader('Mixed 4x100 Free Relay')).toBeNull();
    expect(deriveGenderFromEventHeader('Open 100 IM')).toBeNull();
    expect(deriveGenderFromEventHeader('')).toBeNull();
  });

  it('matches case-insensitively', () => {
    expect(deriveGenderFromEventHeader('GIRLS 100 FREESTYLE')).toBe('F');
    expect(deriveGenderFromEventHeader('boys 100')).toBe('M');
  });
});

describe('hashMeetExternalId', () => {
  it('produces a stable, prefixed hash', () => {
    const a = hashMeetExternalId({
      meetName: 'Some Spring Open',
      startDate: new Date('2026-04-01'),
    });
    const b = hashMeetExternalId({
      meetName: 'Some Spring Open',
      startDate: new Date('2026-04-01'),
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^synth-[a-f0-9]{12}$/);
  });

  it('produces different hashes for different meet names', () => {
    const a = hashMeetExternalId({
      meetName: 'A Meet',
      startDate: new Date('2026-04-01'),
    });
    const b = hashMeetExternalId({
      meetName: 'B Meet',
      startDate: new Date('2026-04-01'),
    });
    expect(a).not.toBe(b);
  });

  it('produces the SAME hash for the same meet name across different dates', () => {
    const a = hashMeetExternalId({
      meetName: 'A Meet',
      startDate: new Date('2026-04-01'),
    });
    const c = hashMeetExternalId({
      meetName: 'A Meet',
      startDate: new Date('2026-04-02'),
    });
    // The date is intentionally NOT part of the hash, so multi-day meets
    // without SNC links don't fragment into multiple Meet rows.
    expect(a).toBe(c);
  });
});
