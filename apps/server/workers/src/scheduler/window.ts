import type { DateTime } from 'luxon';

export const CRAWL_TZ = 'America/Toronto';
export const WINDOW_START_HOUR = 16;          // 16:00 ET inclusive
export const WINDOW_END_HOUR = 22;            // 22:30 ET exclusive (end + 30 min)
export const WINDOW_END_MIN = 30;
export const PEAK_HOUR = 19;
export const PEAK_MIN = 30;

export type Rng = () => number;
const defaultRng: Rng = Math.random;

export function isInActiveWindow(t: DateTime): boolean {
  const local = t.setZone(CRAWL_TZ);
  const minutes = local.hour * 60 + local.minute;
  const start = WINDOW_START_HOUR * 60;
  const end = WINDOW_END_HOUR * 60 + WINDOW_END_MIN;
  return minutes >= start && minutes < end;
}

// Triangular distribution peaked at PEAK_HOUR:PEAK_MIN.
export function sampleFireTimeForDate(date: DateTime, rng: Rng = defaultRng): DateTime {
  const local = date.setZone(CRAWL_TZ).startOf('day');
  const startMin = WINDOW_START_HOUR * 60;
  const endMin = WINDOW_END_HOUR * 60 + WINDOW_END_MIN;
  const peakMin = PEAK_HOUR * 60 + PEAK_MIN;
  // Triangular: U = rng(); split point = (peak-start)/(end-start)
  const u = rng();
  const c = (peakMin - startMin) / (endMin - startMin);
  let m: number;
  if (u < c) {
    m = startMin + Math.sqrt(u * (endMin - startMin) * (peakMin - startMin));
  } else {
    m = endMin - Math.sqrt((1 - u) * (endMin - startMin) * (endMin - peakMin));
  }
  const minutes = Math.floor(m);
  return local.plus({ minutes });
}

export function sampleInterRequestDelayMs(rng: Rng = defaultRng): number {
  return 1500 + Math.floor(rng() * (4000 - 1500 + 1));
}

export function sampleReadPauseMs(rng: Rng = defaultRng): number {
  if (rng() < 0.2) return 1 + Math.floor(rng() * 800);
  return 0;
}

// 2026 Canadian statutory holidays (federal/Ontario subset; sufficient for v1).
const STAT_HOLIDAYS_2026 = new Set([
  '2026-01-01', '2026-02-16', '2026-04-03', '2026-05-18', '2026-07-01',
  '2026-08-03', '2026-09-07', '2026-10-12', '2026-12-25', '2026-12-28',
]);

export function pickWeekdayForWeek(mondayInWeek: DateTime, rng: Rng = defaultRng): DateTime {
  const candidates: DateTime[] = [];
  for (let i = 0; i < 5; i++) {
    const d = mondayInWeek.plus({ days: i }).startOf('day');
    if (!STAT_HOLIDAYS_2026.has(d.toISODate() ?? '')) candidates.push(d);
  }
  if (candidates.length === 0) return mondayInWeek; // degenerate; caller can skip
  const idx = Math.floor(rng() * candidates.length);
  return candidates[idx] ?? mondayInWeek;
}
