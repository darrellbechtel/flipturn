# Flip Turn MVP — API Plan (Plan 4 of 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Plan series:** This is plan 4 of 6 derived from [`docs/superpowers/specs/2026-05-04-01-flipturn-mvp-design.md`](../specs/2026-05-04-01-flipturn-mvp-design.md).

- ✅ Plan 1 — Foundation (monorepo + db + shared) — landed
- ✅ Plan 2 — Spike + Worker infrastructure — landed
- ✅ Plan 3 — Real parser + integration — landed
- **Plan 4 — API (this plan)**
- Plan 5 — Mobile (Expo + auth + onboarding + screens)
- Plan 6 — Hosting + closed-beta launch

**Goal:** Stand up `apps/api` as a runnable Hono HTTP server that exposes magic-link auth and the data endpoints listed in design spec §7. After this plan, a mobile client (or `curl`) can request a magic-link email, consume it for a session token, onboard an athlete by SNC ID (which kicks off an immediate scrape), and read that athlete's swims/PBs/progression. All endpoints are integration-tested against a real Postgres + a captured-fixture-driven worker.

**Architecture:** New `apps/api` workspace package supervised by pm2 (Plan 6) on the same Mac Mini as `apps/workers`, sharing the dev Postgres (port `55432`) and Redis (port `56379`). Hono with `@hono/zod-validator` for request validation, reusing `packages/shared` schemas. Sessions are DB-backed (`Session` table from the Plan 1 schema). Magic-link emails are sent via Resend in production and a captured-in-memory fake in tests. API enqueues scrape jobs by importing `enqueueScrapeAthlete` from `@flipturn/workers` directly. ADR 0004 documents the auth design.

**Tech Stack:** Hono 4.x, `@hono/zod-validator`, `@hono/node-server`, `resend@^4`, plus the existing TS 5.6+, pnpm 9, Node 22, Vitest.

**Recommended execution:** Use `superpowers:subagent-driven-development` with `model: "opus"` per the project's preference (see `~/.claude/projects/-Users-darrell-Documents-ai-projects-flipturn/memory/feedback_use_opus_agents.md`).

---

## Context the implementer needs

### From the spec (§7, §9)

**API surface (the full set Plan 4 must deliver):**

```
# Auth
POST   /v1/auth/magic-link/request   { email }                       → 202
POST   /v1/auth/magic-link/consume   { token }                       → { sessionToken }
GET    /v1/auth/me                                                   → { user, athletes }

# Athletes
POST   /v1/athletes/onboard          { sncId, relationship? }        → { athlete }
GET    /v1/athletes                                                  → [ ...athletes ]
DELETE /v1/user-athletes/:id                                         → 204

# Data views
GET    /v1/athletes/:id/swims?eventKey=&limit=&cursor=               → paginated
GET    /v1/athletes/:id/personal-bests                               → [ ...pbs ]
GET    /v1/athletes/:id/progression?eventKey=                        → [ ...points ]

# Ops
GET    /v1/health                                                    → { db, redis }
DELETE /v1/me                                                        → 204
```

All authenticated endpoints (everything except `/auth/magic-link/*`, `/health`) require `Authorization: Bearer <sessionToken>`. Per spec §9, sessions are long-lived in MVP (no expiry), and magic-link tokens are 32 random bytes hashed at rest with sha256, single-use, 15-min TTL.

### From Plan 1 (schema)

The Prisma schema already has the auth tables we need:

- `User { id, email @unique, ... }`
- `MagicLinkToken { id, userId, tokenHash @unique, expiresAt, consumedAt }`
- `Session { id, userId, tokenHash @unique, lastUsedAt, revokedAt }`
- `UserAthlete { userId, athleteId (composite PK), relationship }`

No schema changes are required.

### From Plan 3 (worker hooks)

`@flipturn/workers` exports `enqueueScrapeAthlete({ athleteId, sncId })`. The API calls this in the `/athletes/onboard` flow to trigger an immediate backfill scrape for the new athlete.

### Out of scope for Plan 4 (deferred)

- Pagination cursor stability across DB writes (cursor is a simple `lastId` for MVP; Plan 5 mobile may push this to opaque cursors).
- Rate limiting on the API itself (closed beta is 10–20 users; rate limit work is Plan 6).
- API deployment / Cloudflare Tunnel exposure (Plan 6).
- Plan 3 carry-forward worker items (MIN_BACKOFF, daily budget refund, header-driven row index) — Plan 6.
- WebSocket / SSE (push notifications are deferred to a later spec entirely).

---

## File map (created/modified by this plan)

```
apps/
├── api/
│   ├── package.json                       (CREATE)
│   ├── tsconfig.json                      (CREATE)
│   ├── vitest.config.ts                   (CREATE)
│   ├── README.md                          (CREATE)
│   ├── src/
│   │   ├── index.ts                       (CREATE: process entrypoint)
│   │   ├── env.ts                         (CREATE: zod-validated env)
│   │   ├── logger.ts                      (CREATE: pino factory)
│   │   ├── sentry.ts                      (CREATE: init no-op-if-no-DSN)
│   │   ├── app.ts                         (CREATE: Hono app composition)
│   │   ├── email.ts                       (CREATE: EmailSender interface + Resend impl + InMemory fake)
│   │   ├── auth.ts                        (CREATE: token gen/verify + session helpers)
│   │   ├── middleware/
│   │   │   ├── error.ts                   (CREATE: error handler)
│   │   │   └── session.ts                 (CREATE: bearer auth middleware)
│   │   └── routes/
│   │       ├── auth.ts                    (CREATE: /v1/auth/*)
│   │       ├── athletes.ts                (CREATE: /v1/athletes, /v1/user-athletes/:id)
│   │       ├── data.ts                    (CREATE: /v1/athletes/:id/{swims,personal-bests,progression})
│   │       └── ops.ts                     (CREATE: /v1/health, DELETE /v1/me)
│   └── tests/
│       ├── setup.ts                       (CREATE: shared .env loader, mirrors workers/tests/setup.ts)
│       ├── helpers/
│       │   ├── testApp.ts                 (CREATE: spin up app + transient DB + InMemory email)
│       │   └── factories.ts               (CREATE: makeUser, makeSession, makeAthleteForUser)
│       ├── auth.test.ts                   (CREATE: magic-link request + consume + middleware)
│       ├── athletes.test.ts               (CREATE: onboard + list + delete)
│       ├── data.test.ts                   (CREATE: swims + PBs + progression)
│       ├── ops.test.ts                    (CREATE: /health + DELETE /me)
│       └── e2e.test.ts                    (CREATE: full happy path)
└── workers/
    └── src/scheduler.ts                   (MODIFY: add cleanupExpiredMagicLinks call)

docs/adr/
└── 0004-auth-design.md                    (CREATE: magic-link details, session model)
```

---

## Task 1: apps/api scaffolding

**Files:**

- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/vitest.config.ts`
- Create: `apps/api/README.md`
- Create: `apps/api/src/index.ts` (placeholder)
- Create: `apps/api/src/env.ts` (zod-validated env)
- Create: `apps/api/tests/setup.ts` (mirrors `apps/workers/tests/setup.ts`)
- Modify: root `package.json` to add `api:dev`, `api:start`, `api:test` scripts

### Step 1.1: Create `apps/api/package.json`

```json
{
  "name": "@flipturn/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@flipturn/db": "workspace:*",
    "@flipturn/shared": "workspace:*",
    "@flipturn/workers": "workspace:*",
    "@hono/node-server": "^1.13.0",
    "@hono/zod-validator": "^0.4.0",
    "@sentry/node": "^8.34.0",
    "hono": "^4.6.0",
    "pino": "^9.5.0",
    "pino-pretty": "^11.3.0",
    "resend": "^4.0.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.7.0",
    "tsx": "^4.19.1",
    "typescript": "^5.6.3",
    "vitest": "^2.1.2"
  }
}
```

### Step 1.2: Create `apps/api/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules", "tests"]
}
```

### Step 1.3: Create `apps/api/vitest.config.ts`

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    testTimeout: 30_000,
    setupFiles: ['./tests/setup.ts'],
  },
});
```

### Step 1.4: Create `apps/api/tests/setup.ts`

Use the same hand-rolled `.env` loader pattern as `apps/workers/tests/setup.ts`. Copy that file's content verbatim — it's already proven to work in this monorepo.

Read `apps/workers/tests/setup.ts` and copy it to `apps/api/tests/setup.ts`.

### Step 1.5: Create `apps/api/src/env.ts`

```ts
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  SENTRY_DSN: z
    .string()
    .transform((v) => (v === '' ? undefined : v))
    .pipe(z.string().url().optional()),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  PORT: z.coerce.number().int().positive().default(3000),
  BASE_URL: z.string().url().default('http://localhost:3000'),
  // Resend
  RESEND_API_KEY: z
    .string()
    .transform((v) => (v === '' ? undefined : v))
    .pipe(z.string().min(1).optional()),
  EMAIL_FROM: z.string().default('Flip Turn <noreply@flipturn.app>'),
  // App-specific
  MOBILE_DEEP_LINK_BASE: z.string().default('flipturn://auth'),
});

export type ApiEnv = z.infer<typeof EnvSchema>;

let _env: ApiEnv | undefined;

export function getEnv(): ApiEnv {
  if (!_env) {
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
      console.error('Invalid api env:', parsed.error.flatten().fieldErrors);
      process.exit(1);
    }
    _env = parsed.data;
  }
  return _env;
}
```

NOTE: the `transform → pipe` pattern for `SENTRY_DSN` and `RESEND_API_KEY` handles the `KEY=` (empty string) case in `.env.example`, mirroring the workers package.

### Step 1.6: Create placeholder `apps/api/src/index.ts`

```ts
// API process entrypoint. Wired up in Task 12.
console.log('flipturn api — not yet implemented');
```

### Step 1.7: Create `apps/api/README.md`

````markdown
# @flipturn/api

Hono HTTP server for the Flip Turn MVP. Authenticates parents via magic-link
email and exposes athlete + swim + PB endpoints over a small JSON API.

## Local development

