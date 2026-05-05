import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execSync } from 'node:child_process';
import { PrismaClient } from '@flipturn/db';
import { reconcile } from '../src/reconcile.js';
import { DEMO_SARAH } from './fixtures/demoSnapshots.js';

const TEST_DB = `flipturn_reconcile_test_${Date.now()}`;
const TEST_URL = `postgresql://flipturn:flipturn_dev@localhost:55432/${TEST_DB}?schema=public`;

let prisma: PrismaClient;

describe('reconcile', () => {
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
    await prisma.swim.deleteMany();
    await prisma.event.deleteMany();
    await prisma.meet.deleteMany();
    await prisma.athlete.deleteMany();
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

  it('inserts athlete, meet, events, and swims from a fresh snapshot', async () => {
    const snap = DEMO_SARAH;
    await reconcile(prisma, snap);

    const athlete = await prisma.athlete.findUnique({ where: { sncId: 'DEMO-SARAH-001' } });
    expect(athlete).not.toBeNull();
    const meets = await prisma.meet.findMany();
    expect(meets).toHaveLength(1);
    const swims = await prisma.swim.findMany({ where: { athleteId: athlete!.id } });
    expect(swims).toHaveLength(2);
  });

  it('is idempotent — re-applying the same snapshot makes no new rows', async () => {
    const snap = DEMO_SARAH;
    await reconcile(prisma, snap);
    const before = {
      athletes: await prisma.athlete.count(),
      meets: await prisma.meet.count(),
      events: await prisma.event.count(),
      swims: await prisma.swim.count(),
    };
    await reconcile(prisma, snap);
    const after = {
      athletes: await prisma.athlete.count(),
      meets: await prisma.meet.count(),
      events: await prisma.event.count(),
      swims: await prisma.swim.count(),
    };
    expect(after).toEqual(before);
  });

  it('updates athlete metadata if the snapshot changes it', async () => {
    const first = DEMO_SARAH;
    await reconcile(prisma, first);

    const updated = { ...first, homeClub: 'New Club' };
    await reconcile(prisma, updated);

    const athlete = await prisma.athlete.findUnique({ where: { sncId: 'DEMO-SARAH-001' } });
    expect(athlete?.homeClub).toBe('New Club');
  });

  it('sets lastScrapedAt to a recent timestamp', async () => {
    const before = new Date();
    const snap = DEMO_SARAH;
    await reconcile(prisma, snap);
    const athlete = await prisma.athlete.findUnique({ where: { sncId: 'DEMO-SARAH-001' } });
    expect(athlete?.lastScrapedAt).not.toBeNull();
    expect(athlete!.lastScrapedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 100);
  });

  it('writes the eventKey on every swim', async () => {
    const snap = DEMO_SARAH;
    await reconcile(prisma, snap);
    const swims = await prisma.swim.findMany();
    for (const swim of swims) {
      expect(swim.eventKey).toMatch(/^\d+_(FR|BK|BR|FL|IM)_(SCM|LCM|SCY)$/);
    }
  });

  it('writes the snapshot dataSource onto every swim', async () => {
    const snap = DEMO_SARAH;
    await reconcile(prisma, snap);
    const swims = await prisma.swim.findMany();
    expect(swims.length).toBeGreaterThan(0);
    for (const swim of swims) {
      expect(swim.dataSource).toBe(snap.dataSource);
    }
  });
});
