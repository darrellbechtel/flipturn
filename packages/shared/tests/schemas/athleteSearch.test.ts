import { describe, it, expect } from 'vitest';
import {
  AthleteSearchQuerySchema,
  AthleteSearchResultSchema,
} from '../../src/schemas/athleteSearch.js';

describe('AthleteSearchQuerySchema', () => {
  it('accepts a minimal query and applies default limit=20', () => {
    expect(AthleteSearchQuerySchema.parse({ q: 'felix' })).toEqual({ q: 'felix', limit: 20 });
  });
  it('rejects q shorter than 2 chars', () => {
    expect(() => AthleteSearchQuerySchema.parse({ q: 'f' })).toThrow();
  });
  it('caps limit at 50', () => {
    expect(() => AthleteSearchQuerySchema.parse({ q: 'felix', limit: 100 })).toThrow();
  });
  it('uppercases province', () => {
    expect(AthleteSearchQuerySchema.parse({ q: 'felix', province: 'on' }).province).toBe('ON');
  });
  it('rejects province longer than 2 chars', () => {
    expect(() => AthleteSearchQuerySchema.parse({ q: 'felix', province: 'ONT' })).toThrow();
  });
});

describe('AthleteSearchResultSchema', () => {
  it('accepts a fully-populated result', () => {
    expect(() =>
      AthleteSearchResultSchema.parse({
        sncId: '5567334',
        displayName: 'Felix Bechtel',
        alternateNames: [],
        dobYear: 2015,
        gender: 'M',
        club: { id: 'CW', name: 'Club Warriors', province: 'ON' },
        hasFlipturnProfile: false,
        alreadyLinkedToMe: false,
      }),
    ).not.toThrow();
  });
  it('accepts a result with null club, dobYear, gender', () => {
    expect(() =>
      AthleteSearchResultSchema.parse({
        sncId: '5567334',
        displayName: 'Felix Bechtel',
        alternateNames: ['F. Bechtel'],
        dobYear: null,
        gender: null,
        club: null,
        hasFlipturnProfile: false,
        alreadyLinkedToMe: false,
      }),
    ).not.toThrow();
  });
});
