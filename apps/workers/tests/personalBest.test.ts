import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execSync } from 'node:child_process';
import { PrismaClient } from '@flipturn/db';
import { reconcile } from '../src/reconcile.js';
import { recomputePersonalBests } from '../src/personalBest.js';
import { parseStub } from '../src/parser/stub.js';

const TEST_DB = `flipturn_pb_test_${Date.now()}`;
const TEST_URL = `postgresql://flipturn:flipturn_dev@localhost:55432/${TEST_DB}?schema=public`;
let prisma: PrismaClient;

describe('recomputePersonalBests', () => {
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
    await prisma.personalBest.deleteMany();
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

  it('creates a PB for every (athlete, eventKey) with at least one OFFICIAL swim', async () => {
    const snap = parseStub({ fixtureName: 'demo-sarah', sncId: 'x', body: '' });
    const { athleteId } = await reconcile(prisma, snap);
    await recomputePersonalBests(prisma, athleteId);

    const pbs = await prisma.personalBest.findMany({ where: { athleteId } });
    // demo-sarah has 2 swims: 100 FR LCM and 200 FR LCM → 2 distinct eventKeys
    expect(pbs).toHaveLength(2);
    const eventKeys = pbs.map((p) => p.eventKey).sort();
    expect(eventKeys).toEqual(['100_FR_LCM', '200_FR_LCM']);
  });

  it('PB points to the fastest OFFICIAL swim and ignores DQ', async () => {
    const snap = parseStub({ fixtureName: 'demo-sarah', sncId: 'x', body: '' });
    const { athleteId } = await reconcile(prisma, snap);

    // mark one swim as DQ — it should be ignored from PB calc
    await prisma.swim.updateMany({
      where: { athleteId, eventKey: '100_FR_LCM' },
      data: { status: 'DQ' },
    });

    await recomputePersonalBests(prisma, athleteId);

    const pb100 = await prisma.personalBest.findUnique({
      where: { athleteId_eventKey: { athleteId, eventKey: '100_FR_LCM' } },
    });
    expect(pb100).toBeNull();
  });

  it('updates the PB swimId when a faster swim arrives', async () => {
    const snap = parseStub({ fixtureName: 'demo-sarah', sncId: 'x', body: '' });
    const { athleteId } = await reconcile(prisma, snap);
    await recomputePersonalBests(prisma, athleteId);

    const pbBefore = await prisma.personalBest.findUnique({
      where: { athleteId_eventKey: { athleteId, eventKey: '100_FR_LCM' } },
    });

    // Replace the 100 FR swim with a faster one
    await prisma.swim.updateMany({
      where: { athleteId, eventKey: '100_FR_LCM' },
      data: { timeCentiseconds: 5000 },
    });
    await recomputePersonalBests(prisma, athleteId);

    const pbAfter = await prisma.personalBest.findUnique({
      where: { athleteId_eventKey: { athleteId, eventKey: '100_FR_LCM' } },
    });
    expect(pbAfter?.timeCentiseconds).toBe(5000);
    expect(pbAfter?.swimId).toBe(pbBefore?.swimId);
  });

  it('is idempotent', async () => {
    const snap = parseStub({ fixtureName: 'demo-sarah', sncId: 'x', body: '' });
    const { athleteId } = await reconcile(prisma, snap);
    await recomputePersonalBests(prisma, athleteId);
    const first = await prisma.personalBest.findMany({ where: { athleteId } });
    await recomputePersonalBests(prisma, athleteId);
    const second = await prisma.personalBest.findMany({ where: { athleteId } });
    expect(second).toEqual(first);
  });
});
