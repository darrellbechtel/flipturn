import { describe, it, expect } from 'vitest';
import { buildEventKey, parseEventKey } from '../src/eventKey.js';

describe('buildEventKey', () => {
  it('builds canonical event keys', () => {
    expect(buildEventKey({ distanceM: 50, stroke: 'FR', course: 'LCM' })).toBe('50_FR_LCM');
    expect(buildEventKey({ distanceM: 100, stroke: 'BK', course: 'SCM' })).toBe('100_BK_SCM');
    expect(buildEventKey({ distanceM: 400, stroke: 'IM', course: 'SCY' })).toBe('400_IM_SCY');
    expect(buildEventKey({ distanceM: 1500, stroke: 'FR', course: 'LCM' })).toBe('1500_FR_LCM');
  });

  it('throws on invalid distance', () => {
    // @ts-expect-error invalid input
    expect(() => buildEventKey({ distanceM: 0, stroke: 'FR', course: 'LCM' })).toThrow();
    // @ts-expect-error invalid input
    expect(() => buildEventKey({ distanceM: -100, stroke: 'FR', course: 'LCM' })).toThrow();
    // @ts-expect-error invalid input
    expect(() => buildEventKey({ distanceM: 50.5, stroke: 'FR', course: 'LCM' })).toThrow();
  });
});

describe('parseEventKey', () => {
  it('parses well-formed event keys', () => {
    expect(parseEventKey('50_FR_LCM')).toEqual({ distanceM: 50, stroke: 'FR', course: 'LCM' });
    expect(parseEventKey('1500_FR_LCM')).toEqual({
      distanceM: 1500,
      stroke: 'FR',
      course: 'LCM',
    });
  });

  it('round-trips with buildEventKey', () => {
    const inputs = [
      { distanceM: 50, stroke: 'FR', course: 'LCM' },
      { distanceM: 200, stroke: 'IM', course: 'SCY' },
      { distanceM: 800, stroke: 'FR', course: 'LCM' },
    ] as const;
    for (const i of inputs) {
      expect(parseEventKey(buildEventKey(i))).toEqual(i);
    }
  });

  it('throws on malformed input', () => {
    expect(() => parseEventKey('')).toThrow();
    expect(() => parseEventKey('100_FR')).toThrow();
    expect(() => parseEventKey('100_FR_LCM_extra')).toThrow();
    expect(() => parseEventKey('100_XX_LCM')).toThrow(); // unknown stroke
    expect(() => parseEventKey('100_FR_XXX')).toThrow(); // unknown course
    expect(() => parseEventKey('abc_FR_LCM')).toThrow();
  });
});
