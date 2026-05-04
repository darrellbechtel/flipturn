import { describe, it, expect } from 'vitest';
import { formatSwimTime, parseSwimTime } from '../src/time.js';

describe('formatSwimTime', () => {
  it('formats sub-minute times as SS.cc', () => {
    expect(formatSwimTime(0)).toBe('0.00');
    expect(formatSwimTime(1)).toBe('0.01');
    expect(formatSwimTime(99)).toBe('0.99');
    expect(formatSwimTime(100)).toBe('1.00');
    expect(formatSwimTime(5732)).toBe('57.32');
    expect(formatSwimTime(5999)).toBe('59.99');
  });

  it('formats minute+ times as M:SS.cc', () => {
    expect(formatSwimTime(6000)).toBe('1:00.00');
    expect(formatSwimTime(6245)).toBe('1:02.45');
    expect(formatSwimTime(13287)).toBe('2:12.87');
    expect(formatSwimTime(35999)).toBe('5:59.99');
  });

  it('formats 10-minute+ times as MM:SS.cc', () => {
    expect(formatSwimTime(60000)).toBe('10:00.00');
    expect(formatSwimTime(92307)).toBe('15:23.07');
  });

  it('formats hour+ times as H:MM:SS.cc', () => {
    // edge case for ultra-marathon swims; included for completeness
    expect(formatSwimTime(360000)).toBe('1:00:00.00');
    expect(formatSwimTime(367512)).toBe('1:01:15.12');
  });

  it('throws on negative input', () => {
    expect(() => formatSwimTime(-1)).toThrow();
  });

  it('throws on non-integer input', () => {
    expect(() => formatSwimTime(57.32)).toThrow();
  });
});

describe('parseSwimTime', () => {
  it('parses sub-minute display strings', () => {
    expect(parseSwimTime('0.00')).toBe(0);
    expect(parseSwimTime('0.99')).toBe(99);
    expect(parseSwimTime('57.32')).toBe(5732);
    expect(parseSwimTime('59.99')).toBe(5999);
  });

  it('parses minute+ strings', () => {
    expect(parseSwimTime('1:00.00')).toBe(6000);
    expect(parseSwimTime('1:02.45')).toBe(6245);
    expect(parseSwimTime('15:23.07')).toBe(92307);
  });

  it('parses hour+ strings', () => {
    expect(parseSwimTime('1:00:00.00')).toBe(360000);
    expect(parseSwimTime('1:01:15.12')).toBe(367512);
  });

  it('round-trips with formatSwimTime', () => {
    for (const cs of [0, 1, 99, 5732, 6000, 13287, 92307, 367512]) {
      expect(parseSwimTime(formatSwimTime(cs))).toBe(cs);
    }
  });

  it('throws on malformed input', () => {
    expect(() => parseSwimTime('')).toThrow();
    expect(() => parseSwimTime('abc')).toThrow();
    expect(() => parseSwimTime('57.3')).toThrow(); // missing trailing digit
    expect(() => parseSwimTime('1.02.45')).toThrow();
  });
});
