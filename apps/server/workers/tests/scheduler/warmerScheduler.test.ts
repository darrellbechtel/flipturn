import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import type { PrismaClient } from '@flipturn/db';
import {
  planDailyWarm,
  BETA_PRIORITY_CLUBS,
} from '../../src/scheduler/warmerScheduler';
import { CRAWL_TZ, isInActiveWindow } from '../../src/scheduler/window';

// Same seeded LCG used by window.test.ts
const seededRng = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
};

/**
 * Build a prisma mock whose `club.findFirst` returns rows from `byName` keyed
 * by the case-insensitive `where.name.contains` argument the caller passes.
 * Anything not in `byName` → null (no Club row matches that input).
 */
function buildPrisma(byName: Record<string, { lastCrawledAt: Date | null }> = {}) {
  // Normalize lookup keys to lowercase for case-insensitive contains semantics.
  const normalized: Record<string, { lastCrawledAt: Date | null }> = {};
  for (const k of Object.keys(byName)) {
    const v = byName[k];
    if (v) normalized[k.toLowerCase()] = v;
  }

  const prisma = {
    club: {
      findFirst: vi.fn(async (args: { where: { name: { contains: string; mode?: string } } }) => {
        const needle = args.where.name.contains.toLowerCase();
        return normalized[needle] ?? null;
      }),
    },
  } as unknown as PrismaClient;

  return prisma;
}

describe('planDailyWarm', () => {
  it('returns null when called after the active window has closed', async () => {
    const prisma = buildPrisma();
    const today = DateTime.fromISO('2026-05-12T23:00', { zone: CRAWL_TZ });
    const result = await planDailyWarm({
      prisma,
      today,
      rng: seededRng(1),
    });
    expect(result).toBeNull();
  });

  it('picks NULL-lastCrawledAt clubs first when multiple match', async () => {
    // 'Club Warriors' has a real lastCrawledAt; 'Region of Waterloo Swim Club' is NULL.
    // The NULL one should win.
    const prisma = buildPrisma({
      'Club Warriors': { lastCrawledAt: new Date('2026-05-01T18:00:00Z') },
      'Region of Waterloo Swim Club': { lastCrawledAt: null },
      'Guelph Gryphon': { lastCrawledAt: new Date('2026-05-02T18:00:00Z') },
    });
    const today = DateTime.fromISO('2026-05-12T15:00', { zone: CRAWL_TZ });
    const result = await planDailyWarm({
      prisma,
      today,
      rng: seededRng(1),
      list: ['Club Warriors', 'Region of Waterloo Swim Club', 'Guelph Gryphon'],
    });
    expect(result).not.toBeNull();
    expect(result!.clubName).toBe('Region of Waterloo Swim Club');
  });

  it('falls back to oldest lastCrawledAt when no clubs are NULL', async () => {
    const prisma = buildPrisma({
      'Club Warriors': { lastCrawledAt: new Date('2026-05-05T18:00:00Z') },
      'Region of Waterloo Swim Club': { lastCrawledAt: new Date('2026-05-01T18:00:00Z') }, // oldest
      'Guelph Gryphon': { lastCrawledAt: new Date('2026-05-03T18:00:00Z') },
    });
    const today = DateTime.fromISO('2026-05-12T15:00', { zone: CRAWL_TZ });
    const result = await planDailyWarm({
      prisma,
      today,
      rng: seededRng(2),
      list: ['Club Warriors', 'Region of Waterloo Swim Club', 'Guelph Gryphon'],
    });
    expect(result).not.toBeNull();
    expect(result!.clubName).toBe('Region of Waterloo Swim Club');
  });

  it('returned fireAt lands inside the active window', async () => {
    const prisma = buildPrisma();
    const today = DateTime.fromISO('2026-05-12T15:00', { zone: CRAWL_TZ });

    // Try several seeds to make sure the property holds across the rng range.
    for (const seed of [1, 7, 42, 99, 1234]) {
      const result = await planDailyWarm({
        prisma,
        today,
        rng: seededRng(seed),
        list: ['Club Warriors'],
      });
      expect(result).not.toBeNull();
      expect(isInActiveWindow(result!.fireAt)).toBe(true);
    }
  });

  it('exports BETA_PRIORITY_CLUBS containing the expected entries', () => {
    expect(BETA_PRIORITY_CLUBS).toContain('Club Warriors');
    expect(BETA_PRIORITY_CLUBS).toContain('Region of Waterloo Swim Club');
    expect(BETA_PRIORITY_CLUBS).toContain('Guelph Gryphon');
    expect(BETA_PRIORITY_CLUBS).toContain('Windsor Aquatic Club');
  });
});
