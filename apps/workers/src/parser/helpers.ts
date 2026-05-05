import { createHash } from 'node:crypto';
import type { Gender } from '@flipturn/shared';

const SPLASH_RANGE_RE =
  /^(?<startDay>\d{1,2})-\s*-\s*(?<endDay>\d{1,2})-(?<month>\d{1,2})-(?<year>\d{4})$/;
const SPLASH_SINGLE_RE = /^(?<day>\d{1,2})-(?<month>\d{1,2})-(?<year>\d{4})$/;

export interface DateRange {
  readonly startDate: Date;
  readonly endDate: Date;
}

/**
 * Parse SPLASH Meet Manager 11's date range format. Examples:
 *   "9- - 11-4-2026"  → 2026-04-09 to 2026-04-11
 *   "15-3-2025"       → 2025-03-15 (single day)
 */
export function parseSplashDateRange(input: string): DateRange {
  const trimmed = input.trim();
  const range = SPLASH_RANGE_RE.exec(trimmed);
  if (range?.groups) {
    const startDay = Number.parseInt(range.groups.startDay!, 10);
    const endDay = Number.parseInt(range.groups.endDay!, 10);
    const month = Number.parseInt(range.groups.month!, 10);
    const year = Number.parseInt(range.groups.year!, 10);
    if (!isValidYmd(year, month, startDay) || !isValidYmd(year, month, endDay)) {
      throw new Error(`parseSplashDateRange: invalid date in ${JSON.stringify(input)}`);
    }
    return {
      startDate: new Date(Date.UTC(year, month - 1, startDay)),
      endDate: new Date(Date.UTC(year, month - 1, endDay)),
    };
  }
  const single = SPLASH_SINGLE_RE.exec(trimmed);
  if (single?.groups) {
    const day = Number.parseInt(single.groups.day!, 10);
    const month = Number.parseInt(single.groups.month!, 10);
    const year = Number.parseInt(single.groups.year!, 10);
    if (!isValidYmd(year, month, day)) {
      throw new Error(`parseSplashDateRange: invalid date in ${JSON.stringify(input)}`);
    }
    const d = new Date(Date.UTC(year, month - 1, day));
    return { startDate: d, endDate: d };
  }
  throw new Error(`parseSplashDateRange: unrecognized format: ${JSON.stringify(input)}`);
}

function isValidYmd(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

const FEMALE_PATTERNS = [/\bgirls?\b/i, /\bwomen?\b/i, /\bfemale\b/i];
const MALE_PATTERNS = [/\bboys?\b/i, /\bmen\b/i, /\bmale\b/i];

export function deriveGenderFromEventHeader(header: string): Gender | null {
  if (!header) return null;
  const matchesAny = (patterns: RegExp[]) => patterns.some((p) => p.test(header));
  if (matchesAny(FEMALE_PATTERNS)) return 'F';
  if (matchesAny(MALE_PATTERNS)) return 'M';
  return null;
}

export interface MeetIdSeed {
  readonly meetName: string;
  readonly startDate: Date;
}

/**
 * Build a stable synthesized meetExternalId for swims whose source row
 * doesn't include a real SNC meet ID. The hash is deterministic across
 * scrapes of the same meet — same name + same start date → same id.
 */
export function hashMeetExternalId(seed: MeetIdSeed): string {
  const dayStr = seed.startDate.toISOString().slice(0, 10);
  const input = `${seed.meetName.trim().toLowerCase()}|${dayStr}`;
  const hash = createHash('sha256').update(input).digest('hex').slice(0, 12);
  return `synth-${hash}`;
}