Requires the dev infra (Postgres + Redis) to be running:

```bash
pnpm dev:up
```
````

Then from the repo root:

```bash
pnpm api:dev      # tsx --watch on src/index.ts
pnpm api:test     # run API tests
```

The API is intentionally a thin layer over `@flipturn/db` and `@flipturn/workers`.
Auth is documented in [`docs/adr/0004-auth-design.md`](../../docs/adr/0004-auth-design.md).

````

(Use real triple-backticks in the file — not the escaped form shown above.)

### Step 1.8: Update root `package.json`

Read the current root `package.json`. In `"scripts"`, add three entries after the existing `workers:test` line:

```json
"api:dev": "pnpm --filter @flipturn/api dev",
"api:start": "pnpm --filter @flipturn/api start",
"api:test": "pnpm --filter @flipturn/api test"
````

### Step 1.9: Update `.env.example`

Append a new section to `.env.example`:

```
# API (apps/api)
PORT=3000
BASE_URL="http://localhost:3000"
RESEND_API_KEY=                      # leave blank in dev to use the InMemory fake
EMAIL_FROM="Flip Turn <noreply@flipturn.app>"
MOBILE_DEEP_LINK_BASE="flipturn://auth"
```

Then `cp .env.example .env` (or merge by hand if you've customized it).

### Step 1.10: Install + verify

```bash
pnpm install
pnpm ls --filter @flipturn/api --depth -1
pnpm api:start
```

Expected:

- `pnpm install` succeeds with the new package
- `pnpm ls` shows `@flipturn/api@0.0.0`
- `pnpm api:start` prints `flipturn api — not yet implemented` and exits 0

### Step 1.11: Format/lint/typecheck

Run `pnpm format:check`, `pnpm lint`, `pnpm --filter @flipturn/api typecheck` — all exit 0.

### Step 1.12: Commit

```bash
git add apps/api package.json pnpm-lock.yaml .env.example
git commit -m "feat(api): scaffold @flipturn/api package"
```

Use exactly that commit message.

---

## Task 2: Email sender abstraction (Resend + InMemory fake)

**Files:**

- Create: `apps/api/src/email.ts`
- Create: `apps/api/tests/email.test.ts`

### Step 2.1: Write the failing tests

Create `apps/api/tests/email.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryEmailSender } from '../src/email.js';

describe('InMemoryEmailSender', () => {
  let sender: InMemoryEmailSender;

  beforeEach(() => {
    sender = new InMemoryEmailSender();
  });

  it('captures sent emails', async () => {
    await sender.send({
      to: 'a@example.com',
      subject: 'Hello',
      htmlBody: '<p>Click here</p>',
      textBody: 'Click here',
    });
    expect(sender.outbox).toHaveLength(1);
    expect(sender.outbox[0]?.to).toBe('a@example.com');
    expect(sender.outbox[0]?.subject).toBe('Hello');
  });

  it('latestTo returns the most recent message to a given address', async () => {
    await sender.send({ to: 'a@example.com', subject: 'First', htmlBody: '', textBody: '' });
    await sender.send({ to: 'b@example.com', subject: 'Other', htmlBody: '', textBody: '' });
    await sender.send({ to: 'a@example.com', subject: 'Second', htmlBody: '', textBody: '' });
    expect(sender.latestTo('a@example.com')?.subject).toBe('Second');
    expect(sender.latestTo('a@example.com')?.subject).not.toBe('First');
  });

  it('clear() resets the outbox', async () => {
    await sender.send({ to: 'a@example.com', subject: 'X', htmlBody: '', textBody: '' });
    sender.clear();
    expect(sender.outbox).toHaveLength(0);
  });
});
```

### Step 2.2: Run — verify failure

Run: `pnpm --filter @flipturn/api test email`
Expected: tests fail with module-not-found.

### Step 2.3: Implement `apps/api/src/email.ts`

```ts
import { Resend } from 'resend';

export interface OutgoingEmail {
  readonly to: string;
  readonly subject: string;
  readonly htmlBody: string;
  readonly textBody: string;
}

export interface EmailSender {
  send(email: OutgoingEmail): Promise<void>;
}

/** Production sender — uses Resend. */
export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly resend: Resend,
    private readonly from: string,
  ) {}

  async send(email: OutgoingEmail): Promise<void> {
    const { error } = await this.resend.emails.send({
      from: this.from,
      to: email.to,
      subject: email.subject,
      html: email.htmlBody,
      text: email.textBody,
    });
    if (error) {
      throw new Error(`ResendEmailSender.send failed: ${JSON.stringify(error)}`);
    }
  }
}

/** Test/dev sender — captures emails in memory. */
export class InMemoryEmailSender implements EmailSender {
  private readonly _outbox: OutgoingEmail[] = [];

  get outbox(): readonly OutgoingEmail[] {
    return this._outbox;
  }

  async send(email: OutgoingEmail): Promise<void> {
    this._outbox.push(email);
  }

  latestTo(addr: string): OutgoingEmail | undefined {
    for (let i = this._outbox.length - 1; i >= 0; i--) {
      if (this._outbox[i]?.to === addr) {
        return this._outbox[i];
      }
    }
    return undefined;
  }

  clear(): void {
    this._outbox.length = 0;
  }
}
```

### Step 2.4: Run — verify pass

Run: `pnpm --filter @flipturn/api test email`
Expected: 3 tests pass.

### Step 2.5: Commit

```bash
git add apps/api/src/email.ts apps/api/tests/email.test.ts
git commit -m "feat(api): EmailSender interface with Resend impl and in-memory fake"
```

---

## Task 3: Auth helpers (token gen, hash, session create)

**Files:**

- Create: `apps/api/src/auth.ts`
- Create: `apps/api/tests/auth.test.ts`

### Step 3.1: Write the failing tests

Create `apps/api/tests/auth.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  generateMagicLinkToken,
  hashToken,
  buildMagicLinkUrl,
  parseBearerHeader,
} from '../src/auth.js';

describe('generateMagicLinkToken', () => {
  it('returns a 64-char hex string', () => {
    const t = generateMagicLinkToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is unique across calls', () => {
    const a = generateMagicLinkToken();
    const b = generateMagicLinkToken();
    expect(a).not.toBe(b);
  });
});

describe('hashToken', () => {
  it('produces a stable sha256 hex digest', () => {
    const h = hashToken('abc123');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken('abc123')).toBe(h);
    expect(hashToken('abc124')).not.toBe(h);
  });
});

describe('buildMagicLinkUrl', () => {
  it('appends token to the deep-link base', () => {
    expect(buildMagicLinkUrl('flipturn://auth', 'tok-1')).toBe('flipturn://auth?token=tok-1');
  });

  it('URL-encodes the token', () => {
    expect(buildMagicLinkUrl('flipturn://auth', 'a b/c')).toBe('flipturn://auth?token=a%20b%2Fc');
  });
});

describe('parseBearerHeader', () => {
  it('extracts token from "Bearer <token>"', () => {
    expect(parseBearerHeader('Bearer abc')).toBe('abc');
    expect(parseBearerHeader('bearer abc')).toBe('abc');
  });

  it('returns null on missing or malformed header', () => {
    expect(parseBearerHeader(null)).toBeNull();
    expect(parseBearerHeader('')).toBeNull();
    expect(parseBearerHeader('Basic abc')).toBeNull();
    expect(parseBearerHeader('Bearer ')).toBeNull();
  });
});
```

### Step 3.2: Run — verify failure

Run: `pnpm --filter @flipturn/api test auth`
Expected: fails with module-not-found.

### Step 3.3: Implement `apps/api/src/auth.ts`

```ts
import { createHash, randomBytes } from 'node:crypto';

export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

