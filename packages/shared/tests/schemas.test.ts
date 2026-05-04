import { describe, it, expect } from 'vitest';
import {
  MagicLinkRequestSchema,
  MagicLinkConsumeSchema,
  OnboardAthleteSchema,
  AthleteDtoSchema,
  SwimDtoSchema,
  PersonalBestDtoSchema,
} from '../src/schemas.js';

describe('MagicLinkRequestSchema', () => {
  it('accepts a valid email', () => {
    expect(MagicLinkRequestSchema.parse({ email: 'darrell@example.com' })).toEqual({
      email: 'darrell@example.com',
    });
  });

  it('rejects non-email', () => {
    expect(() => MagicLinkRequestSchema.parse({ email: 'not-an-email' })).toThrow();
    expect(() => MagicLinkRequestSchema.parse({})).toThrow();
  });

  it('lowercases and trims emails', () => {
    expect(MagicLinkRequestSchema.parse({ email: '  Darrell@Example.COM  ' })).toEqual({
      email: 'darrell@example.com',
    });
  });
});

describe('MagicLinkConsumeSchema', () => {
  it('accepts a non-empty token', () => {
    expect(MagicLinkConsumeSchema.parse({ token: 'abc123' })).toEqual({ token: 'abc123' });
  });

  it('rejects empty token', () => {
    expect(() => MagicLinkConsumeSchema.parse({ token: '' })).toThrow();
  });
});

describe('OnboardAthleteSchema', () => {
  it('accepts SNC ID with default relationship', () => {
    expect(OnboardAthleteSchema.parse({ sncId: 'SNC-12345' })).toEqual({
      sncId: 'SNC-12345',
      relationship: 'PARENT',
    });
  });

  it('accepts explicit relationship', () => {
    expect(OnboardAthleteSchema.parse({ sncId: 'SNC-12345', relationship: 'GUARDIAN' })).toEqual({
      sncId: 'SNC-12345',
      relationship: 'GUARDIAN',
    });
  });

  it('rejects empty sncId', () => {
    expect(() => OnboardAthleteSchema.parse({ sncId: '' })).toThrow();
  });

  it('rejects unknown relationship', () => {
    expect(() =>
      OnboardAthleteSchema.parse({ sncId: 'SNC-12345', relationship: 'COACH' }),
    ).toThrow();
  });
});

describe('AthleteDtoSchema', () => {
  it('parses a full athlete payload', () => {
    const dto = AthleteDtoSchema.parse({
      id: 'cuid-1',
      sncId: 'SNC-12345',
      primaryName: 'Sarah Demo',
      gender: 'F',
      homeClub: 'WRA',
      lastScrapedAt: '2026-05-04T00:00:00.000Z',
    });
    expect(dto.primaryName).toBe('Sarah Demo');
    expect(dto.lastScrapedAt).toBeInstanceOf(Date);
  });

  it('accepts null/undefined optional fields', () => {
    const dto = AthleteDtoSchema.parse({
      id: 'cuid-2',
      sncId: 'SNC-67890',
      primaryName: 'Benji Demo',
    });
    expect(dto.gender).toBeUndefined();
  });
});

describe('SwimDtoSchema', () => {
  it('parses a swim payload', () => {
    const dto = SwimDtoSchema.parse({
      id: 'swim-1',
      eventKey: '100_FR_LCM',
      timeCentiseconds: 6512,
      splits: [3120, 3392],
      place: 1,
      status: 'OFFICIAL',
      meetName: 'Spring Open',
      swamAt: '2026-04-01T10:00:00.000Z',
    });
    expect(dto.timeCentiseconds).toBe(6512);
    expect(dto.splits).toEqual([3120, 3392]);
    expect(dto.swamAt).toBeInstanceOf(Date);
  });
});

describe('PersonalBestDtoSchema', () => {
  it('parses a PB payload', () => {
    const dto = PersonalBestDtoSchema.parse({
      eventKey: '100_FR_LCM',
      timeCentiseconds: 6512,
      achievedAt: '2026-04-01T10:00:00.000Z',
      swimId: 'swim-1',
    });
    expect(dto.achievedAt).toBeInstanceOf(Date);
  });
});
