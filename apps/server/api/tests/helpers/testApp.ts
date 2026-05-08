import { execSync } from 'node:child_process';
import { PrismaClient } from '@flipturn/db';
import type { Hono } from 'hono';
import { Redis } from 'ioredis';
import { InMemoryEmailSender } from '../../src/email.js';
import { createApp, type AppDeps } from '../../src/app.js';

const POSTGRES_BASE_URL = 'postgresql://flipturn:flipturn_dev@localhost:55432';
const TEST_REDIS_URL = 'redis://localhost:56379';

export interface TestApp {
  readonly app: Hono;
  readonly prisma: PrismaClient;
  readonly redis: Redis;
  readonly email: InMemoryEmailSender;
  readonly enqueued: Array<{ athleteId: string; sncId: string }>;
  teardown(): Promise<void>;
}

export async function createTestApp(opts?: Partial<AppDeps>): Promise<TestApp> {
  const dbName = `flipturn_api_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  execSync(
    `docker exec flipturn-postgres psql -U flipturn -d flipturn -c "CREATE DATABASE ${dbName};"`,
    { stdio: 'pipe' },
  );
  const dbUrl = `${POSTGRES_BASE_URL}/${dbName}?schema=public`;
  execSync('pnpm --filter @flipturn/db exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: 'pipe',
  });

  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const redis = new Redis(TEST_REDIS_URL, { maxRetriesPerRequest: null });
  const email = new InMemoryEmailSender();
  const enqueued: Array<{ athleteId: string; sncId: string }> = [];

  // Per-instance rate-limit identity so parallel test files (vitest's default
  // is fork-pool with file parallelism) can't collide in a shared 'unknown'
  // bucket — each createTestApp() gets its own slot. Includes the dbName which
  // is already process-unique.
  const testIdentity = `test:${dbName}`;

  // Clear this instance's bucket on construction so a re-run with the same
  // (unlikely-but-possible) dbName starts fresh.
  const existing = await redis.keys(`rl:*:${testIdentity}`);
  if (existing.length) await redis.del(...existing);

  const app = createApp({
    prisma,
    redis,
    email,
    enqueueScrape: async (job) => {
      enqueued.push(job);
      return 'mock-job-id';
    },
    baseUrl: 'http://localhost:3000',
    mobileDeepLinkBase: 'flipturn://auth',
    rateLimitIdentify: () => testIdentity,
    // Default: no remote fallback — tests that exercise the search route
    // pass `searchFetch` through `opts` to inject a vi.fn().
    ...opts,
  });

  return {
    app,
    prisma,
    redis,
    email,
    enqueued,
    teardown: async () => {
      // Drop only this instance's rl:* keys (parallel test files may be
      // running with their own buckets; don't stomp them).
      const keys = await redis.keys(`rl:*:${testIdentity}`);
      if (keys.length) await redis.del(...keys);
      await redis.quit();
      await prisma.$disconnect();
      execSync(
        `docker exec flipturn-postgres psql -U flipturn -d flipturn -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${dbName}';"`,
        { stdio: 'pipe' },
      );
      execSync(
        `docker exec flipturn-postgres psql -U flipturn -d flipturn -c "DROP DATABASE ${dbName};"`,
        { stdio: 'pipe' },
      );
    },
  };
}