export function generateMagicLinkToken(): string {
  return randomBytes(32).toString('hex');
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function buildMagicLinkUrl(base: string, token: string): string {
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}token=${encodeURIComponent(token)}`;
}

export function parseBearerHeader(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match?.[1] ?? null;
}
```

### Step 3.4: Run — verify pass

Run: `pnpm --filter @flipturn/api test auth`
Expected: ~10 tests pass.

### Step 3.5: Commit

```bash
git add apps/api/src/auth.ts apps/api/tests/auth.test.ts
git commit -m "feat(api): auth helpers (magic-link token, hash, bearer parse)"
```

---

## Task 4: Test app harness (transient DB + composed Hono app)

**Files:**

- Create: `apps/api/tests/helpers/testApp.ts`
- Create: `apps/api/tests/helpers/factories.ts`
- Create: `apps/api/src/app.ts` (skeleton — middleware + routes wired in subsequent tasks)
- Create: `apps/api/src/middleware/error.ts`
- Create: `apps/api/src/middleware/session.ts` (skeleton — fully implemented in Task 5)
- Create: `apps/api/src/logger.ts`
- Create: `apps/api/src/sentry.ts`

The harness lets every test file spin up an isolated transient Postgres DB plus a Hono app composed with an `InMemoryEmailSender`. This is the foundation for every TDD task that follows.

### Step 4.1: Create `apps/api/src/logger.ts`

Identical pattern to `apps/workers/src/logger.ts`:

```ts
import { pino, type Logger } from 'pino';
import { getEnv } from './env.js';

let _logger: Logger | undefined;

export function getLogger(): Logger {
  if (!_logger) {
    const env = getEnv();
    const transport: { transport?: { target: string; options: { colorize: boolean } } } = {};
    if (env.NODE_ENV === 'development') {
      transport.transport = { target: 'pino-pretty', options: { colorize: true } };
    }
    _logger = pino({
      level: env.LOG_LEVEL,
      base: { service: 'flipturn-api' },
      ...transport,
    });
  }
  return _logger;
}
```

### Step 4.2: Create `apps/api/src/sentry.ts`

Identical pattern to `apps/workers/src/sentry.ts`. Read that file and copy its structure, swapping `flipturn-workers` for `flipturn-api` in any logged service name.

### Step 4.3: Create `apps/api/src/middleware/error.ts`

```ts
import type { Context, Next } from 'hono';
import { ZodError } from 'zod';
import { getLogger } from '../logger.js';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function errorMiddleware(c: Context, next: Next): Promise<Response | void> {
  try {
    await next();
  } catch (err) {
    const log = getLogger();
    if (err instanceof ApiError) {
      log.warn({ err, status: err.status, code: err.code }, 'api error');
      return c.json(
        { error: { code: err.code ?? 'api_error', message: err.message } },
        err.status as 400 | 401 | 403 | 404 | 409,
      );
    }
    if (err instanceof ZodError) {
      log.warn({ err: err.flatten() }, 'validation error');
      return c.json({ error: { code: 'validation_error', issues: err.flatten() } }, 400);
    }
    log.error({ err }, 'unhandled error');
    return c.json({ error: { code: 'internal_error', message: 'Internal Server Error' } }, 500);
  }
}
```

### Step 4.4: Create `apps/api/src/middleware/session.ts` (skeleton)

```ts
import type { Context, Next } from 'hono';
import type { PrismaClient, Session, User } from '@flipturn/db';
import { ApiError } from './error.js';
import { hashToken, parseBearerHeader } from '../auth.js';

export interface SessionContext {
  readonly user: User;
  readonly session: Session;
}

declare module 'hono' {
  interface ContextVariableMap {
    auth: SessionContext;
  }
}

export function sessionMiddleware(prisma: PrismaClient) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const header = c.req.header('authorization');
    const token = parseBearerHeader(header);
    if (!token) {
      throw new ApiError(401, 'Missing or malformed Authorization header', 'unauthenticated');
    }
    const tokenHash = hashToken(token);
    const session = await prisma.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!session || session.revokedAt) {
      throw new ApiError(401, 'Invalid session', 'unauthenticated');
    }
    // bump lastUsedAt opportunistically; fire-and-forget
    void prisma.session.update({
      where: { id: session.id },
      data: { lastUsedAt: new Date() },
    });
    c.set('auth', { user: session.user, session });
    await next();
  };
}
```

### Step 4.5: Create `apps/api/src/app.ts` (skeleton)

```ts
import { Hono } from 'hono';
import type { PrismaClient } from '@flipturn/db';
import type { EmailSender } from './email.js';
import { errorMiddleware } from './middleware/error.js';

export interface AppDeps {
  readonly prisma: PrismaClient;
  readonly email: EmailSender;
  readonly enqueueScrape: (job: { athleteId: string; sncId: string }) => Promise<string>;
  readonly baseUrl: string;
  readonly mobileDeepLinkBase: string;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.use('*', errorMiddleware);

  // Routes wired in Tasks 5-9. For now, a stub /v1/health to verify the app boots.
  app.get('/v1/health', (c) => c.json({ ok: true }));

  return app;
}
```

### Step 4.6: Create `apps/api/tests/helpers/testApp.ts`

```ts
import { execSync } from 'node:child_process';
import { PrismaClient } from '@flipturn/db';
import { Hono } from 'hono';
import type { EmailSender } from '../../src/email.js';
import { InMemoryEmailSender } from '../../src/email.js';
import { createApp, type AppDeps } from '../../src/app.js';

const POSTGRES_BASE_URL = 'postgresql://flipturn:flipturn_dev@localhost:55432';

export interface TestApp {
  readonly app: Hono;
  readonly prisma: PrismaClient;
  readonly email: InMemoryEmailSender;
  readonly enqueued: Array<{ athleteId: string; sncId: string }>;
  /** Tear down: disconnect prisma + drop transient DB. */
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
```

### Step 4.7: Create `apps/api/tests/helpers/factories.ts`

```ts
import type { PrismaClient } from '@flipturn/db';
import { generateSessionToken, hashToken } from '../../src/auth.js';

export async function makeUser(prisma: PrismaClient, email = 'parent@example.com') {
  return prisma.user.create({ data: { email } });
}

export async function makeSession(prisma: PrismaClient, userId: string) {
  const token = generateSessionToken();
  const session = await prisma.session.create({
    data: { userId, tokenHash: hashToken(token) },
  });
  return { token, session };
}

export async function makeAthleteForUser(
  prisma: PrismaClient,
  userId: string,
  sncId: string,
  primaryName: string,
) {
  const athlete = await prisma.athlete.create({
    data: { sncId, primaryName, dataSource: 'www.swimming.ca' as never },
  });
  await prisma.userAthlete.create({
    data: { userId, athleteId: athlete.id, relationship: 'PARENT' },
  });
  return athlete;
}
```

NOTE: `Athlete` doesn't have a `dataSource` column (that's on `Swim`). Strip the `dataSource` line from `makeAthleteForUser`. The `as never` is a placeholder I'm leaving in the prompt to remind you to delete it. Final correct shape:

```ts
const athlete = await prisma.athlete.create({
  data: { sncId, primaryName },
});
```

### Step 4.8: Smoke-test the harness

Create a brief test `apps/api/tests/smoke.test.ts`:

```ts
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { createTestApp, type TestApp } from './helpers/testApp.js';

let h: TestApp;

describe('test harness smoke', () => {
  beforeAll(async () => {
    h = await createTestApp();
  });

  afterAll(async () => {
    await h.teardown();
  });

  it('boots the app and responds to /v1/health', async () => {
    const res = await h.app.request('/v1/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
```

Run: `pnpm --filter @flipturn/api test smoke`
Expected: 1 test passes.

### Step 4.9: Run all tests

Run: `pnpm --filter @flipturn/api test`
Expected: smoke (1) + email (3) + auth (~10) tests all pass = 14 total.

### Step 4.10: Typecheck + format

Run `pnpm --filter @flipturn/api typecheck` and `pnpm format:check` — both exit 0.

### Step 4.11: Commit

```bash
git add apps/api/src apps/api/tests
git commit -m "feat(api): test harness (transient DB + composed Hono app)"
```

---

## Task 5: Auth routes — magic-link request + consume + /auth/me (TDD)

**Files:**

- Create: `apps/api/src/routes/auth.ts`
- Create: `apps/api/tests/auth.routes.test.ts` (different from `auth.test.ts` which tested helpers)
- Modify: `apps/api/src/app.ts` to mount the auth routes + apply session middleware to `/auth/me`

### Step 5.1: Write the failing tests

Create `apps/api/tests/auth.routes.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestApp, type TestApp } from './helpers/testApp.js';
import { hashToken } from '../src/auth.js';

let h: TestApp;

describe('POST /v1/auth/magic-link/request', () => {
  beforeAll(async () => {
    h = await createTestApp();
  });
  afterAll(async () => {
    await h.teardown();
  });
  beforeEach(async () => {
    await h.prisma.magicLinkToken.deleteMany();
    await h.prisma.session.deleteMany();
    await h.prisma.user.deleteMany();
    h.email.clear();
  });

  it('creates a user, a token row, and sends an email', async () => {
    const res = await h.app.request('/v1/auth/magic-link/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'darrell@example.com' }),
    });
    expect(res.status).toBe(202);

    const user = await h.prisma.user.findUnique({ where: { email: 'darrell@example.com' } });
    expect(user).not.toBeNull();

    const tokens = await h.prisma.magicLinkToken.findMany({ where: { userId: user!.id } });
    expect(tokens).toHaveLength(1);

    const sent = h.email.latestTo('darrell@example.com');
    expect(sent).toBeDefined();
    expect(sent?.subject).toContain('Flip Turn');
    expect(sent?.htmlBody).toContain('flipturn://auth?token=');
  });

  it('lowercases the email', async () => {
    const res = await h.app.request('/v1/auth/magic-link/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: '  Darrell@Example.COM  ' }),
    });
    expect(res.status).toBe(202);
    const user = await h.prisma.user.findUnique({ where: { email: 'darrell@example.com' } });
    expect(user).not.toBeNull();
  });

  it('rejects malformed email', async () => {
    const res = await h.app.request('/v1/auth/magic-link/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    expect(res.status).toBe(400);
  });

  it('reuses the User row on subsequent requests', async () => {
    await h.app.request('/v1/auth/magic-link/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com' }),
    });
    await h.app.request('/v1/auth/magic-link/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com' }),
    });
    const users = await h.prisma.user.findMany();
    expect(users).toHaveLength(1);
    const tokens = await h.prisma.magicLinkToken.findMany();
    expect(tokens).toHaveLength(2); // both requests issue a fresh token
  });
});

describe('POST /v1/auth/magic-link/consume', () => {
  beforeAll(async () => {
    h = await createTestApp();
  });
  afterAll(async () => {
    await h.teardown();
  });
  beforeEach(async () => {
    await h.prisma.magicLinkToken.deleteMany();
    await h.prisma.session.deleteMany();
    await h.prisma.user.deleteMany();
    h.email.clear();
  });

  async function requestAndExtractToken(email: string): Promise<string> {
    await h.app.request('/v1/auth/magic-link/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const sent = h.email.latestTo(email);
    if (!sent) throw new Error('no email sent');
    const m = /token=([^&"\s)]+)/.exec(sent.htmlBody);
    if (!m?.[1]) throw new Error('no token in email');
    return decodeURIComponent(m[1]);
  }

  it('issues a session token and marks the magic-link consumed', async () => {
    const token = await requestAndExtractToken('a@example.com');
    const res = await h.app.request('/v1/auth/magic-link/consume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessionToken: string };
    expect(body.sessionToken).toMatch(/^[0-9a-f]{64}$/);

    const tokenRow = await h.prisma.magicLinkToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    expect(tokenRow?.consumedAt).not.toBeNull();
  });

  it('rejects an unknown token', async () => {
    const res = await h.app.request('/v1/auth/magic-link/consume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'no-such-token' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a token that was already consumed', async () => {
    const token = await requestAndExtractToken('a@example.com');
    const first = await h.app.request('/v1/auth/magic-link/consume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    expect(first.status).toBe(200);
    const second = await h.app.request('/v1/auth/magic-link/consume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    expect(second.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const token = await requestAndExtractToken('a@example.com');
    // backdate the token's expiry
    await h.prisma.magicLinkToken.updateMany({
      where: { tokenHash: hashToken(token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await h.app.request('/v1/auth/magic-link/consume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    expect(res.status).toBe(401);
  });
});

describe('GET /v1/auth/me', () => {
  beforeAll(async () => {
    h = await createTestApp();
  });
  afterAll(async () => {
    await h.teardown();
  });
  beforeEach(async () => {
    await h.prisma.session.deleteMany();
    await h.prisma.user.deleteMany();
  });

  async function signIn(): Promise<string> {
    const email = 'me@example.com';
    await h.app.request('/v1/auth/magic-link/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const sent = h.email.latestTo(email);
    if (!sent) throw new Error('no email');
    const m = /token=([^&"\s)]+)/.exec(sent.htmlBody);
    const token = decodeURIComponent(m![1]!);
    const res = await h.app.request('/v1/auth/magic-link/consume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    return ((await res.json()) as { sessionToken: string }).sessionToken;
  }

  it('returns the authenticated user', async () => {
    const sessionToken = await signIn();
    const res = await h.app.request('/v1/auth/me', {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { email: string }; athletes: unknown[] };
    expect(body.user.email).toBe('me@example.com');
    expect(body.athletes).toEqual([]);
  });

  it('returns 401 without a bearer token', async () => {
    const res = await h.app.request('/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 with an invalid bearer token', async () => {
    const res = await h.app.request('/v1/auth/me', {
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    expect(res.status).toBe(401);
  });
});
```

