import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestApp, type TestApp } from './helpers/testApp.js';
import { makeUser, makeSession, makeAthleteForUser } from './helpers/factories.js';

let h: TestApp;
let bearer: string;
let userId: string;

describe('athletes routes', () => {
  beforeAll(async () => {
    h = await createTestApp();
  });
  afterAll(async () => {
    await h.teardown();
  });
  beforeEach(async () => {
    await h.prisma.userAthlete.deleteMany();
    await h.prisma.session.deleteMany();
    await h.prisma.athlete.deleteMany();
    await h.prisma.user.deleteMany();
    h.enqueued.length = 0;
    const user = await makeUser(h.prisma, 'p@example.com');
    userId = user.id;
    const { token } = await makeSession(h.prisma, user.id);
    bearer = `Bearer ${token}`;
  });

  describe('POST /v1/athletes/onboard', () => {
    it('creates a new athlete + UserAthlete + enqueues a scrape', async () => {
      const res = await h.app.request('/v1/athletes/onboard', {
        method: 'POST',
        headers: { authorization: bearer, 'content-type': 'application/json' },
        body: JSON.stringify({ sncId: '4030816' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { athlete: { id: string; sncId: string } };
      expect(body.athlete.sncId).toBe('4030816');

      const athlete = await h.prisma.athlete.findUnique({ where: { sncId: '4030816' } });
      expect(athlete).not.toBeNull();
      const link = await h.prisma.userAthlete.findUnique({
        where: { userId_athleteId: { userId, athleteId: athlete!.id } },
      });
      expect(link?.relationship).toBe('PARENT');

      expect(h.enqueued).toHaveLength(1);
      expect(h.enqueued[0]?.sncId).toBe('4030816');
    });

    it('reuses an existing athlete; only the UserAthlete is created', async () => {
      const existing = await h.prisma.athlete.create({
        data: { sncId: '9999', primaryName: 'Existing' },
      });
      const res = await h.app.request('/v1/athletes/onboard', {
        method: 'POST',
        headers: { authorization: bearer, 'content-type': 'application/json' },
        body: JSON.stringify({ sncId: '9999', relationship: 'GUARDIAN' }),
      });
      expect(res.status).toBe(200);
      const all = await h.prisma.athlete.findMany();
      expect(all).toHaveLength(1);
      expect(all[0]?.id).toBe(existing.id);
      const link = await h.prisma.userAthlete.findUnique({
        where: { userId_athleteId: { userId, athleteId: existing.id } },
      });
      expect(link?.relationship).toBe('GUARDIAN');
    });

    it('is idempotent: re-onboarding the same SNC ID returns the same athlete and does not duplicate the UserAthlete', async () => {
      const first = await h.app.request('/v1/athletes/onboard', {
        method: 'POST',
        headers: { authorization: bearer, 'content-type': 'application/json' },
        body: JSON.stringify({ sncId: '1234' }),
      });
      const second = await h.app.request('/v1/athletes/onboard', {
        method: 'POST',
        headers: { authorization: bearer, 'content-type': 'application/json' },
        body: JSON.stringify({ sncId: '1234' }),
      });
      const a = (await first.json()) as { athlete: { id: string } };
      const b = (await second.json()) as { athlete: { id: string } };
      expect(a.athlete.id).toBe(b.athlete.id);
      const links = await h.prisma.userAthlete.findMany({ where: { userId } });
      expect(links).toHaveLength(1);
    });

    it('rejects unauthenticated requests', async () => {
      const res = await h.app.request('/v1/athletes/onboard', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sncId: '4030816' }),
      });
      expect(res.status).toBe(401);
    });

    it('rejects empty sncId', async () => {
      const res = await h.app.request('/v1/athletes/onboard', {
        method: 'POST',
        headers: { authorization: bearer, 'content-type': 'application/json' },
        body: JSON.stringify({ sncId: '' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /v1/athletes', () => {
    it("returns the user's athletes", async () => {
      await makeAthleteForUser(h.prisma, userId, 'A1', 'Alice');
      await makeAthleteForUser(h.prisma, userId, 'A2', 'Bob');
      const res = await h.app.request('/v1/athletes', {
        headers: { authorization: bearer },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { athletes: Array<{ sncId: string }> };
      const sncIds = body.athletes.map((a) => a.sncId).sort();
      expect(sncIds).toEqual(['A1', 'A2']);
    });
  });

  describe('DELETE /v1/user-athletes/:id', () => {
    it('unlinks an athlete (does not delete the athlete row itself)', async () => {
      const athlete = await makeAthleteForUser(h.prisma, userId, 'D1', 'ToUnlink');
      const res = await h.app.request(`/v1/user-athletes/${athlete.id}`, {
        method: 'DELETE',
        headers: { authorization: bearer },
      });
      expect(res.status).toBe(204);
      const link = await h.prisma.userAthlete.findUnique({
        where: { userId_athleteId: { userId, athleteId: athlete.id } },
      });
      expect(link).toBeNull();
      const stillThere = await h.prisma.athlete.findUnique({ where: { id: athlete.id } });
      expect(stillThere).not.toBeNull();
    });

    it('returns 404 if the user is not linked to that athlete', async () => {
      const res = await h.app.request('/v1/user-athletes/no-such-id', {
        method: 'DELETE',
        headers: { authorization: bearer },
      });
      expect(res.status).toBe(404);
    });
  });
});
