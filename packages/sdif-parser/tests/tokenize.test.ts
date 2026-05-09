import { describe, it, expect } from 'vitest';
import { tokenize } from '../src/tokenize.js';

describe('tokenize', () => {
  it('splits each line into code + body', () => {
    const input = ['A102MM   Hy-Tek MM 8.0', 'B102Dr Ralph Hicken Inv'].join('\n');
    expect(tokenize(input)).toEqual([
      { code: 'A1', body: '02MM   Hy-Tek MM 8.0', lineNumber: 1 },
      { code: 'B1', body: '02Dr Ralph Hicken Inv', lineNumber: 2 },
    ]);
  });

  it('ignores blank lines', () => {
    expect(tokenize('\n\nA102x\n\n')).toEqual([{ code: 'A1', body: '02x', lineNumber: 3 }]);
  });

  it('preserves trailing whitespace inside body (column-significant)', () => {
    expect(tokenize('D1FOO BAR    ')[0].body).toBe('FOO BAR    ');
  });
});
