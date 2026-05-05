import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@flipturn/db';
import { Queue, Worker, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { reconcile } from '../src/reconcile.js';
import { recomputePersonalBests } from '../src/personalBest.js';
import { parseAthletePage } from '../src/parser/athletePage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '..', 'fixtures', 'snc-athlete-sample.html');

const TEST_DB = `flipturn_pipeline_test_${Date.now()}`;
const TEST_URL = `postgresql://flipturn:flipturn_dev@localhost:55432/${TEST_DB}?schema=public`;
const TEST_REDIS_URL = 'redis://localhost:56379';
const QUEUE_NAME = `pipeline-test-${Date.now()}`;
const SNC_ID = '4030816'; // Ryan Cochrane — fixture athlete

let prisma: PrismaClient;
let redis: Redis;
let queue: Queue;
let worker: Worker;
let events: QueueEvents;
let html: string;

describe('pipeline integration (real parser, mocked fetch)', () => {
  beforeAll(async () => {
    html = await readFile(FIXTURE, 'utf8');

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
        const { sncId } = job.data as { sncId: string; athleteId: string };
        // Bypass politeFetch — feed the captured fixture directly into the real parser.
        const snap = parseAthletePage(html, { sncId });
        const { athleteId } = await reconcile(prisma, snap);
        await recomputePersonalBests(prisma, athleteId);
        return { athleteId, swims: snap.swims.length };
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

  it('processes a real fixture end-to-end: athlete + swims + PBs in DB', async () => {
    const job = await queue.add('scrape', {
      athleteId: 'pipeline-1',
      sncId: SNC_ID,
    });
    const result = (await job.waitUntilFinished(events, 30_000)) as {
      athleteId: string;
      swims: number;
    };
    expect(result.athleteId).toEqual(expect.any(String));
    expect(result.swims).toBeGreaterThan(0);

    const athlete = await prisma.athlete.findUnique({ where: { sncId: SNC_ID } });
    expect(athlete).not.toBeNull();
    expect(athlete?.gender).toBe('M'); // derived from bio text

    const swims = await prisma.swim.findMany({ where: { athleteId: athlete!.id } });
    expect(swims.length).toBeGreaterThan(0);
    for (const s of swims) {
      expect(s.dataSource).toBe('www.swimming.ca');
      expect(s.timeCentiseconds).toBeGreaterThan(0);
    }

    const pbs = await prisma.personalBest.findMany({ where: { athleteId: athlete!.id } });
    expect(pbs.length).toBeGreaterThan(0);
  });
});
