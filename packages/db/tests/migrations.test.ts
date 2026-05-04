import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const TEST_DB = `flipturn_migrate_test_${Date.now()}`;
const TEST_URL = `postgresql://flipturn:flipturn_dev@localhost:55432/${TEST_DB}?schema=public`;

let prisma: PrismaClient;

describe('initial migration', () => {
  beforeAll(() => {
    // create the test database
    execSync(
      `docker exec flipturn-postgres psql -U flipturn -d flipturn -c "CREATE DATABASE ${TEST_DB};"`,
      { stdio: 'pipe' },
    );

    // apply migrations against the test database
    execSync('pnpm --filter @flipturn/db exec prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: TEST_URL },
      stdio: 'pipe',
    });

    prisma = new PrismaClient({ datasources: { db: { url: TEST_URL } } });
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
    // drop the test database (must terminate connections first)
    execSync(
      `docker exec flipturn-postgres psql -U flipturn -d flipturn -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${TEST_DB}';"`,
      { stdio: 'pipe' },
    );
    execSync(
      `docker exec flipturn-postgres psql -U flipturn -d flipturn -c "DROP DATABASE ${TEST_DB};"`,
      { stdio: 'pipe' },
    );
  });

  it('creates an athlete and reads it back', async () => {
    const created = await prisma.athlete.create({
      data: {
        sncId: 'TEST-MIGRATE-001',
        primaryName: 'Migration Test',
      },
    });

    const found = await prisma.athlete.findUnique({
      where: { sncId: 'TEST-MIGRATE-001' },
    });

    expect(found).not.toBeNull();
    expect(found?.id).toBe(created.id);
    expect(found?.primaryName).toBe('Migration Test');
  });

  it('enforces the swim idempotency unique constraint', async () => {
    // need the chain: athlete + meet + event before swims
    const athlete = await prisma.athlete.create({
      data: { sncId: 'TEST-MIGRATE-002', primaryName: 'Idempotency Test' },
    });
    const meet = await prisma.meet.create({
      data: {
        externalId: 'TEST-MEET-001',
        name: 'Test Meet',
        course: 'LCM',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-01-02'),
      },
    });
    const event = await prisma.event.create({
      data: {
        meetId: meet.id,
        distanceM: 100,
        stroke: 'FR',
        gender: 'F',
        round: 'TIMED_FINAL',
      },
    });

    await prisma.swim.create({
      data: {
        athleteId: athlete.id,
        meetId: meet.id,
        eventId: event.id,
        timeCentiseconds: 6512,
        splits: [3120, 3392],
        eventKey: '100_FR_LCM',
        dataSource: 'test',
      },
    });

    await expect(
      prisma.swim.create({
        data: {
          athleteId: athlete.id,
          meetId: meet.id,
          eventId: event.id,
          timeCentiseconds: 6512,
          splits: [3120, 3392],
          eventKey: '100_FR_LCM',
          dataSource: 'test',
        },
      }),
    ).rejects.toThrow();
  });
});