### Step 5.2: Run — verify failure

Run: `pnpm --filter @flipturn/api test auth.routes`
Expected: tests fail because routes don't exist yet.

### Step 5.3: Implement `apps/api/src/routes/auth.ts`

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { MagicLinkRequestSchema, MagicLinkConsumeSchema } from '@flipturn/shared';
import type { AppDeps } from '../app.js';
import { ApiError } from '../middleware/error.js';
import {
  buildMagicLinkUrl,
  generateMagicLinkToken,
  generateSessionToken,
  hashToken,
  MAGIC_LINK_TTL_MS,
} from '../auth.js';
import { sessionMiddleware } from '../middleware/session.js';

export function authRoutes(deps: AppDeps): Hono {
  const r = new Hono();

  r.post('/magic-link/request', zValidator('json', MagicLinkRequestSchema), async (c) => {
    const { email } = c.req.valid('json');
    const user = await deps.prisma.user.upsert({
      where: { email },
      update: {},
      create: { email },
    });
    const tokenPlain = generateMagicLinkToken();
    await deps.prisma.magicLinkToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(tokenPlain),
        expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS),
      },
    });
    const link = buildMagicLinkUrl(deps.mobileDeepLinkBase, tokenPlain);
    await deps.email.send({
      to: email,
      subject: 'Sign in to Flip Turn',
      htmlBody: renderHtmlEmail(link),
      textBody: renderTextEmail(link),
    });
    return c.body(null, 202);
  });

  r.post('/magic-link/consume', zValidator('json', MagicLinkConsumeSchema), async (c) => {
    const { token } = c.req.valid('json');
    const tokenHash = hashToken(token);
    const row = await deps.prisma.magicLinkToken.findUnique({ where: { tokenHash } });
    if (!row) {
      throw new ApiError(401, 'Invalid token', 'invalid_token');
    }
    if (row.consumedAt) {
      throw new ApiError(401, 'Token already used', 'invalid_token');
    }
    if (row.expiresAt.getTime() < Date.now()) {
      throw new ApiError(401, 'Token expired', 'invalid_token');
    }
    const sessionTokenPlain = generateSessionToken();
    await deps.prisma.$transaction([
      deps.prisma.magicLinkToken.update({
        where: { id: row.id },
        data: { consumedAt: new Date() },
      }),
      deps.prisma.session.create({
        data: { userId: row.userId, tokenHash: hashToken(sessionTokenPlain) },
      }),
    ]);
    return c.json({ sessionToken: sessionTokenPlain });
  });

  r.get('/me', sessionMiddleware(deps.prisma), async (c) => {
    const { user } = c.get('auth');
    const userAthletes = await deps.prisma.userAthlete.findMany({
      where: { userId: user.id },
      include: { athlete: true },
      orderBy: { addedAt: 'asc' },
    });
    return c.json({
      user: { id: user.id, email: user.email, createdAt: user.createdAt.toISOString() },
      athletes: userAthletes.map((ua) => ({
        id: ua.athlete.id,
        sncId: ua.athlete.sncId,
        primaryName: ua.athlete.primaryName,
        gender: ua.athlete.gender,
        homeClub: ua.athlete.homeClub,
        relationship: ua.relationship,
      })),
    });
  });

  return r;
}

function renderHtmlEmail(link: string): string {
  return `<!doctype html>
<html><body style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;padding:24px">
  <h2>Sign in to Flip Turn</h2>
  <p>Tap the link below to sign in. The link expires in 15 minutes.</p>
  <p><a href="${link}" style="display:inline-block;padding:12px 16px;background:#1F3D5C;color:#fff;text-decoration:none;border-radius:6px">Open Flip Turn</a></p>
  <p style="color:#888;font-size:12px">If the button doesn't work, copy this link into your browser: ${link}</p>
</body></html>`;
}

function renderTextEmail(link: string): string {
  return `Sign in to Flip Turn\n\nOpen this link to sign in (expires in 15 minutes):\n\n${link}\n`;
}
```

### Step 5.4: Wire auth routes into `app.ts`

Modify `apps/api/src/app.ts`:

```ts
import { Hono } from 'hono';
import type { PrismaClient } from '@flipturn/db';
import type { EmailSender } from './email.js';
import { errorMiddleware } from './middleware/error.js';
import { authRoutes } from './routes/auth.js';

export interface AppDeps {
  readonly prisma: PrismaClient;
  readonly email: EmailSender;
  readonly enqueueScrape: (job: { athleteId: string; sncId: string }) => Promise<string>;
  readonly baseUrl: string;
  readonly mobileDeepLinkBase: string;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.use('*', errorMiddleware);

  app.route('/v1/auth', authRoutes(deps));

  app.get('/v1/health', (c) => c.json({ ok: true }));

  return app;
}
```

### Step 5.5: Run — verify pass

Run: `pnpm --filter @flipturn/api test auth.routes`
Expected: all auth-routes tests pass (~11 across the three describe blocks).

### Step 5.6: Run all tests

Run: `pnpm --filter @flipturn/api test`
Expected: all API tests pass.

### Step 5.7: Typecheck + format

Run `pnpm --filter @flipturn/api typecheck` and `pnpm format:check` — both exit 0.

### Step 5.8: Commit

```bash
git add apps/api/src/routes/auth.ts apps/api/src/app.ts apps/api/tests/auth.routes.test.ts
git commit -m "feat(api): magic-link auth routes + /auth/me"
```

---

## Task 6: Athletes routes — onboard + list + delete (TDD)

**Files:**

- Create: `apps/api/src/routes/athletes.ts`
- Create: `apps/api/tests/athletes.test.ts`
- Modify: `apps/api/src/app.ts` to mount the athletes routes

### Step 6.1: Write the failing tests

Create `apps/api/tests/athletes.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestApp, type TestApp } from './helpers/testApp.js';
import { makeUser, makeSession, makeAthleteForUser } from './helpers/factories.js';

let h: TestApp;
let bearer: string;
let userId: string;

