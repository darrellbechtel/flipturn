import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { PrismaClient } from '@flipturn/db';
import { Queue, Worker, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { reconcile } from '../src/reconcile.js';
import { recomputePersonalBests } from '../src/personalBest.js';
import { parseStub } from '../src/parser/stub.js';

const TEST_DB = `flipturn_pipeline_test_${Date.now()}`;
const TEST_URL = `postgresql://flipturn:flipturn_dev@localhost:55432/${TEST_DB}?schema=public`;
const TEST_REDIS_URL = 'redis://localhost:56379';
const QUEUE_NAME = `pipeline-test-${Date.now()}`;

let prisma: PrismaClient;
let redis: Redis;
let queue: Queue;
let worker: Worker;
let events: QueueEvents;

describe('pipeline integration', () => {
  beforeAll(async () => {
    execSync(
      `docker exec flipturn-postgres psql -U flipturn -d flipturn -c "CREATE DATABASE ${TEST_DB};"`,
      { stdio: 'pipe' },
    );
    execSync('pnpm --filter @flipturn/db exec prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: TEST_URL },
      stdio: 'pipe',
    });

    prisma = new PrismaClient({ datasources: { db: { url: TEST_URL } } });
    redis = new Redis(TEST_REDIS_URL, { maxRetriesPerRequest: null });
    queue = new Queue(QUEUE_NAME, { connection: redis });
    events = new QueueEvents(QUEUE_NAME, { connection: redis });
    await events.waitUntilReady();

    worker = new Worker(
      QUEUE_NAME,
      async (job) => {
        const { sncId, fixtureName } = job.data as {
          sncId: string;
          fixtureName?: string | undefined;
        };
        const snap = parseStub(
          fixtureName ? { sncId, fixtureName, body: '' } : { sncId, body: '' },
        );
        const { athleteId } = await reconcile(prisma, snap);
        await recomputePersonalBests(prisma, athleteId);
        return { athleteId };
      },
      { connection: redis, concurrency: 1 },
    );
    await worker.waitUntilReady();
  });

  afterAll(async () => {
    await worker?.close();
    await events?.close();
    await queue?.close();
    await redis?.quit();
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

  it('processes a stub job end-to-end: athlete + swims + PBs in DB', async () => {
    const job = await queue.add('scrape', {
      athleteId: 'pipeline-1',
      sncId: 'DEMO-SARAH-001',
      fixtureName: 'demo-sarah',
    });
    const result = await job.waitUntilFinished(events, 20_000);
    expect(result).toMatchObject({ athleteId: expect.any(String) });

    const athlete = await prisma.athlete.findUnique({
      where: { sncId: 'DEMO-SARAH-001' },
    });
    expect(athlete).not.toBeNull();

    const swims = await prisma.swim.findMany({
      where: { athleteId: athlete!.id },
    });
    expect(swims).toHaveLength(2);

    const pbs = await prisma.personalBest.findMany({
      where: { athleteId: athlete!.id },
    });
    expect(pbs).toHaveLength(2);
  });
});
