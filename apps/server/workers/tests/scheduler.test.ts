import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { PrismaClient } from '@flipturn/db';

const TEST_DB = `flipturn_scheduler_test_${Date.now()}`;
const TEST_URL = `postgresql://flipturn:flipturn_dev@localhost:55432/${TEST_DB}?schema=public`;

let prisma: PrismaClient;

// Mock enqueueScrapeAthlete so we can assert calls without touching Redis.
vi.mock('../src/queue.js', async () => {
  return {
    enqueueScrapeAthlete: vi.fn(async () => 'mock-id'),
  };
});

describe('tickScheduler', () => {
  beforeAll(() => {
    execSync(
      `docker exec flipturn-postgres psql -U flipturn -d flipturn -c "CREATE DATABASE ${TEST_DB};"`,
      { stdio: 'pipe' },
    );
    execSync('pnpm --filter @flipturn/db exec prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: TEST_URL },
      stdio: 'pipe',
    });
    prisma = new PrismaClient({ datasources: { db: { url: TEST_URL } } });
  });

  beforeEach(async () => {
    await prisma.magicLinkToken.deleteMany();
    await prisma.athlete.deleteMany();
    await prisma.user.deleteMany();
    vi.clearAllMocks();
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
    execSync(
      `docker exec flipturn-postgres psql -U flipturn -d flipturn -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${TEST_DB}';"`,
      { stdio: 'pipe' },
    );
    execSync(
      `docker exec flipturn-postgres psql -U flipturn -d flipturn -c "DROP DATABASE ${TEST_DB};"`,
      { stdio: 'pipe' },
    );
  });

  it('enqueues a scrape job per athlete and returns the count', async () => {
    await prisma.athlete.createMany({
      data: [
        { sncId: 'SNC-T-1', primaryName: 'A' },
        { sncId: 'SNC-T-2', primaryName: 'B' },
        { sncId: 'SNC-T-3', primaryName: 'C' },
      ],
    });

    const { tickScheduler } = await import('../src/scheduler.js');
    const { enqueueScrapeAthlete } = await import('../src/queue.js');

    const result = await tickScheduler(prisma);
    expect(result.enqueued).toBe(3);
    expect(enqueueScrapeAthlete).toHaveBeenCalledTimes(3);

    const calls = (enqueueScrapeAthlete as unknown as { mock: { calls: Array<[unknown]> } }).mock
      .calls;
    const sncIds = calls.map((c) => (c[0] as { sncId: string }).sncId).sort();
    expect(sncIds).toEqual(['SNC-T-1', 'SNC-T-2', 'SNC-T-3']);
  });

  it('returns enqueued: 0 when there are no athletes', async () => {
    const { tickScheduler } = await import('../src/scheduler.js');
    const { enqueueScrapeAthlete } = await import('../src/queue.js');
    const result = await tickScheduler(prisma);
    expect(result.enqueued).toBe(0);
    expect(enqueueScrapeAthlete).not.toHaveBeenCalled();
  });

  describe('magic link cleanup', () => {
    it('hard-deletes magic-link tokens expired more than 24h ago', async () => {
      const user = await prisma.user.create({ data: { email: 'cleanup@example.com' } });
      const fresh = await prisma.magicLinkToken.create({
        data: {
          userId: user.id,
          tokenHash: 'h-fresh',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
      const justExpired = await prisma.magicLinkToken.create({
        data: {
          userId: user.id,
          tokenHash: 'h-just',
          expiresAt: new Date(Date.now() - 1000),
        },
      });
      const longExpired = await prisma.magicLinkToken.create({
        data: {
          userId: user.id,
          tokenHash: 'h-long',
          expiresAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
        },
      });

      const { tickScheduler } = await import('../src/scheduler.js');
      await tickScheduler(prisma);

      const remaining = await prisma.magicLinkToken.findMany({ where: { userId: user.id } });
      const ids = remaining.map((r) => r.id);
      expect(ids).toContain(fresh.id);
      expect(ids).toContain(justExpired.id);
      expect(ids).not.toContain(longExpired.id);
    });
  });
});