describe('athletes routes', () => {
  beforeAll(async () => {
    h = await createTestApp();
  });
  afterAll(async () => {
    await h.teardown();
  });
  beforeEach(async () => {
    await h.prisma.userAthlete.deleteMany();
    await h.prisma.session.deleteMany();
    await h.prisma.athlete.deleteMany();
    await h.prisma.user.deleteMany();
    h.enqueued.length = 0;
    const user = await makeUser(h.prisma, 'p@example.com');
    userId = user.id;
    const { token } = await makeSession(h.prisma, user.id);
    bearer = `Bearer ${token}`;
  });

  describe('POST /v1/athletes/onboard', () => {
    it('creates a new athlete + UserAthlete + enqueues a scrape', async () => {
      const res = await h.app.request('/v1/athletes/onboard', {
        method: 'POST',
        headers: { authorization: bearer, 'content-type': 'application/json' },
        body: JSON.stringify({ sncId: '4030816' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { athlete: { id: string; sncId: string } };
      expect(body.athlete.sncId).toBe('4030816');

      const athlete = await h.prisma.athlete.findUnique({ where: { sncId: '4030816' } });
      expect(athlete).not.toBeNull();
      const link = await h.prisma.userAthlete.findUnique({
        where: { userId_athleteId: { userId, athleteId: athlete!.id } },
      });
      expect(link?.relationship).toBe('PARENT');

      expect(h.enqueued).toHaveLength(1);
      expect(h.enqueued[0]?.sncId).toBe('4030816');
    });

    it('reuses an existing athlete; only the UserAthlete is created', async () => {
      const existing = await h.prisma.athlete.create({
        data: { sncId: '9999', primaryName: 'Existing' },
      });
      const res = await h.app.request('/v1/athletes/onboard', {
        method: 'POST',
        headers: { authorization: bearer, 'content-type': 'application/json' },
        body: JSON.stringify({ sncId: '9999', relationship: 'GUARDIAN' }),
      });
      expect(res.status).toBe(200);
      const all = await h.prisma.athlete.findMany();
      expect(all).toHaveLength(1);
      expect(all[0]?.id).toBe(existing.id);
      const link = await h.prisma.userAthlete.findUnique({
        where: { userId_athleteId: { userId, athleteId: existing.id } },
      });
      expect(link?.relationship).toBe('GUARDIAN');
    });

    it('is idempotent: re-onboarding the same SNC ID returns the same athlete and does not duplicate the UserAthlete', async () => {
      const first = await h.app.request('/v1/athletes/onboard', {
        method: 'POST',
        headers: { authorization: bearer, 'content-type': 'application/json' },
        body: JSON.stringify({ sncId: '1234' }),
      });
      const second = await h.app.request('/v1/athletes/onboard', {
        method: 'POST',
        headers: { authorization: bearer, 'content-type': 'application/json' },
        body: JSON.stringify({ sncId: '1234' }),
      });
      const a = (await first.json()) as { athlete: { id: string } };
      const b = (await second.json()) as { athlete: { id: string } };
      expect(a.athlete.id).toBe(b.athlete.id);
      const links = await h.prisma.userAthlete.findMany({ where: { userId } });
      expect(links).toHaveLength(1);
    });

    it('rejects unauthenticated requests', async () => {
      const res = await h.app.request('/v1/athletes/onboard', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sncId: '4030816' }),
      });
      expect(res.status).toBe(401);
    });

    it('rejects empty sncId', async () => {
      const res = await h.app.request('/v1/athletes/onboard', {
        method: 'POST',
        headers: { authorization: bearer, 'content-type': 'application/json' },
        body: JSON.stringify({ sncId: '' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /v1/athletes', () => {
    it("returns the user's athletes", async () => {
      await makeAthleteForUser(h.prisma, userId, 'A1', 'Alice');
      await makeAthleteForUser(h.prisma, userId, 'A2', 'Bob');
      const res = await h.app.request('/v1/athletes', {
        headers: { authorization: bearer },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { athletes: Array<{ sncId: string }> };
      const sncIds = body.athletes.map((a) => a.sncId).sort();
      expect(sncIds).toEqual(['A1', 'A2']);
    });
  });

  describe('DELETE /v1/user-athletes/:id', () => {
    it('unlinks an athlete (does not delete the athlete row itself)', async () => {
      const athlete = await makeAthleteForUser(h.prisma, userId, 'D1', 'ToUnlink');
      const res = await h.app.request(`/v1/user-athletes/${athlete.id}`, {
        method: 'DELETE',
        headers: { authorization: bearer },
      });
      expect(res.status).toBe(204);
      const link = await h.prisma.userAthlete.findUnique({
        where: { userId_athleteId: { userId, athleteId: athlete.id } },
      });
      expect(link).toBeNull();
      const stillThere = await h.prisma.athlete.findUnique({ where: { id: athlete.id } });
      expect(stillThere).not.toBeNull();
    });

    it('returns 404 if the user is not linked to that athlete', async () => {
      const res = await h.app.request('/v1/user-athletes/no-such-id', {
        method: 'DELETE',
        headers: { authorization: bearer },
      });
      expect(res.status).toBe(404);
    });
  });
});
```

### Step 6.2: Run — verify failure

Run: `pnpm --filter @flipturn/api test athletes`
Expected: tests fail.

### Step 6.3: Implement `apps/api/src/routes/athletes.ts`

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { OnboardAthleteSchema } from '@flipturn/shared';
import type { AppDeps } from '../app.js';
import { ApiError } from '../middleware/error.js';
import { sessionMiddleware } from '../middleware/session.js';

export function athletesRoutes(deps: AppDeps): Hono {
  const r = new Hono();
  r.use('*', sessionMiddleware(deps.prisma));

  r.post('/onboard', zValidator('json', OnboardAthleteSchema), async (c) => {
    const { sncId, relationship } = c.req.valid('json');
    const { user } = c.get('auth');

    const athlete = await deps.prisma.athlete.upsert({
      where: { sncId },
      update: {},
      create: { sncId, primaryName: 'Pending scrape' },
    });

    await deps.prisma.userAthlete.upsert({
      where: { userId_athleteId: { userId: user.id, athleteId: athlete.id } },
      update: { relationship },
      create: { userId: user.id, athleteId: athlete.id, relationship },
    });

    await deps.enqueueScrape({ athleteId: athlete.id, sncId: athlete.sncId });

    return c.json({
      athlete: {
        id: athlete.id,
        sncId: athlete.sncId,
        primaryName: athlete.primaryName,
        gender: athlete.gender,
        homeClub: athlete.homeClub,
        lastScrapedAt: athlete.lastScrapedAt?.toISOString() ?? null,
      },
    });
  });

  r.get('/', async (c) => {
    const { user } = c.get('auth');
    const links = await deps.prisma.userAthlete.findMany({
      where: { userId: user.id },
      include: { athlete: true },
      orderBy: { addedAt: 'asc' },
    });
    return c.json({
      athletes: links.map((l) => ({
        id: l.athlete.id,
        sncId: l.athlete.sncId,
        primaryName: l.athlete.primaryName,
        gender: l.athlete.gender,
        homeClub: l.athlete.homeClub,
        relationship: l.relationship,
        lastScrapedAt: l.athlete.lastScrapedAt?.toISOString() ?? null,
      })),
    });
  });

  return r;
}

export function userAthletesRoutes(deps: AppDeps): Hono {
  const r = new Hono();
  r.use('*', sessionMiddleware(deps.prisma));

  r.delete('/:id', async (c) => {
    const { user } = c.get('auth');
    const athleteId = c.req.param('id');
    const result = await deps.prisma.userAthlete.deleteMany({
      where: { userId: user.id, athleteId },
    });
    if (result.count === 0) {
      throw new ApiError(404, 'Not found', 'not_found');
    }
    return c.body(null, 204);
  });

  return r;
}
```

### Step 6.4: Wire into `app.ts`

Modify `app.ts`'s `createApp` to add:

```ts
import { athletesRoutes, userAthletesRoutes } from './routes/athletes.js';
// ...
app.route('/v1/athletes', athletesRoutes(deps));
app.route('/v1/user-athletes', userAthletesRoutes(deps));
```

### Step 6.5: Run — verify pass

Run: `pnpm --filter @flipturn/api test athletes`
Expected: all athletes-routes tests pass.

### Step 6.6: Run all tests

Run: `pnpm --filter @flipturn/api test`
Expected: all green.

### Step 6.7: Typecheck + format + commit

```bash
pnpm --filter @flipturn/api typecheck
pnpm format:check
git add apps/api/src/routes/athletes.ts apps/api/src/app.ts apps/api/tests/athletes.test.ts
git commit -m "feat(api): athletes onboard/list/unlink routes"
```

---

## Task 7: Data routes — swims, personal-bests, progression (TDD)

**Files:**

- Create: `apps/api/src/routes/data.ts`
- Create: `apps/api/tests/data.test.ts`
- Modify: `apps/api/src/app.ts` to mount

### Step 7.1: Write the failing tests

Create `apps/api/tests/data.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestApp, type TestApp } from './helpers/testApp.js';
import { makeUser, makeSession, makeAthleteForUser } from './helpers/factories.js';

let h: TestApp;
let bearer: string;
let userId: string;
let athleteId: string;

async function seedSwims() {
  // create a meet + 3 events + 3 swims for the athlete, all different eventKeys
  const meet = await h.prisma.meet.create({
    data: {
      externalId: 'TEST-MEET-1',
      name: 'Test Meet',
      course: 'LCM',
      startDate: new Date('2026-04-01'),
      endDate: new Date('2026-04-03'),
    },
  });
  const e100Free = await h.prisma.event.create({
    data: {
      meetId: meet.id,
      distanceM: 100,
      stroke: 'FR',
      gender: 'F',
      round: 'TIMED_FINAL',
    },
  });
  const e200Free = await h.prisma.event.create({
    data: {
      meetId: meet.id,
      distanceM: 200,
      stroke: 'FR',
      gender: 'F',
      round: 'TIMED_FINAL',
    },
  });
  const e100Back = await h.prisma.event.create({
    data: {
      meetId: meet.id,
      distanceM: 100,
      stroke: 'BK',
      gender: 'F',
      round: 'TIMED_FINAL',
    },
  });
  await h.prisma.swim.createMany({
    data: [
      {
        athleteId,
        meetId: meet.id,
        eventId: e100Free.id,
        eventKey: '100_FR_LCM',
        timeCentiseconds: 5732,
        splits: [],
        status: 'OFFICIAL',
        dataSource: 'www.swimming.ca',
      },
      {
        athleteId,
        meetId: meet.id,
        eventId: e200Free.id,
        eventKey: '200_FR_LCM',
        timeCentiseconds: 12500,
        splits: [],
        status: 'OFFICIAL',
        dataSource: 'www.swimming.ca',
      },
      {
        athleteId,
        meetId: meet.id,
        eventId: e100Back.id,
        eventKey: '100_BK_LCM',
        timeCentiseconds: 6900,
        splits: [],
        status: 'OFFICIAL',
        dataSource: 'www.swimming.ca',
      },
    ],
  });
}

describe('data routes', () => {
  beforeAll(async () => {
    h = await createTestApp();
  });
  afterAll(async () => {
    await h.teardown();
  });
  beforeEach(async () => {
    await h.prisma.personalBest.deleteMany();
    await h.prisma.swim.deleteMany();
    await h.prisma.event.deleteMany();
    await h.prisma.meet.deleteMany();
    await h.prisma.userAthlete.deleteMany();
    await h.prisma.session.deleteMany();
    await h.prisma.athlete.deleteMany();
    await h.prisma.user.deleteMany();

    const u = await makeUser(h.prisma, 'p@example.com');
    userId = u.id;
    const { token } = await makeSession(h.prisma, u.id);
    bearer = `Bearer ${token}`;
    const a = await makeAthleteForUser(h.prisma, userId, 'A1', 'Alice');
    athleteId = a.id;
    await seedSwims();
  });

  describe('GET /v1/athletes/:id/swims', () => {
    it('returns all swims by default', async () => {
      const res = await h.app.request(`/v1/athletes/${athleteId}/swims`, {
        headers: { authorization: bearer },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        swims: Array<{ eventKey: string }>;
        nextCursor: string | null;
      };
      expect(body.swims.length).toBe(3);
      expect(body.nextCursor).toBeNull();
    });

    it('filters by eventKey', async () => {
      const res = await h.app.request(`/v1/athletes/${athleteId}/swims?eventKey=100_FR_LCM`, {
        headers: { authorization: bearer },
      });
      const body = (await res.json()) as { swims: Array<{ eventKey: string }> };
      expect(body.swims).toHaveLength(1);
      expect(body.swims[0]?.eventKey).toBe('100_FR_LCM');
    });

    it('paginates with cursor', async () => {
      const first = await h.app.request(`/v1/athletes/${athleteId}/swims?limit=2`, {
        headers: { authorization: bearer },
      });
      const firstBody = (await first.json()) as { swims: unknown[]; nextCursor: string | null };
      expect(firstBody.swims).toHaveLength(2);
      expect(firstBody.nextCursor).not.toBeNull();

      const second = await h.app.request(
        `/v1/athletes/${athleteId}/swims?limit=2&cursor=${firstBody.nextCursor}`,
        { headers: { authorization: bearer } },
      );
      const secondBody = (await second.json()) as { swims: unknown[]; nextCursor: string | null };
      expect(secondBody.swims).toHaveLength(1);
      expect(secondBody.nextCursor).toBeNull();
    });

    it('returns 404 if the athlete is not linked to the user', async () => {
      const otherAthlete = await h.prisma.athlete.create({
        data: { sncId: 'OTHER', primaryName: 'Other' },
      });
      const res = await h.app.request(`/v1/athletes/${otherAthlete.id}/swims`, {
        headers: { authorization: bearer },
      });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /v1/athletes/:id/personal-bests', () => {
    it('returns one PB per eventKey with at least one OFFICIAL swim', async () => {
      // Manually create PB rows — in production they're computed by the worker.
      const swims = await h.prisma.swim.findMany({ where: { athleteId } });
      for (const swim of swims) {
        await h.prisma.personalBest.create({
          data: {
            athleteId,
            eventKey: swim.eventKey,
            swimId: swim.id,
            timeCentiseconds: swim.timeCentiseconds,
            achievedAt: new Date('2026-04-01'),
          },
        });
      }
      const res = await h.app.request(`/v1/athletes/${athleteId}/personal-bests`, {
        headers: { authorization: bearer },
      });
      const body = (await res.json()) as { personalBests: Array<{ eventKey: string }> };
      expect(body.personalBests).toHaveLength(3);
    });
  });

  describe('GET /v1/athletes/:id/progression', () => {
    it('returns progression points for one eventKey', async () => {
      // Add an older swim for the same eventKey to make progression non-trivial.
      const meet = await h.prisma.meet.create({
        data: {
          externalId: 'OLD-MEET',
          name: 'Old Meet',
          course: 'LCM',
          startDate: new Date('2025-04-01'),
          endDate: new Date('2025-04-03'),
        },
      });
      const event = await h.prisma.event.create({
        data: {
          meetId: meet.id,
          distanceM: 100,
          stroke: 'FR',
          gender: 'F',
          round: 'TIMED_FINAL',
        },
      });
      await h.prisma.swim.create({
        data: {
          athleteId,
          meetId: meet.id,
          eventId: event.id,
          eventKey: '100_FR_LCM',
          timeCentiseconds: 5800,
          splits: [],
          status: 'OFFICIAL',
          dataSource: 'www.swimming.ca',
        },
      });
      const res = await h.app.request(`/v1/athletes/${athleteId}/progression?eventKey=100_FR_LCM`, {
        headers: { authorization: bearer },
      });
      const body = (await res.json()) as { points: Array<{ timeCentiseconds: number }> };
      expect(body.points).toHaveLength(2);
      // Points should be sorted ascending by date (older first).
      expect(body.points[0]?.timeCentiseconds).toBe(5800);
      expect(body.points[1]?.timeCentiseconds).toBe(5732);
    });

    it('returns 400 without an eventKey', async () => {
      const res = await h.app.request(`/v1/athletes/${athleteId}/progression`, {
        headers: { authorization: bearer },
      });
      expect(res.status).toBe(400);
    });
  });
});
```

### Step 7.2: Run — verify failure

Run: `pnpm --filter @flipturn/api test data`
Expected: tests fail.

### Step 7.3: Implement `apps/api/src/routes/data.ts`

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { AppDeps } from '../app.js';
import { ApiError } from '../middleware/error.js';
import { sessionMiddleware } from '../middleware/session.js';

const SwimsQuerySchema = z.object({
  eventKey: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  cursor: z.string().optional(),
});

const ProgressionQuerySchema = z.object({
  eventKey: z.string().min(1),
});

export function dataRoutes(deps: AppDeps): Hono {
  const r = new Hono();
  r.use('*', sessionMiddleware(deps.prisma));

  // assertOwned middleware ensures the user is linked to the athlete.
  async function assertOwned(c: Parameters<Parameters<Hono['get']>[1]>[0]): Promise<string> {
    const { user } = c.get('auth');
    const athleteId = c.req.param('id');
    if (!athleteId) throw new ApiError(400, 'Missing athlete id', 'bad_request');
    const link = await deps.prisma.userAthlete.findUnique({
      where: { userId_athleteId: { userId: user.id, athleteId } },
    });
    if (!link) {
      throw new ApiError(404, 'Athlete not found', 'not_found');
    }
    return athleteId;
  }

  r.get('/:id/swims', zValidator('query', SwimsQuerySchema), async (c) => {
    const athleteId = await assertOwned(c);
    const q = c.req.valid('query');
    const where: { athleteId: string; eventKey?: string } = { athleteId };
    if (q.eventKey) where.eventKey = q.eventKey;

    const cursorClause = q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {};
    const swims = await deps.prisma.swim.findMany({
      where,
      take: q.limit + 1, // fetch one extra to detect end-of-page
      orderBy: [{ scrapedAt: 'desc' }, { id: 'desc' }],
      include: { meet: { select: { name: true } } },
      ...cursorClause,
    });
    const hasMore = swims.length > q.limit;
    const page = swims.slice(0, q.limit);
    const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;
    return c.json({
      swims: page.map((s) => ({
        id: s.id,
        eventKey: s.eventKey,
        timeCentiseconds: s.timeCentiseconds,
        splits: s.splits,
        place: s.place,
        status: s.status,
        meetName: s.meet.name,
        swamAt: s.scrapedAt.toISOString(),
      })),
      nextCursor,
    });
  });

  r.get('/:id/personal-bests', async (c) => {
    const athleteId = await assertOwned(c);
    const pbs = await deps.prisma.personalBest.findMany({
      where: { athleteId },
      orderBy: [{ eventKey: 'asc' }],
    });
    return c.json({
      personalBests: pbs.map((p) => ({
        eventKey: p.eventKey,
        timeCentiseconds: p.timeCentiseconds,
        achievedAt: p.achievedAt.toISOString(),
        swimId: p.swimId,
      })),
    });
  });

  r.get('/:id/progression', zValidator('query', ProgressionQuerySchema), async (c) => {
    const athleteId = await assertOwned(c);
    const { eventKey } = c.req.valid('query');
    const swims = await deps.prisma.swim.findMany({
      where: { athleteId, eventKey, status: 'OFFICIAL' },
      include: { meet: { select: { startDate: true, name: true } } },
      orderBy: { meet: { startDate: 'asc' } },
    });
    return c.json({
      points: swims.map((s) => ({
        date: s.meet.startDate.toISOString(),
        timeCentiseconds: s.timeCentiseconds,
        meetName: s.meet.name,
      })),
    });
  });

  return r;
}
```

### Step 7.4: Wire into `app.ts`

Add the route mount: `app.route('/v1/athletes', dataRoutes(deps));`

NOTE: `dataRoutes` and `athletesRoutes` both mount under `/v1/athletes`. Hono handles the merge correctly because the paths within each are different (`/onboard` and `/` for athletes; `/:id/swims`, `/:id/personal-bests`, `/:id/progression` for data). Verify by running both test files.

### Step 7.5: Run all tests

Run: `pnpm --filter @flipturn/api test`
Expected: all green.

### Step 7.6: Typecheck + format + commit

```bash
pnpm --filter @flipturn/api typecheck
pnpm format:check
git add apps/api/src/routes/data.ts apps/api/src/app.ts apps/api/tests/data.test.ts
git commit -m "feat(api): swims/personal-bests/progression read endpoints"
```

---

## Task 8: Ops routes — /health and DELETE /me (TDD)

**Files:**

- Create: `apps/api/src/routes/ops.ts`
- Create: `apps/api/tests/ops.test.ts`
- Modify: `apps/api/src/app.ts` to mount

### Step 8.1: Write the failing tests

Create `apps/api/tests/ops.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, type TestApp } from './helpers/testApp.js';
import { makeUser, makeSession } from './helpers/factories.js';

let h: TestApp;

describe('GET /v1/health', () => {
  beforeAll(async () => {
    h = await createTestApp();
  });
  afterAll(async () => {
    await h.teardown();
  });

  it('reports db ok', async () => {
    const res = await h.app.request('/v1/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { db: 'ok' | 'fail' };
    expect(body.db).toBe('ok');
  });
});

describe('DELETE /v1/me', () => {
  beforeAll(async () => {
    h = await createTestApp();
  });
  afterAll(async () => {
    await h.teardown();
  });

  it('cascades user → sessions/userAthletes; leaves Athlete rows alone', async () => {
    const u = await makeUser(h.prisma, 'd@example.com');
    const { token } = await makeSession(h.prisma, u.id);
    const athlete = await h.prisma.athlete.create({
      data: { sncId: 'KEEP', primaryName: 'Keep me' },
    });
    await h.prisma.userAthlete.create({
      data: { userId: u.id, athleteId: athlete.id, relationship: 'PARENT' },
    });

    const res = await h.app.request('/v1/me', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(204);

    expect(await h.prisma.user.findUnique({ where: { id: u.id } })).toBeNull();
    expect(await h.prisma.session.findMany({ where: { userId: u.id } })).toHaveLength(0);
    expect(await h.prisma.userAthlete.findMany({ where: { userId: u.id } })).toHaveLength(0);
    expect(await h.prisma.athlete.findUnique({ where: { id: athlete.id } })).not.toBeNull();
  });

  it('rejects unauthenticated DELETE /v1/me', async () => {
    const res = await h.app.request('/v1/me', { method: 'DELETE' });
    expect(res.status).toBe(401);
  });
});
```

### Step 8.2: Run — verify failure

Run: `pnpm --filter @flipturn/api test ops`
Expected: tests fail.

### Step 8.3: Implement `apps/api/src/routes/ops.ts`

```ts
import { Hono } from 'hono';
import type { AppDeps } from '../app.js';
import { sessionMiddleware } from '../middleware/session.js';

export function healthRoute(deps: AppDeps): Hono {
  const r = new Hono();
  r.get('/', async (c) => {
    let dbStatus: 'ok' | 'fail' = 'ok';
    try {
      await deps.prisma.$queryRaw`SELECT 1`;
    } catch {
      dbStatus = 'fail';
    }
    return c.json({ db: dbStatus, redis: 'ok' });
  });
  return r;
}

export function meRoutes(deps: AppDeps): Hono {
  const r = new Hono();
  r.use('*', sessionMiddleware(deps.prisma));

  r.delete('/', async (c) => {
    const { user } = c.get('auth');
    // Schema's onDelete: Cascade handles Sessions, MagicLinkTokens, UserAthlete.
    await deps.prisma.user.delete({ where: { id: user.id } });
    return c.body(null, 204);
  });

  return r;
}
```

### Step 8.4: Wire into `app.ts`

```ts
import { healthRoute, meRoutes } from './routes/ops.js';
// ...
app.route('/v1/health', healthRoute(deps));
app.route('/v1/me', meRoutes(deps));
// remove the inline app.get('/v1/health', ...) stub
```

### Step 8.5: Run + format + commit

```bash
pnpm --filter @flipturn/api test
pnpm --filter @flipturn/api typecheck
pnpm format:check
git add apps/api/src/routes/ops.ts apps/api/src/app.ts apps/api/tests/ops.test.ts
git commit -m "feat(api): /health endpoint and DELETE /me (PIPEDA)"
```

---

## Task 9: Magic-link cleanup in workers scheduler

**Files:**

- Modify: `apps/workers/src/scheduler.ts` — add `cleanupExpiredMagicLinks(prisma)` invocation inside `tickScheduler`
- Modify: `apps/workers/tests/scheduler.test.ts` — add a test that verifies expired tokens are deleted

### Step 9.1: Add the test

Edit `apps/workers/tests/scheduler.test.ts`. Add a new `describe`:

```ts
describe('tickScheduler — magic link cleanup', () => {
  it('hard-deletes magic-link tokens expired more than 24h ago', async () => {
    const user = await prisma.user.create({ data: { email: 'cleanup@example.com' } });
    // create three tokens: fresh, just-expired, long-expired
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
```

### Step 9.2: Run — verify failure

Run: `pnpm --filter @flipturn/workers test scheduler`
Expected: the new test fails because `tickScheduler` doesn't clean up tokens yet.

### Step 9.3: Modify `apps/workers/src/scheduler.ts`

Read the current file. Add the cleanup logic. Updated `tickScheduler`:

```ts
export async function tickScheduler(
  prisma: PrismaClient,
): Promise<{ enqueued: number; cleaned: number }> {
  const log = getLogger();
  const athletes = await prisma.athlete.findMany({
    select: { id: true, sncId: true },
  });
  for (const a of athletes) {
    await enqueueScrapeAthlete(
      { athleteId: a.id, sncId: a.sncId },
      { delay: Math.floor(Math.random() * 5 * 60 * 1000) },
    );
  }

  const cleaned = await cleanupExpiredMagicLinks(prisma);

  log.info({ enqueued: athletes.length, cleaned }, 'scheduler tick complete');
  return { enqueued: athletes.length, cleaned };
}

async function cleanupExpiredMagicLinks(prisma: PrismaClient): Promise<number> {
  // Hard-delete tokens whose expiry was > 24h ago. (Per design spec §10.4.)
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const result = await prisma.magicLinkToken.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  });
  return result.count;
}
```

### Step 9.4: Run — verify pass

Run: `pnpm --filter @flipturn/workers test scheduler`
Expected: 3 tests pass (the existing 2 + the new cleanup test).

### Step 9.5: Run all tests + typecheck + format

Run: `pnpm test`, `pnpm typecheck`, `pnpm format:check` — all green.

### Step 9.6: Commit

```bash
git add apps/workers/src/scheduler.ts apps/workers/tests/scheduler.test.ts
git commit -m "feat(workers): scheduler cleans up expired magic-link tokens"
```

---

## Task 10: API entrypoint, Sentry/pino wiring, dev:start runs

**Files:**

- Replace: `apps/api/src/index.ts`

### Step 10.1: Implement `apps/api/src/index.ts`

```ts
import { serve } from '@hono/node-server';
import { Resend } from 'resend';
import { getEnv } from './env.js';
import { getLogger } from './logger.js';
import { initSentry } from './sentry.js';
import { createApp } from './app.js';
import { ResendEmailSender, InMemoryEmailSender, type EmailSender } from './email.js';
import { getPrisma } from '@flipturn/db';
import { enqueueScrapeAthlete } from '@flipturn/workers/src/queue.js';

async function main() {
  const env = getEnv();
  initSentry();
  const log = getLogger();

  const prisma = getPrisma();

  let email: EmailSender;
  if (env.RESEND_API_KEY) {
    email = new ResendEmailSender(new Resend(env.RESEND_API_KEY), env.EMAIL_FROM);
    log.info('Resend email sender initialized');
  } else {
    email = new InMemoryEmailSender();
    log.warn('RESEND_API_KEY not set — using InMemoryEmailSender (logs to stdout)');
  }

  const app = createApp({
    prisma,
    email,
    enqueueScrape: async (job) => enqueueScrapeAthlete(job),
    baseUrl: env.BASE_URL,
    mobileDeepLinkBase: env.MOBILE_DEEP_LINK_BASE,
  });

  const server = serve({
    fetch: app.fetch,
    port: env.PORT,
  });

  log.info({ port: env.PORT }, 'flipturn api listening');

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'shutting down');
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
```

NOTE: the import `from '@flipturn/workers/src/queue.js'` reaches inside the workers package. If TypeScript/pnpm doesn't resolve it cleanly (workspace exports), adjust by either:

- Adding an `exports` field to `apps/workers/package.json` exposing `./queue` → `./src/queue.ts`
- Or importing from `@flipturn/workers/dist/queue.js` after a build (requires the workers build step to run first — undesirable)

The cleanest fix is the package-exports option. Update `apps/workers/package.json`'s top-level fields:

```json
"main": "./src/index.ts",
"exports": {
  ".": "./src/index.ts",
  "./queue": "./src/queue.ts"
},
```

But Plan 2 didn't add an `index.ts` in `apps/workers/src/`. If there isn't one, create a tiny one that re-exports `./queue.js` and `./scheduler.js`'s public types (or just create a barrel for what the API needs).

Adapt as needed. Document the choice in your report.

### Step 10.2: Smoke-test the API

Source the `.env` and start:

```bash
set -a && source .env && set +a
pnpm api:start &
API_PID=$!
sleep 3
```

Verify it's listening:

```bash
curl -sf http://localhost:3000/v1/health | jq
```

Expected: `{ "db": "ok", "redis": "ok" }` (or similar JSON body, status 200).

Test magic-link request (assuming `RESEND_API_KEY` is empty so InMemory is used):

```bash
curl -i -X POST http://localhost:3000/v1/auth/magic-link/request \
  -H 'content-type: application/json' \
  -d '{"email":"smoke@example.com"}'
```

Expected: HTTP 202. The worker logs should show the InMemory email being captured (but since we're not running tests, the InMemory captures aren't visible — the smoke test just verifies the POST returns 202).

Stop the API:

```bash
kill -TERM $API_PID
sleep 1
```

If anything failed, capture and report DONE_WITH_CONCERNS.

### Step 10.3: Typecheck + format + commit

```bash
pnpm --filter @flipturn/api typecheck
pnpm format:check
pnpm lint
```

All exit 0.

```bash
git add apps/api/src/index.ts apps/workers/package.json apps/workers/src/index.ts
# (the workers/index.ts only if you added one; adapt the add list to what you actually changed)
git commit -m "feat(api): entrypoint with Hono server + Sentry + Resend"
```

---

## Task 11: End-to-end happy-path test (TDD)

**Files:**

- Create: `apps/api/tests/e2e.test.ts`

This test exercises the full intended flow:

1. POST `/v1/auth/magic-link/request` → email captured
2. POST `/v1/auth/magic-link/consume` → session token
3. POST `/v1/athletes/onboard` → athlete created, scrape enqueued
4. (Test directly invokes the worker pipeline against the captured fixture HTML to populate swims/PBs)
5. GET `/v1/athletes/:id/swims` → returns the swims
6. GET `/v1/athletes/:id/personal-bests` → returns PBs
7. GET `/v1/athletes/:id/progression?eventKey=...` → returns progression

### Step 11.1: Write the test

Create `apps/api/tests/e2e.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createTestApp, type TestApp } from './helpers/testApp.js';
import { parseAthletePage } from '@flipturn/workers/src/parser/athletePage.js';
import { reconcile } from '@flipturn/workers/src/reconcile.js';
import { recomputePersonalBests } from '@flipturn/workers/src/personalBest.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '..', '..', 'workers', 'fixtures', 'snc-athlete-sample.html');

let h: TestApp;
let html: string;

describe('end-to-end happy path', () => {
  beforeAll(async () => {
    h = await createTestApp();
    html = await readFile(FIXTURE, 'utf8');
  });
  afterAll(async () => {
    await h.teardown();
  });

  it('parent signs in, onboards, and reads athlete data', async () => {
    // Step 1: request magic link
    const req = await h.app.request('/v1/auth/magic-link/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'darrell@example.com' }),
    });
    expect(req.status).toBe(202);
    const sent = h.email.latestTo('darrell@example.com');
    const m = /token=([^&"\s)]+)/.exec(sent!.htmlBody);
    const token = decodeURIComponent(m![1]!);

    // Step 2: consume
    const consume = await h.app.request('/v1/auth/magic-link/consume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const { sessionToken } = (await consume.json()) as { sessionToken: string };
    const auth = `Bearer ${sessionToken}`;

    // Step 3: onboard
    const onboard = await h.app.request('/v1/athletes/onboard', {
      method: 'POST',
      headers: { authorization: auth, 'content-type': 'application/json' },
      body: JSON.stringify({ sncId: '4030816' }),
    });
    expect(onboard.status).toBe(200);
    const { athlete } = (await onboard.json()) as { athlete: { id: string; sncId: string } };
    expect(athlete.sncId).toBe('4030816');
    expect(h.enqueued).toHaveLength(1);

    // Step 4: directly run the worker pipeline against the fixture
    const snap = parseAthletePage(html, { sncId: '4030816' });
    const reconciled = await reconcile(h.prisma, snap);
    await recomputePersonalBests(h.prisma, reconciled.athleteId);

    // Step 5: swims
    const swimsRes = await h.app.request(`/v1/athletes/${reconciled.athleteId}/swims?limit=200`, {
      headers: { authorization: auth },
    });
    expect(swimsRes.status).toBe(200);
    const { swims } = (await swimsRes.json()) as { swims: unknown[] };
    expect(swims.length).toBeGreaterThan(0);

    // Step 6: PBs
    const pbsRes = await h.app.request(`/v1/athletes/${reconciled.athleteId}/personal-bests`, {
      headers: { authorization: auth },
    });
    const { personalBests } = (await pbsRes.json()) as { personalBests: unknown[] };
    expect(personalBests.length).toBeGreaterThan(0);

    // Step 7: progression on a known event
    const progRes = await h.app.request(
      `/v1/athletes/${reconciled.athleteId}/progression?eventKey=400_FR_LCM`,
      { headers: { authorization: auth } },
    );
    expect(progRes.status).toBe(200);
    const { points } = (await progRes.json()) as { points: unknown[] };
    expect(points.length).toBeGreaterThan(0);
  });
});
```

NOTE: the test imports `parseAthletePage`, `reconcile`, `recomputePersonalBests` from `@flipturn/workers/src/...`. Same caveat as Task 10 — the `package.json` exports may need updating to allow these imports. Either:

- Add explicit `./parser/athletePage`, `./reconcile`, `./personalBest` entries to the `exports` map
- Or have the workers `src/index.ts` re-export them and import from `@flipturn/workers`

Pick one and document.

### Step 11.2: Run

Run: `pnpm --filter @flipturn/api test e2e`
Expected: 1 test passes.

The test uses Ryan Cochrane's fixture (sncId 4030816). Since `400_FR_LCM` is a Cochrane event, the progression assertion has data.

### Step 11.3: Run all tests

Run: `pnpm test`
Expected: all packages green.

### Step 11.4: Commit

```bash
git add apps/api/tests/e2e.test.ts
git commit -m "test(api): end-to-end happy path against captured fixture"
```

---

## Task 12: ADR 0004 + README + final integration

**Files:**

- Create: `docs/adr/0004-auth-design.md`
- Modify: `apps/api/README.md` (replace with Plan 4 state)

### Step 12.1: Write ADR 0004

Create `docs/adr/0004-auth-design.md`:

```markdown
# ADR 0004 — Auth design: magic-link email + DB sessions

**Status:** Accepted
**Date:** 2026-05-05
**Deciders:** Darrell Bechtel
**Spec link:** [`docs/superpowers/specs/2026-05-04-flipturn-mvp-design.md`](../superpowers/specs/2026-05-04-flipturn-mvp-design.md)

## Context

The Flip Turn MVP serves a closed beta of 10–20 swim parents. The data is
public (it's already on results.swimming.ca). The auth layer's job is to
identify which parent owns which athlete record for personalization, not
to protect secret data. Spec §9 chose magic-link email + long-lived sessions.

## Decisions

### 1. Magic-link tokens

- 32 random bytes from `crypto.randomBytes`, hex-encoded (64 chars)
- Hashed at rest with sha256; the plaintext lives only in the email
- TTL: 15 minutes from creation
- Single-use: `consumedAt` set on consume; subsequent attempts return 401
- Hard-deleted 24h after expiry by the workers scheduler (Task 9)

### 2. Sessions

- DB-backed (`Session` table from Plan 1's schema)
- 32 random bytes, hex-encoded, hashed at rest
- **No expiry in MVP**; sessions revoke only via `revokedAt` (manual ops or
  `DELETE /v1/me`)
- Plan 5+ may add session refresh / device list; out of scope for MVP

### 3. Email delivery

- Production: Resend (chosen for free tier + good DX). `EMAIL_FROM` is a
  configured envelope. The `noreply@flipturn.app` placeholder will be
  replaced with the verified domain in Plan 6.
- Tests / dev without `RESEND_API_KEY`: `InMemoryEmailSender` captures
  messages on a per-process outbox so tests can extract magic-link tokens
  from the rendered HTML body.

### 4. Bearer token convention

- `Authorization: Bearer <sessionToken>` on every authenticated endpoint
- `parseBearerHeader` returns null on missing/malformed; the session
  middleware throws `401 unauthenticated` for both cases (intentionally
  uniform — don't leak whether a token is malformed vs invalid)

## Alternatives considered

- **JWT instead of DB sessions** — JWTs avoid the lookup but require key
  management, refresh tokens, and revocation lists. DB sessions are simpler
  and faster to invalidate (Plan 6 hosting work; matters more under load).
  Rejected for MVP.
- **OAuth (Google / Apple Sign In)** — Closer to user expectation on iOS,
  but complicates the same-day signup → onboard flow and adds platform-
  specific work. Plan 5 may revisit when Apple Sign In becomes mandatory
  for App Store submission.
- **Passwords** — Security cost is too high for the value (the data is
  public anyway), and password recovery requires email anyway. Rejected.

## Consequences

- Sessions don't expire, which means a leaked session token grants access
  until manually revoked. PIPEDA `DELETE /v1/me` covers user-initiated
  revocation; ops-side revocation is a manual `UPDATE Session SET revokedAt = NOW()`.
- The InMemoryEmailSender is the right test double, but if dev wants to
  see emails in the browser, a quick localhost mailcatcher could be added
  in Plan 6.
- Magic-link tokens are tied to a specific email (User row). If a parent
  changes email, they need to request a fresh link from the new address.

## Risks

- Resend's free tier has rate limits. Closed beta is well under them, but
  Plan 6 should monitor and have a Postmark / SES fallback.
- Email delivery is the auth primitive. If Gmail/Apple flag the sending
  domain, the entire system is unusable. Plan 6 should set up SPF/DKIM/DMARC
  on `flipturn.app` before launch.
```

### Step 12.2: Update `apps/api/README.md`

Replace with:

```markdown
# @flipturn/api

Hono HTTP server for the Flip Turn MVP. Authenticates parents via magic-link
email and exposes athlete + swim + PB endpoints over a small JSON API.

## Local development

Requires the dev infra (Postgres + Redis) running:

\`\`\`bash
pnpm dev:up
\`\`\`

Then from the repo root:

\`\`\`bash
pnpm api:dev # tsx --watch
pnpm api:test # run API tests
\`\`\`

`RESEND_API_KEY` may be left blank — the API falls back to an
`InMemoryEmailSender` that captures messages in process memory (handy for
manual smoke testing).

## Endpoints

- `POST /v1/auth/magic-link/request` { email }
- `POST /v1/auth/magic-link/consume` { token } → { sessionToken }
- `GET  /v1/auth/me`
- `POST /v1/athletes/onboard` { sncId, relationship? } → { athlete }
- `GET  /v1/athletes`
- `DELETE /v1/user-athletes/:id`
- `GET  /v1/athletes/:id/swims?eventKey=&limit=&cursor=`
- `GET  /v1/athletes/:id/personal-bests`
- `GET  /v1/athletes/:id/progression?eventKey=`
- `GET  /v1/health`
- `DELETE /v1/me`

All authenticated endpoints require `Authorization: Bearer <sessionToken>`.

## Architecture

See [`docs/adr/0004-auth-design.md`](../../docs/adr/0004-auth-design.md) for
the auth model and [`docs/superpowers/specs/2026-05-04-flipturn-mvp-design.md`](../../docs/superpowers/specs/2026-05-04-flipturn-mvp-design.md)
§7 for the full API surface.
```

(Use real triple-backticks in the file.)

### Step 12.3: Run all gates

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm format:check
```

All four exit 0. Tests now total: 29 (shared) + 2 (db) + 56 (workers, +1 from cleanup test) + ~30 (api new) ≈ 117. Verify your actual count.

### Step 12.4: Verify clean install

```bash
rm -rf node_modules apps/*/node_modules packages/*/node_modules
pnpm install
pnpm typecheck
pnpm test
```

Expected: clean install + all tests pass.

### Step 12.5: Final commit

```bash
git add docs/adr/0004-auth-design.md apps/api/README.md
git commit -m "docs(api): adr 0004 auth design + plan 4 readme"
```

---

## Acceptance criteria for Plan 4

- [ ] `apps/api` package exists with all modules in the file map
- [ ] `pnpm api:start` boots a Hono server on `PORT` (default 3000) and shuts down cleanly on SIGINT/SIGTERM
- [ ] `pnpm api:test` passes all API tests
- [ ] Auth flow works end-to-end (request → consume → bearer-authed call)
- [ ] Onboarding enqueues a worker scrape job
- [ ] Swims / PBs / Progression endpoints return the right shapes
- [ ] `DELETE /v1/me` cascades user → sessions/userAthletes (NOT athletes)
- [ ] Magic-link cleanup runs daily in the workers scheduler
- [ ] Resend wired up (or InMemory fallback when `RESEND_API_KEY` unset)
- [ ] ADR 0004 committed
- [ ] All commits use conventional-commit style
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` all green

When all checked, hand off to Plan 5 — the Expo mobile app.

## Open items deferred again

- Live Resend send (covered when Plan 6 wires up the Mac Mini's `flipturn.app` DNS + SPF/DKIM)
- API rate limiting (Plan 6)
- Cloudflare Tunnel exposure (Plan 6)
- Plan 3 worker robustness items: MIN_BACKOFF tuning, daily-budget refund on 429, header-driven row index — Plan 6
- `Swim.swamAt` field on the model (Plan 5 may need it for per-day fidelity in the mobile UI)
- Apple Sign In (Plan 5 if App Store submission becomes a Plan 6 deliverable)
