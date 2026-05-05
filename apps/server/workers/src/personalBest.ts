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
    // Find the fastest OFFICIAL swim per eventKey for this athlete. Pull the
    // meet startDate alongside so we can populate PB.achievedAt without a
    // second findMany.
    const swims = await tx.swim.findMany({
      where: { athleteId, status: 'OFFICIAL', isCurrent: true },
      orderBy: [{ eventKey: 'asc' }, { timeCentiseconds: 'asc' }],
      include: { meet: { select: { startDate: true } } },
    });

    interface BestSwim {
      id: string;
      timeCentiseconds: number;
      achievedAt: Date;
    }
    const fastestByEventKey = new Map<string, BestSwim>();
    for (const swim of swims) {
      if (!fastestByEventKey.has(swim.eventKey)) {
        fastestByEventKey.set(swim.eventKey, {
          id: swim.id,
          timeCentiseconds: swim.timeCentiseconds,
          achievedAt: swim.meet.startDate,
        });
      }
    }

    // Read existing PBs once so we can avoid no-op writes (which would still
    // bump `@updatedAt` and break idempotence).
    const existingPbs = await tx.personalBest.findMany({ where: { athleteId } });
    const existingByEventKey = new Map(existingPbs.map((pb) => [pb.eventKey, pb]));

    let created = 0;
    for (const [eventKey, best] of fastestByEventKey.entries()) {
      const existing = existingByEventKey.get(eventKey);
      if (
        existing &&
        existing.swimId === best.id &&
        existing.timeCentiseconds === best.timeCentiseconds &&
        existing.achievedAt.getTime() === best.achievedAt.getTime()
      ) {
        continue; // already up to date — skip to keep updatedAt stable
      }
      await tx.personalBest.upsert({
        where: { athleteId_eventKey: { athleteId, eventKey } },
        update: {
          swimId: best.id,
          timeCentiseconds: best.timeCentiseconds,
          achievedAt: best.achievedAt,
        },
        create: {
          athleteId,
          eventKey,
          swimId: best.id,
          timeCentiseconds: best.timeCentiseconds,
          achievedAt: best.achievedAt,
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
