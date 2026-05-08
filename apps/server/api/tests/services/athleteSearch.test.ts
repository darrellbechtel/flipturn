import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FetchFn } from '@flipturn/workers/jobs/priorityWarmer';
import { searchAthletes } from '../../src/services/athleteSearch.js';
import { createTestApp, type TestApp } from '../helpers/testApp.js';
import { makeUser } from '../helpers/factories.js';

let h: TestApp;
let userId: string;
let otherUserId: string;

async function seedClub(id: string, name: string, province: string) {
  await h.prisma.club.create({ data: { id, name, province } });
}

async function seedAthlete(opts: {
  sncId: string;
  primaryName: string;
  alternateNames?: string[];
  dobYear?: number | null;
  gender?: 'M' | 'F' | 'X' | null;
  clubId?: string | null;
}) {
  return h.prisma.athlete.create({
    data: {
      sncId: opts.sncId,
      primaryName: opts.primaryName,
      alternateNames: opts.alternateNames ?? [],
      dobYear: opts.dobYear ?? null,
      gender: opts.gender ?? null,
      clubId: opts.clubId ?? null,
      source: 'CRAWLED',
    },
  });
}

describe('searchAthletes', () => {
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

    const u = await makeUser(h.prisma, 'me@example.com');
    userId = u.id;
    const o = await makeUser(h.prisma, 'other@example.com');
    otherUserId = o.id;
  });

  it('returns Felix Bechtel at the top of results for an exact name search', async () => {
    await seedClub('ON-CW', 'Cobra Swim Club', 'ON');
    await seedAthlete({ sncId: '5567334', primaryName: 'Felix Bechtel', clubId: 'ON-CW' });
    await seedAthlete({ sncId: '1000001', primaryName: 'Felicity Bramble' });
    await seedAthlete({ sncId: '1000002', primaryName: 'Bobby Tables' });

    const result = await searchAthletes({
      prisma: h.prisma,
      args: { q: 'Felix Bechtel', limit: 20, userId },
    });

    expect(result.results.length).toBeGreaterThanOrEqual(1);
    expect(result.results[0]?.sncId).toBe('5567334');
    expect(result.results[0]?.displayName).toBe('Felix Bechtel');
    expect(result.results[0]?.club).toEqual({
      id: 'ON-CW',
      name: 'Cobra Swim Club',
      province: 'ON',
    });
  });

  it('finds Felix via trigram fuzziness on a typo', async () => {
    await seedAthlete({ sncId: '5567334', primaryName: 'Felix Bechtel' });
    await seedAthlete({ sncId: '1000003', primaryName: 'Bobby Tables' });

    const result = await searchAthletes({
      prisma: h.prisma,
      args: { q: 'Felx Bechtel', limit: 20, userId },
    });

    const ids = result.results.map((r) => r.sncId);
    expect(ids).toContain('5567334');
  });

  it('narrows results when clubId filter is provided', async () => {
    await seedClub('ON-CW', 'Cobra Swim Club', 'ON');
    await seedClub('BC-PSC', 'Pacific Swim Club', 'BC');
    await seedAthlete({ sncId: '5567334', primaryName: 'Felix Bechtel', clubId: 'ON-CW' });
    await seedAthlete({ sncId: '7000001', primaryName: 'Felix Bechtel', clubId: 'BC-PSC' });
    // need MIN_LOCAL_HITS=3 padding so the unfiltered call returns multiple
    await seedAthlete({ sncId: '7000002', primaryName: 'Felix Beckham' });

    const all = await searchAthletes({
      prisma: h.prisma,
      args: { q: 'Felix Bechtel', limit: 20, userId },
    });
    expect(all.results.length).toBeGreaterThanOrEqual(2);

    const filtered = await searchAthletes({
      prisma: h.prisma,
      args: { q: 'Felix Bechtel', clubId: 'ON-CW', limit: 20, userId },
    });
    expect(filtered.results).toHaveLength(1);
    expect(filtered.results[0]?.sncId).toBe('5567334');
  });

  it('narrows results when province filter is provided', async () => {
    await seedClub('ON-CW', 'Cobra Swim Club', 'ON');
    await seedClub('BC-PSC', 'Pacific Swim Club', 'BC');
    await seedAthlete({ sncId: '5567334', primaryName: 'Felix Bechtel', clubId: 'ON-CW' });
    await seedAthlete({ sncId: '7000001', primaryName: 'Felix Bechtel', clubId: 'BC-PSC' });
    await seedAthlete({ sncId: '7000002', primaryName: 'Felix Beckham', clubId: 'ON-CW' });

    const filtered = await searchAthletes({
      prisma: h.prisma,
      args: { q: 'Felix Bechtel', province: 'BC', limit: 20, userId },
    });
    expect(filtered.results).toHaveLength(1);
    expect(filtered.results[0]?.sncId).toBe('7000001');
  });

  it('sets hasFlipturnProfile and alreadyLinkedToMe correctly', async () => {
    const linked = await seedAthlete({ sncId: '5567334', primaryName: 'Felix Bechtel' });
    const otherLinked = await seedAthlete({ sncId: '1000004', primaryName: 'Felix Other' });
    await seedAthlete({ sncId: '1000005', primaryName: 'Felix Standalone' });

    await h.prisma.userAthlete.create({
      data: { userId, athleteId: linked.id, relationship: 'PARENT' },
    });
    await h.prisma.userAthlete.create({
      data: { userId: otherUserId, athleteId: otherLinked.id, relationship: 'PARENT' },
    });

    const result = await searchAthletes({
      prisma: h.prisma,
      args: { q: 'Felix', limit: 20, userId },
    });

    const byId = new Map(result.results.map((r) => [r.sncId, r]));
    expect(byId.get('5567334')?.hasFlipturnProfile).toBe(true);
    expect(byId.get('5567334')?.alreadyLinkedToMe).toBe(true);
    expect(byId.get('1000004')?.hasFlipturnProfile).toBe(true);
    expect(byId.get('1000004')?.alreadyLinkedToMe).toBe(false);
    expect(byId.get('1000005')?.hasFlipturnProfile).toBe(false);
    expect(byId.get('1000005')?.alreadyLinkedToMe).toBe(false);
  });

  it('triggers remote fallback when local results are sparse and merges new stubs', async () => {
    // Only one local athlete — below MIN_LOCAL_HITS=3, so the remote fallback fires.
    await seedAthlete({ sncId: '9999999', primaryName: 'Felix Localonly' });

    // Synthetic SNC search HTML with a NEW sncId that the proxy will persist.
    const fakeHtml = `
      <html><body>
        <article>
          <h2><a href="/swimmer/8888888/">Felix RemoteStub</a></h2>
        </article>
        <article>
          <h2><a href="/swimmer/9999999/">Felix Localonly</a></h2>
        </article>
      </body></html>
    `;
    const fetch: FetchFn = vi.fn(async () => ({ status: 200, body: fakeHtml }));

    const result = await searchAthletes({
      prisma: h.prisma,
      fetch,
      args: { q: 'Felix', limit: 20, userId },
    });

    expect(result.usedRemoteFallback).toBe(true);
    expect(result.stubsCreated).toBe(1);
    expect(fetch).toHaveBeenCalledWith({
      url: 'https://www.swimming.ca/?s=Felix',
    });

    const ids = result.results.map((r) => r.sncId);
    expect(ids).toContain('8888888');
    expect(ids).toContain('9999999');

    // Stub row was persisted with primaryName from the parser.
    const stub = await h.prisma.athlete.findUnique({ where: { sncId: '8888888' } });
    expect(stub).not.toBeNull();
    expect(stub?.primaryName).toBe('Felix RemoteStub');
    expect(stub?.alternateNames).toEqual([]);
  });

  it('skips remote fallback when local has at least MIN_LOCAL_HITS=3 results', async () => {
    await seedAthlete({ sncId: '1', primaryName: 'Felix One' });
    await seedAthlete({ sncId: '2', primaryName: 'Felix Two' });
    await seedAthlete({ sncId: '3', primaryName: 'Felix Three' });

    const fetch: FetchFn = vi.fn(async () => ({ status: 200, body: '' }));

    const result = await searchAthletes({
      prisma: h.prisma,
      fetch,
      args: { q: 'Felix', limit: 20, userId },
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(result.usedRemoteFallback).toBe(false);
    expect(result.results.length).toBeGreaterThanOrEqual(3);
  });

  it('uses the f_unaccent + GIN index when forced (proves index expression matches)', async () => {
    // The planner correctly prefers Seq Scan on small fixtures. To verify
    // that `f_unaccent` (NOT bare `unaccent`) is the right wrapper for the
    // generated column's expression, we disable seq scan and check that the
    // index is reachable. If the wrapper was wrong, the planner would still
    // fall back to seq scan even with this hint, OR EXPLAIN would refuse.
    await seedAthlete({ sncId: '5567334', primaryName: 'Felix Bechtel' });
    for (let i = 0; i < 50; i++) {
      await seedAthlete({ sncId: `pad-${i}`, primaryName: `Padding Athlete ${i}` });
    }
    await h.prisma.$executeRawUnsafe('ANALYZE "Athlete"');

    type ExplainRow = { 'QUERY PLAN': string };
    // SET LOCAL only takes effect within a transaction, so run both
    // statements via $transaction. (Prisma's $executeRawUnsafe outside a tx
    // would otherwise auto-wrap each call in its own transaction and the
    // SET LOCAL would be discarded before EXPLAIN runs.)
    const plan = await h.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      return tx.$queryRawUnsafe<ExplainRow[]>(
        `EXPLAIN SELECT a."sncId" FROM "Athlete" a
          WHERE a."searchVector" @@ plainto_tsquery('simple', f_unaccent($1))`,
        'Felix Bechtel',
      );
    });
    const planText = plan.map((r) => r['QUERY PLAN']).join('\n');
    expect(planText).toMatch(/Athlete_searchVector_idx|Bitmap Index Scan/i);
  });
});
