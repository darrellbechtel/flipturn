import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// Mock the queue module so admin endpoints don't try to talk to BullMQ/Redis
// during tests. Both helpers return a stable mock job id; tests assert on the
// mock function's calls to verify arguments.
const enqueueWarmerRunMock = vi.fn(async () => 'mock-warmer-job-id');
const enqueueClubDirectoryCrawlMock = vi.fn(async () => 'mock-directory-job-id');
vi.mock('@flipturn/workers/queue', () => ({
  enqueueWarmerRun: enqueueWarmerRunMock,
  enqueueClubDirectoryCrawl: enqueueClubDirectoryCrawlMock,
  // Re-export shapes other modules may import — kept minimal because nothing
  // else in the API actually imports these names today.
}));

// Import AFTER vi.mock so the mock is in place before the route module's
// top-level imports run.
const { createTestApp } = await import('../helpers/testApp.js');
type TestApp = Awaited<ReturnType<typeof createTestApp>>;

let h: TestApp;
const ADMIN_TOKEN = 'test-admin-token';

describe('Admin routes', () => {
  beforeAll(async () => {
    process.env.ADMIN_TOKEN = ADMIN_TOKEN;
    h = await createTestApp();
  });
  afterAll(async () => {
    await h.teardown();
    delete process.env.ADMIN_TOKEN;
  });
  beforeEach(async () => {
    enqueueWarmerRunMock.mockClear();
    enqueueClubDirectoryCrawlMock.mockClear();
    await h.prisma.athlete.deleteMany();
    await h.prisma.club.deleteMany();
  });

  // ---------------------------------------------------------------------
  // Token gate
  // ---------------------------------------------------------------------
  describe('token gate', () => {
    it('crawl/club-directory returns 401 without x-admin-token', async () => {
      const res = await h.app.request('/v1/admin/crawl/club-directory', {
        method: 'POST',
      });
      expect(res.status).toBe(401);
      expect(enqueueClubDirectoryCrawlMock).not.toHaveBeenCalled();
    });

    it('warmer-run returns 401 without x-admin-token', async () => {
      const res = await h.app.request('/v1/admin/warmer-run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clubName: 'Anything' }),
      });
      expect(res.status).toBe(401);
      expect(enqueueWarmerRunMock).not.toHaveBeenCalled();
    });

    it('index-stats returns 401 without x-admin-token', async () => {
      const res = await h.app.request('/v1/admin/index-stats');
      expect(res.status).toBe(401);
    });

    it('returns 401 when ADMIN_TOKEN env var is unset, even if a header is sent', async () => {
      const saved = process.env.ADMIN_TOKEN;
      delete process.env.ADMIN_TOKEN;
      try {
        const res = await h.app.request('/v1/admin/index-stats', {
          headers: { 'x-admin-token': 'anything' },
        });
        expect(res.status).toBe(401);
      } finally {
        process.env.ADMIN_TOKEN = saved;
      }
    });

    it('returns 401 when token is wrong', async () => {
      const res = await h.app.request('/v1/admin/index-stats', {
        headers: { 'x-admin-token': 'wrong-token' },
      });
      expect(res.status).toBe(401);
    });
  });

  // ---------------------------------------------------------------------
  // POST /v1/admin/crawl/club-directory
  // ---------------------------------------------------------------------
  describe('POST /v1/admin/crawl/club-directory', () => {
    it('enqueues a directory crawl with reason=admin and returns 202', async () => {
      const res = await h.app.request('/v1/admin/crawl/club-directory', {
        method: 'POST',
        headers: { 'x-admin-token': ADMIN_TOKEN },
      });
      expect(res.status).toBe(202);
      const body = (await res.json()) as { enqueued: number };
      expect(body).toEqual({ enqueued: 1 });
      expect(enqueueClubDirectoryCrawlMock).toHaveBeenCalledTimes(1);
      expect(enqueueClubDirectoryCrawlMock).toHaveBeenCalledWith('admin');
    });
  });

  // ---------------------------------------------------------------------
  // POST /v1/admin/warmer-run
  // ---------------------------------------------------------------------
  describe('POST /v1/admin/warmer-run', () => {
    it('enqueues a warmer run for the given clubName and returns 202', async () => {
      const res = await h.app.request('/v1/admin/warmer-run', {
        method: 'POST',
        headers: {
          'x-admin-token': ADMIN_TOKEN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ clubName: 'Etobicoke Olympium SC' }),
      });
      expect(res.status).toBe(202);
      const body = (await res.json()) as { enqueued: number; clubName: string };
      expect(body).toEqual({ enqueued: 1, clubName: 'Etobicoke Olympium SC' });
      expect(enqueueWarmerRunMock).toHaveBeenCalledTimes(1);
      expect(enqueueWarmerRunMock).toHaveBeenCalledWith('Etobicoke Olympium SC', 'admin');
    });

    it('returns 400 when body is missing clubName', async () => {
      const res = await h.app.request('/v1/admin/warmer-run', {
        method: 'POST',
        headers: {
          'x-admin-token': ADMIN_TOKEN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      expect(enqueueWarmerRunMock).not.toHaveBeenCalled();
    });

    it('returns 400 when clubName is an empty string', async () => {
      const res = await h.app.request('/v1/admin/warmer-run', {
        method: 'POST',
        headers: {
          'x-admin-token': ADMIN_TOKEN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ clubName: '   ' }),
      });
      expect(res.status).toBe(400);
      expect(enqueueWarmerRunMock).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------
  // GET /v1/admin/index-stats
  // ---------------------------------------------------------------------
  describe('GET /v1/admin/index-stats', () => {
    it('returns counts and the most-recently-crawled clubs first', async () => {
      // Three clubs with different lastCrawledAt timestamps to verify order.
      const newer = new Date('2026-05-08T12:00:00Z');
      const older = new Date('2026-04-01T12:00:00Z');
      await h.prisma.club.create({
        data: { id: 'ON-CW', name: 'Club Warriors', province: 'ON', lastCrawledAt: older },
      });
      await h.prisma.club.create({
        data: { id: 'BC-PSC', name: 'Pacific Swim Club', province: 'BC', lastCrawledAt: newer },
      });
      await h.prisma.club.create({
        // Never crawled — should appear last (NULLS LAST ordering).
        data: { id: 'AB-NEW', name: 'New Club', province: 'AB' },
      });
      await h.prisma.athlete.create({
        data: { sncId: 'A1', primaryName: 'Alpha One', clubId: 'ON-CW', source: 'CRAWLED' },
      });
      await h.prisma.athlete.create({
        data: { sncId: 'A2', primaryName: 'Beta Two', clubId: 'BC-PSC', source: 'CRAWLED' },
      });

      const res = await h.app.request('/v1/admin/index-stats', {
        headers: { 'x-admin-token': ADMIN_TOKEN },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        totalClubs: number;
        totalAthletes: number;
        recentCrawls: Array<{
          id: string;
          name: string;
          lastCrawledAt: string | null;
          crawlPriority?: number;
        }>;
      };

      expect(body.totalClubs).toBe(3);
      expect(body.totalAthletes).toBe(2);
      expect(body.recentCrawls).toHaveLength(3);
      // Newest first, then older, then never-crawled (NULL).
      expect(body.recentCrawls[0]?.id).toBe('BC-PSC');
      expect(body.recentCrawls[1]?.id).toBe('ON-CW');
      expect(body.recentCrawls[2]?.id).toBe('AB-NEW');
      expect(body.recentCrawls[2]?.lastCrawledAt).toBeNull();
      expect(body.recentCrawls[0]?.crawlPriority).toBe(0);
    });

    it('caps at 50 rows', async () => {
      const seedClubs = Array.from({ length: 60 }, (_, i) => ({
        id: `T-${String(i).padStart(3, '0')}`,
        name: `Test Club ${i}`,
        // Distinct timestamps so the ordering is stable.
        lastCrawledAt: new Date(Date.UTC(2026, 0, 1) + i * 1000),
      }));
      await h.prisma.club.createMany({ data: seedClubs });

      const res = await h.app.request('/v1/admin/index-stats', {
        headers: { 'x-admin-token': ADMIN_TOKEN },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { recentCrawls: Array<{ id: string }> };
      expect(body.recentCrawls.length).toBe(50);
    });

    it('returns zero counts and an empty list when the index is empty', async () => {
      const res = await h.app.request('/v1/admin/index-stats', {
        headers: { 'x-admin-token': ADMIN_TOKEN },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        totalClubs: number;
        totalAthletes: number;
        recentCrawls: unknown[];
      };
      expect(body).toEqual({ totalClubs: 0, totalAthletes: 0, recentCrawls: [] });
    });
  });
});
