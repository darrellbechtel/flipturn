import { execSync } from 'node:child_process';
import { PrismaClient } from '@flipturn/db';
import type { Hono } from 'hono';
import { InMemoryEmailSender } from '../../src/email.js';
import { createApp, type AppDeps } from '../../src/app.js';

const POSTGRES_BASE_URL = 'postgresql://flipturn:flipturn_dev@localhost:55432';

export interface TestApp {
  readonly app: Hono;
  readonly prisma: PrismaClient;
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
  const email = new InMemoryEmailSender();
  const enqueued: Array<{ athleteId: string; sncId: string }> = [];

  const app = createApp({
    prisma,
    email,
    enqueueScrape: async (job) => {
      enqueued.push(job);
      return 'mock-job-id';
    },
    baseUrl: 'http://localhost:3000',
    mobileDeepLinkBase: 'flipturn://auth',
    ...opts,
  });

  return {
    app,
    prisma,
    email,
    enqueued,
    teardown: async () => {
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
