import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FetchFn } from '@flipturn/workers/jobs/priorityWarmer';
import { createTestApp, type TestApp } from '../helpers/testApp.js';
import { makeUser, makeSession } from '../helpers/factories.js';

let h: TestApp;
let bearer: string;
let userId: string;

describe('GET /v1/athletes/search', () => {
  beforeAll(async () => {
    h = await createTestApp();
  });
  afterAll(async () => {
    await h.teardown();
  });
  beforeEach(async () => {
    await h.prisma.userAthlete.deleteMany();
    await h.prisma.athlete.deleteMany();
    await h.prisma.club.deleteMany();
    await h.prisma.session.deleteMany();
    await h.prisma.user.deleteMany();
    const user = await makeUser(h.prisma, 'searcher@example.com');
    userId = user.id;
    const { token } = await makeSession(h.prisma, user.id);
    bearer = `Bearer ${token}`;
  });

  it('returns 401 without a session', async () => {
    const res = await h.app.request('/v1/athletes/search?q=Felix');
    expect(res.status).toBe(401);
  });

  it('returns 400 if q is too short', async () => {
    const res = await h.app.request('/v1/athletes/search?q=F', {
      headers: { authorization: bearer },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_query');
  });

  it('returns matching athletes for a valid session', async () => {
    await h.prisma.club.create({
      data: { id: 'ON-CW', name: 'Club Warriors', province: 'ON' },
    });
    await h.prisma.athlete.create({
      data: {
        sncId: '5567334',
        primaryName: 'Felix Bechtel',
        clubId: 'ON-CW',
        source: 'CRAWLED',
      },
    });

    const res = await h.app.request('/v1/athletes/search?q=Felix+Bechtel', {
      headers: { authorization: bearer },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{ sncId: string; displayName: string }>;
      total: number;
    };
    expect(body.results.length).toBeGreaterThanOrEqual(1);
    const sncIds = body.results.map((r) => r.sncId);
    expect(sncIds).toContain('5567334');
    const felix = body.results.find((r) => r.sncId === '5567334');
    expect(felix?.displayName).toBe('Felix Bechtel');
  });

  it('honours clubId and province filters', async () => {
    await h.prisma.club.create({
      data: { id: 'ON-CW', name: 'Club Warriors', province: 'ON' },
    });
    await h.prisma.club.create({
      data: { id: 'BC-PSC', name: 'Pacific Swim Club', province: 'BC' },
    });
    await h.prisma.athlete.create({
      data: { sncId: 'A1', primaryName: 'Felix Bechtel', clubId: 'ON-CW', source: 'CRAWLED' },
    });
    await h.prisma.athlete.create({
      data: { sncId: 'A2', primaryName: 'Felix Bechtel', clubId: 'BC-PSC', source: 'CRAWLED' },
    });
    await h.prisma.athlete.create({
      data: { sncId: 'A3', primaryName: 'Felix Beckham', clubId: 'ON-CW', source: 'CRAWLED' },
    });

    const res = await h.app.request('/v1/athletes/search?q=Felix+Bechtel&province=BC', {
      headers: { authorization: bearer },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Array<{ sncId: string }> };
    expect(body.results).toHaveLength(1);
    expect(body.results[0]?.sncId).toBe('A2');
  });

  it('passes the searchFetch dep through to the service for remote fallback', async () => {
    // Local has zero hits, so the remote fallback should fire — provided we
    // wired a fetch into AppDeps.
    const fakeHtml = `
      <html><body>
        <article>
          <h2><a href="/swimmer/8888888/">Felix RemoteStub</a></h2>
        </article>
      </body></html>
    `;
    const fetchSpy: FetchFn = vi.fn(async () => ({ status: 200, body: fakeHtml }));

    const teardownDefault = h.teardown;
    await teardownDefault();
    h = await createTestApp({ searchFetch: fetchSpy });
    const user = await makeUser(h.prisma, 'searcher2@example.com');
    const { token } = await makeSession(h.prisma, user.id);
    const localBearer = `Bearer ${token}`;

    const res = await h.app.request('/v1/athletes/search?q=Felix+RemoteStub', {
      headers: { authorization: localBearer },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{ sncId: string }>;
      usedRemoteFallback: boolean;
      stubsCreated: number;
    };
    expect(fetchSpy).toHaveBeenCalledWith({
      url: 'https://www.swimming.ca/?s=Felix%20RemoteStub',
    });
    expect(body.usedRemoteFallback).toBe(true);
    expect(body.stubsCreated).toBe(1);
    expect(body.results.map((r) => r.sncId)).toContain('8888888');
  });
});
