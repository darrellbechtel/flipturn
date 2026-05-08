import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import {
  isInActiveWindow,
  sampleFireTimeForDate,
  sampleInterRequestDelayMs,
  sampleReadPauseMs,
  pickWeekdayForWeek,
  CRAWL_TZ,
} from '../../src/scheduler/window';

const seededRng = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
};

describe('isInActiveWindow', () => {
  it('accepts 19:30 ET', () => {
    const t = DateTime.fromISO('2026-05-12T19:30', { zone: CRAWL_TZ });
    expect(isInActiveWindow(t)).toBe(true);
  });
  it('rejects 03:00 ET', () => {
    const t = DateTime.fromISO('2026-05-12T03:00', { zone: CRAWL_TZ });
    expect(isInActiveWindow(t)).toBe(false);
  });
  it('rejects 23:00 ET (after window)', () => {
    const t = DateTime.fromISO('2026-05-12T23:00', { zone: CRAWL_TZ });
    expect(isInActiveWindow(t)).toBe(false);
  });
});

describe('sampleFireTimeForDate', () => {
  it('1000 samples all land inside the 16:00–22:30 ET window', () => {
    const rng = seededRng(42);
    const date = DateTime.fromISO('2026-05-12', { zone: CRAWL_TZ });
    for (let i = 0; i < 1000; i++) {
      const t = sampleFireTimeForDate(date, rng);
      expect(isInActiveWindow(t)).toBe(true);
    }
  });
  it('triangular distribution: most samples near 19:30', () => {
    const rng = seededRng(7);
    const date = DateTime.fromISO('2026-05-12', { zone: CRAWL_TZ });
    let near = 0;
    for (let i = 0; i < 1000; i++) {
      const t = sampleFireTimeForDate(date, rng);
      const minutesFromPeak = Math.abs(t.hour * 60 + t.minute - (19 * 60 + 30));
      if (minutesFromPeak < 90) near++;
    }
    expect(near).toBeGreaterThan(400); // > 40% within 90 min of peak
  });
});

describe('sampleInterRequestDelayMs', () => {
  it('returns values in [1500, 4000]', () => {
    const rng = seededRng(1);
    for (let i = 0; i < 1000; i++) {
      const d = sampleInterRequestDelayMs(rng);
      expect(d).toBeGreaterThanOrEqual(1500);
      expect(d).toBeLessThanOrEqual(4000);
    }
  });
  it('mean is between 2.5s and 3.0s', () => {
    const rng = seededRng(2);
    let sum = 0;
    const n = 5000;
    for (let i = 0; i < n; i++) sum += sampleInterRequestDelayMs(rng);
    const mean = sum / n;
    expect(mean).toBeGreaterThan(2500);
    expect(mean).toBeLessThan(3000);
  });
});

describe('sampleReadPauseMs', () => {
  it('returns 0 about 80% of the time', () => {
    const rng = seededRng(3);
    let zero = 0;
    const n = 5000;
    for (let i = 0; i < n; i++) if (sampleReadPauseMs(rng) === 0) zero++;
    expect(zero / n).toBeGreaterThan(0.75);
    expect(zero / n).toBeLessThan(0.85);
  });
  it('non-zero values are in [1, 800]', () => {
    const rng = seededRng(4);
    for (let i = 0; i < 5000; i++) {
      const v = sampleReadPauseMs(rng);
      if (v > 0) {
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(800);
      }
    }
  });
});

describe('pickWeekdayForWeek', () => {
  it('always returns Mon–Fri (1..5 in ISO weekday)', () => {
    const rng = seededRng(5);
    const weekStart = DateTime.fromISO('2026-05-11', { zone: CRAWL_TZ }); // Mon
    for (let i = 0; i < 100; i++) {
      const d = pickWeekdayForWeek(weekStart, rng);
      expect(d.weekday).toBeGreaterThanOrEqual(1);
      expect(d.weekday).toBeLessThanOrEqual(5);
    }
  });
});
