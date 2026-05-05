import type { PrismaClient } from '@flipturn/db';
import { getLogger } from './logger.js';

/**
 * Recompute every PersonalBest row for the given athlete.
 *
 * For each distinct eventKey the athlete has at least one OFFICIAL swim in,
 * find the fastest swim and upsert the corresponding PersonalBest row. PBs
 * for eventKeys with no remaining OFFICIAL swims are deleted (e.g. when a
 * swim was reclassified as DQ).
 */
export async function recomputePersonalBests(
  prisma: PrismaClient,
  athleteId: string,
): Promise<{ created: number; deleted: number }> {
  const log = getLogger();

  return prisma.$transaction(async (tx) => {
    // Find the fastest OFFICIAL swim per eventKey for this athlete.
    const swims = await tx.swim.findMany({
      where: { athleteId, status: 'OFFICIAL', isCurrent: true },
      orderBy: [{ eventKey: 'asc' }, { timeCentiseconds: 'asc' }],
    });

    interface BestSwim {
      id: string;
      timeCentiseconds: number;
      swamAt: Date;
    }
    const fastestByEventKey = new Map<string, BestSwim>();
    for (const swim of swims) {
      if (!fastestByEventKey.has(swim.eventKey)) {
        fastestByEventKey.set(swim.eventKey, {
          id: swim.id,
          timeCentiseconds: swim.timeCentiseconds,
          swamAt: swim.scrapedAt, // best-effort proxy; refined below via meet startDate
        });
      }
    }

    // Look up each best swim's meet startDate to use as achievedAt.
    const swimIds = [...fastestByEventKey.values()].map((s) => s.id);
    const swimDetails = await tx.swim.findMany({
      where: { id: { in: swimIds } },
      include: { meet: { select: { startDate: true } } },
    });
    const swamAtById = new Map<string, Date>(
      swimDetails.map((s) => [s.id, s.meet.startDate] as const),
    );

    // Read existing PBs once so we can avoid no-op writes (which would still
    // bump `@updatedAt` and break idempotence).
    const existingPbs = await tx.personalBest.findMany({ where: { athleteId } });
    const existingByEventKey = new Map(existingPbs.map((pb) => [pb.eventKey, pb]));

    let created = 0;
    for (const [eventKey, best] of fastestByEventKey.entries()) {
      const achievedAt = swamAtById.get(best.id) ?? best.swamAt;
      const existing = existingByEventKey.get(eventKey);
      if (
        existing &&
        existing.swimId === best.id &&
        existing.timeCentiseconds === best.timeCentiseconds &&
        existing.achievedAt.getTime() === achievedAt.getTime()
      ) {
        continue; // already up to date — skip to keep updatedAt stable
      }
      await tx.personalBest.upsert({
        where: { athleteId_eventKey: { athleteId, eventKey } },
        update: {
          swimId: best.id,
          timeCentiseconds: best.timeCentiseconds,
          achievedAt,
        },
        create: {
          athleteId,
          eventKey,
          swimId: best.id,
          timeCentiseconds: best.timeCentiseconds,
          achievedAt,
        },
      });
      created++;
    }

    // Delete PBs whose eventKey no longer has any OFFICIAL swim
    const orphan = await tx.personalBest.deleteMany({
      where: {
        athleteId,
        eventKey: { notIn: [...fastestByEventKey.keys()] },
      },
    });

    log.info(
      { athleteId, upsertCount: created, deletedCount: orphan.count },
      'PB recompute complete',
    );

    return { created, deleted: orphan.count };
  });
}
