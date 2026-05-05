import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, type TestApp } from './helpers/testApp.js';
import { makeUser, makeSession } from './helpers/factories.js';

let h: TestApp;

describe('GET /v1/health', () => {
  beforeAll(async () => {
    h = await createTestApp();
  });
  afterAll(async () => {
    await h.teardown();
  });

  it('reports db ok and redis ok', async () => {
    const res = await h.app.request('/v1/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { db: 'ok' | 'fail'; redis: 'ok' | 'fail' };
    expect(body.db).toBe('ok');
    expect(body.redis).toBe('ok');
  });
});

describe('DELETE /v1/me', () => {
  beforeAll(async () => {
    h = await createTestApp();
  });
  afterAll(async () => {
    await h.teardown();
  });

  it('cascades user → sessions/userAthletes; leaves Athlete rows alone', async () => {
    const u = await makeUser(h.prisma, 'd@example.com');
    const { token } = await makeSession(h.prisma, u.id);
    const athlete = await h.prisma.athlete.create({
      data: { sncId: 'KEEP', primaryName: 'Keep me' },
    });
    await h.prisma.userAthlete.create({
      data: { userId: u.id, athleteId: athlete.id, relationship: 'PARENT' },
    });

    const res = await h.app.request('/v1/me', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(204);

    expect(await h.prisma.user.findUnique({ where: { id: u.id } })).toBeNull();
    expect(await h.prisma.session.findMany({ where: { userId: u.id } })).toHaveLength(0);
    expect(await h.prisma.userAthlete.findMany({ where: { userId: u.id } })).toHaveLength(0);
    expect(await h.prisma.athlete.findUnique({ where: { id: athlete.id } })).not.toBeNull();
  });

  it('rejects unauthenticated DELETE /v1/me', async () => {
    const res = await h.app.request('/v1/me', { method: 'DELETE' });
    expect(res.status).toBe(401);
  });
});
