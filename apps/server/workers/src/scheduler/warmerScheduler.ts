import { DateTime } from 'luxon';
import type { PrismaClient } from '@flipturn/db';
import {
  CRAWL_TZ,
  WINDOW_END_HOUR,
  WINDOW_END_MIN,
  isInActiveWindow,
  sampleFireTimeForDate,
  type Rng,
} from './window';

/**
 * Hardcoded priority list for the v1 beta. When PSO crawlers (Swim Ontario, etc.)
 * come back, this moves to a config/db row.
 *
 * v1 strategy: pick exactly ONE club per active day. Swimming Canada rate-limits
 * aggressively, so we deliberately do not fan out 13 club searches in one window.
 * The picker prefers clubs whose `Club.lastCrawledAt` is NULL (never warmed),
 * then falls back to the oldest `lastCrawledAt`. That way, every club in the
 * list rotates through over a ~2-week cycle.
 */
export const BETA_PRIORITY_CLUBS: readonly string[] = [
  // P1 — flagship beta cohort
  'Club Warriors',
  'Region of Waterloo Swim Club',
  'Guelph Gryphon',
  // P2 — WOSA-region (Windsor Regionals trial cohort)
  'Windsor Aquatic Club',
  'Sarnia Rapids',
  'London Aquatic Club',
  'Cambridge Aquatic Jets',
  'Brantford Aquatic Club',
  'Burlington Aquatic Devilrays',
  'Oakville Aquatic Club',
  'Etobicoke Pepsi Swimming',
  'Mississauga Aquatic Club',
  'North York Aquatic Club',
];

export type PlannedWarm = { clubName: string; fireAt: DateTime };

/**
 * Plans today's single priority-warmer run.
 *
 * - Returns `null` if today's active window has already closed.
 * - Picks the club whose matching `Club` row has the oldest `lastCrawledAt`
 *   (NULL ranks oldest, so unwarmed clubs and clubs with no DB match win first
 *   and aren't starved).
 * - Samples a fire time inside the active window via `sampleFireTimeForDate`.
 *   Clamps to `today + 1min` if the sample lands in the past; if even that
 *   isn't in the active window, returns `null`.
 *
 * Pure async — no Redis, no BullMQ. Caller (worker.ts) is responsible for
 * enqueueing the actual job at `fireAt` with `clubName`.
 */
export async function planDailyWarm(deps: {
  prisma: PrismaClient;
  today: DateTime;
  rng?: Rng;
  list?: readonly string[];
}): Promise<PlannedWarm | null> {
  const today = deps.today.setZone(CRAWL_TZ);
  const windowEnd = today
    .startOf('day')
    .plus({ hours: WINDOW_END_HOUR, minutes: WINDOW_END_MIN });
  if (today > windowEnd) return null;

  const list = deps.list ?? BETA_PRIORITY_CLUBS;
  if (list.length === 0) return null;

  // Look up each list entry's matching Club row (case-insensitive `contains`).
  // No match → treat as NULL lastCrawledAt so brand-new clubs aren't starved.
  const ages: { clubName: string; lastCrawledAt: Date | null }[] = await Promise.all(
    list.map(async (n) => {
      const c = await deps.prisma.club.findFirst({
        where: { name: { contains: n, mode: 'insensitive' } },
        select: { lastCrawledAt: true },
      });
      return { clubName: n, lastCrawledAt: c?.lastCrawledAt ?? null };
    }),
  );

  // Sort: NULL first, then oldest-first by Date.
  ages.sort((a, b) => {
    if (a.lastCrawledAt === null && b.lastCrawledAt === null) return 0;
    if (a.lastCrawledAt === null) return -1;
    if (b.lastCrawledAt === null) return 1;
    return a.lastCrawledAt.getTime() - b.lastCrawledAt.getTime();
  });

  const pick = ages[0];
  if (!pick) return null;

  let fireAt = sampleFireTimeForDate(today, deps.rng);
  if (fireAt < today) fireAt = today.plus({ minutes: 1 });
  if (!isInActiveWindow(fireAt)) return null;

  return { clubName: pick.clubName, fireAt };
}
