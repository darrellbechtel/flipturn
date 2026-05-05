import { describe, it, expect } from 'vitest';
import { formatSwimTime, parseEventKey } from '../../lib/format.js';

describe('format re-exports', () => {
  it('formatSwimTime works via the mobile re-export', () => {
    expect(formatSwimTime(5732)).toBe('57.32');
  });

  it('parseEventKey works via the mobile re-export', () => {
    expect(parseEventKey('100_FR_LCM')).toEqual({
      distanceM: 100,
      stroke: 'FR',
      course: 'LCM',
    });
  });
});
