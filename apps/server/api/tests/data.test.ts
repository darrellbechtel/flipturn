import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestApp, type TestApp } from './helpers/testApp.js';
import { makeUser, makeSession, makeAthleteForUser } from './helpers/factories.js';

let h: TestApp;
let bearer: string;
let userId: string;
let athleteId: string;

async function seedSwims() {
  const meet = await h.prisma.meet.create({
    data: {
      externalId: 'TEST-MEET-1',
      name: 'Test Meet',
      course: 'LCM',
      startDate: new Date('2026-04-01'),
      endDate: new Date('2026-04-03'),
    },
  });
  const e100Free = await h.prisma.event.create({
    data: { meetId: meet.id, distanceM: 100, stroke: 'FR', gender: 'F', round: 'TIMED_FINAL' },
  });
  const e200Free = await h.prisma.event.create({
    data: { meetId: meet.id, distanceM: 200, stroke: 'FR', gender: 'F', round: 'TIMED_FINAL' },
  });
  const e100Back = await h.prisma.event.create({
    data: { meetId: meet.id, distanceM: 100, stroke: 'BK', gender: 'F', round: 'TIMED_FINAL' },
  });
  await h.prisma.swim.createMany({
    data: [
      {
        athleteId,
        meetId: meet.id,
        eventId: e100Free.id,
        eventKey: '100_FR_LCM',
        timeCentiseconds: 5732,
        splits: [],
        status: 'OFFICIAL',
        dataSource: 'www.swimming.ca',
      },
      {
        athleteId,
        meetId: meet.id,
        eventId: e200Free.id,
        eventKey: '200_FR_LCM',
        timeCentiseconds: 12500,
        splits: [],
        status: 'OFFICIAL',
        dataSource: 'www.swimming.ca',
      },
      {
        athleteId,
        meetId: meet.id,
        eventId: e100Back.id,
        eventKey: '100_BK_LCM',
        timeCentiseconds: 6900,
        splits: [],
        status: 'OFFICIAL',
        dataSource: 'www.swimming.ca',
      },
    ],
  });
}

describe('data routes', () => {
  beforeAll(async () => {
    h = await createTestApp();
  });
  afterAll(async () => {
    await h.teardown();
  });
  beforeEach(async () => {
    await h.prisma.personalBest.deleteMany();
    await h.prisma.swim.deleteMany();
    await h.prisma.event.deleteMany();
    await h.prisma.meet.deleteMany();
    await h.prisma.userAthlete.deleteMany();
    await h.prisma.session.deleteMany();
    await h.prisma.athlete.deleteMany();
    await h.prisma.user.deleteMany();

    const u = await makeUser(h.prisma, 'p@example.com');
    userId = u.id;
    const { token } = await makeSession(h.prisma, u.id);
    bearer = `Bearer ${token}`;
    const a = await makeAthleteForUser(h.prisma, userId, 'A1', 'Alice');
    athleteId = a.id;
    await seedSwims();
  });

  describe('GET /v1/athletes/:id/swims', () => {
    it('returns all swims by default', async () => {
      const res = await h.app.request(`/v1/athletes/${athleteId}/swims`, {
        headers: { authorization: bearer },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        swims: Array<{ eventKey: string }>;
        nextCursor: string | null;
      };
      expect(body.swims.length).toBe(3);
      expect(body.nextCursor).toBeNull();
    });

    it('filters by eventKey', async () => {
      const res = await h.app.request(`/v1/athletes/${athleteId}/swims?eventKey=100_FR_LCM`, {
        headers: { authorization: bearer },
      });
      const body = (await res.json()) as { swims: Array<{ eventKey: string }> };
      expect(body.swims).toHaveLength(1);
      expect(body.swims[0]?.eventKey).toBe('100_FR_LCM');
    });

    it('paginates with cursor', async () => {
      const first = await h.app.request(`/v1/athletes/${athleteId}/swims?limit=2`, {
        headers: { authorization: bearer },
      });
      const firstBody = (await first.json()) as { swims: unknown[]; nextCursor: string | null };
      expect(firstBody.swims).toHaveLength(2);
      expect(firstBody.nextCursor).not.toBeNull();

      const second = await h.app.request(
        `/v1/athletes/${athleteId}/swims?limit=2&cursor=${firstBody.nextCursor}`,
        { headers: { authorization: bearer } },
      );
      const secondBody = (await second.json()) as { swims: unknown[]; nextCursor: string | null };
      expect(secondBody.swims).toHaveLength(1);
      expect(secondBody.nextCursor).toBeNull();
    });

    it('returns 404 if the athlete is not linked to the user', async () => {
      const otherAthlete = await h.prisma.athlete.create({
        data: { sncId: 'OTHER', primaryName: 'Other' },
      });
      const res = await h.app.request(`/v1/athletes/${otherAthlete.id}/swims`, {
        headers: { authorization: bearer },
      });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /v1/athletes/:id/personal-bests', () => {
    it('returns one PB per eventKey', async () => {
      const swims = await h.prisma.swim.findMany({ where: { athleteId } });
      for (const swim of swims) {
        await h.prisma.personalBest.create({
          data: {
            athleteId,
            eventKey: swim.eventKey,
            swimId: swim.id,
            timeCentiseconds: swim.timeCentiseconds,
            achievedAt: new Date('2026-04-01'),
          },
        });
      }
      const res = await h.app.request(`/v1/athletes/${athleteId}/personal-bests`, {
        headers: { authorization: bearer },
      });
      const body = (await res.json()) as { personalBests: Array<{ eventKey: string }> };
      expect(body.personalBests).toHaveLength(3);
    });
  });

  describe('GET /v1/athletes/:id/progression', () => {
    it('returns progression points for one eventKey, sorted ascending by date', async () => {
      const meet = await h.prisma.meet.create({
        data: {
          externalId: 'OLD-MEET',
          name: 'Old Meet',
          course: 'LCM',
          startDate: new Date('2025-04-01'),
          endDate: new Date('2025-04-03'),
        },
      });
      const event = await h.prisma.event.create({
        data: { meetId: meet.id, distanceM: 100, stroke: 'FR', gender: 'F', round: 'TIMED_FINAL' },
      });
      await h.prisma.swim.create({
        data: {
          athleteId,
          meetId: meet.id,
          eventId: event.id,
          eventKey: '100_FR_LCM',
          timeCentiseconds: 5800,
          splits: [],
          status: 'OFFICIAL',
          dataSource: 'www.swimming.ca',
        },
      });
      const res = await h.app.request(`/v1/athletes/${athleteId}/progression?eventKey=100_FR_LCM`, {
        headers: { authorization: bearer },
      });
      const body = (await res.json()) as { points: Array<{ timeCentiseconds: number }> };
      expect(body.points).toHaveLength(2);
      expect(body.points[0]?.timeCentiseconds).toBe(5800);
      expect(body.points[1]?.timeCentiseconds).toBe(5732);
    });

    it('returns 400 without an eventKey', async () => {
      const res = await h.app.request(`/v1/athletes/${athleteId}/progression`, {
        headers: { authorization: bearer },
      });
      expect(res.status).toBe(400);
    });
  });
});
