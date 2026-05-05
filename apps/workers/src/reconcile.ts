import type { PrismaClient } from '@flipturn/db';
import { buildEventKey } from '@flipturn/shared';
import type { AthleteSnapshot } from './parser/types.js';
import { getLogger } from './logger.js';

export async function reconcile(
  prisma: PrismaClient,
  snapshot: AthleteSnapshot,
): Promise<{ athleteId: string; swimsTouched: number }> {
  const log = getLogger();

  return prisma.$transaction(async (tx) => {
    const athlete = await tx.athlete.upsert({
      where: { sncId: snapshot.sncId },
      update: {
        primaryName: snapshot.primaryName,
        gender: snapshot.gender ?? null,
        homeClub: snapshot.homeClub ?? null,
        lastScrapedAt: new Date(),
      },
      create: {
        sncId: snapshot.sncId,
        primaryName: snapshot.primaryName,
        gender: snapshot.gender ?? null,
        homeClub: snapshot.homeClub ?? null,
        lastScrapedAt: new Date(),
      },
    });

    let swimsTouched = 0;

    for (const record of snapshot.swims) {
      const meet = await tx.meet.upsert({
        where: { externalId: record.meetExternalId },
        update: {
          name: record.meetName,
          startDate: record.meetStartDate,
          endDate: record.meetEndDate,
          course: record.course,
        },
        create: {
          externalId: record.meetExternalId,
          name: record.meetName,
          course: record.course,
          startDate: record.meetStartDate,
          endDate: record.meetEndDate,
        },
      });

      // NOTE: Prisma's compound-unique input rejects `null` for nullable fields
      // even though the underlying SQL unique index permits it. We therefore
      // use findFirst + create instead of upsert here so the reconciler also
      // handles events with no ageBand correctly.
      const existingEvent = await tx.event.findFirst({
        where: {
          meetId: meet.id,
          distanceM: record.distanceM,
          stroke: record.stroke,
          gender: record.gender,
          ageBand: record.ageBand ?? null,
          round: record.round,
        },
      });
      const event =
        existingEvent ??
        (await tx.event.create({
          data: {
            meetId: meet.id,
            distanceM: record.distanceM,
            stroke: record.stroke,
            gender: record.gender,
            ageBand: record.ageBand ?? null,
            round: record.round,
          },
        }));

      const eventKey = buildEventKey({
        distanceM: record.distanceM,
        stroke: record.stroke,
        course: record.course,
      });

      await tx.swim.upsert({
        where: {
          athleteId_meetId_eventId: {
            athleteId: athlete.id,
            meetId: meet.id,
            eventId: event.id,
          },
        },
        update: {
          timeCentiseconds: record.timeCentiseconds,
          splits: [...record.splits],
          place: record.place ?? null,
          status: record.status,
          eventKey,
          scrapedAt: new Date(),
        },
        create: {
          athleteId: athlete.id,
          meetId: meet.id,
          eventId: event.id,
          timeCentiseconds: record.timeCentiseconds,
          splits: [...record.splits],
          place: record.place ?? null,
          status: record.status,
          eventKey,
          dataSource: snapshot.dataSource,
        },
      });

      swimsTouched++;
    }

    log.info({ athleteId: athlete.id, sncId: snapshot.sncId, swimsTouched }, 'reconcile complete');

    return { athleteId: athlete.id, swimsTouched };
  });
}
