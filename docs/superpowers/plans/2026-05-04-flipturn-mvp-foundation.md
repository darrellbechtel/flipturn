# Flip Turn MVP — Foundation Plan (Plan 1 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Plan series:** This is plan 1 of 5 derived from [`docs/superpowers/specs/2026-05-04-flipturn-mvp-design.md`](../specs/2026-05-04-flipturn-mvp-design.md). Subsequent plans:

- Plan 2 — Spike + Workers (Tier-4 scrape pipeline end-to-end)
- Plan 3 — API (Hono + magic-link auth + endpoints)
- Plan 4 — Mobile (Expo + auth + onboarding + screens)
- Plan 5 — Hosting + Closed-beta launch

**Goal:** Stand up the pnpm monorepo with `packages/db` (full Prisma schema + first migration) and `packages/shared` (time formatting, eventKey builder, zod schemas), all green under `pnpm test` and `pnpm typecheck`.

**Architecture:** pnpm workspace at the repo root. `packages/db` owns the Prisma schema and exports a typed `PrismaClient`. `packages/shared` owns format/parse helpers and zod request/response schemas. Local Postgres + Redis run via `compose.dev.yaml`. No app code yet — that's plans 2–5.

**Tech Stack:** TypeScript 5.6+, pnpm 9, Node 22 (LTS), Prisma 5.x, Postgres 16, Redis 7, Vitest, ESLint 9 (flat config), Prettier 3, zod 3.

**Recommended execution:** Use `superpowers:subagent-driven-development` with `model: "opus"` per the project's preference (see `~/.claude/projects/-Users-darrell-Documents-ai-projects-flipturn/memory/feedback_use_opus_agents.md`).

---

## File map (created by this plan)

```
flipturn/
├── .editorconfig                          (CREATE)
├── .env.example                           (CREATE)
├── .nvmrc                                 (CREATE)
├── .prettierrc                            (CREATE)
├── compose.dev.yaml                       (CREATE)
├── eslint.config.js                       (CREATE)
├── package.json                           (CREATE)
├── pnpm-workspace.yaml                    (CREATE)
├── README.md                              (CREATE)
├── tsconfig.base.json                     (CREATE)
├── docs/adr/
│   └── 0001-mvp-hosting.md                (CREATE)
├── packages/db/
│   ├── package.json                       (CREATE)
│   ├── tsconfig.json                      (CREATE)
│   ├── prisma/
│   │   ├── schema.prisma                  (CREATE)
│   │   └── migrations/                    (auto-created by prisma migrate)
│   ├── src/
│   │   ├── index.ts                       (CREATE)
│   │   └── seed.ts                        (CREATE)
│   └── tests/
│       └── migrations.test.ts             (CREATE)
└── packages/shared/
    ├── package.json                       (CREATE)
    ├── tsconfig.json                      (CREATE)
    ├── vitest.config.ts                   (CREATE)
    ├── src/
    │   ├── index.ts                       (CREATE)
    │   ├── time.ts                        (CREATE)
    │   ├── eventKey.ts                    (CREATE)
    │   ├── enums.ts                       (CREATE)
    │   └── schemas.ts                     (CREATE)
    └── tests/
        ├── time.test.ts                   (CREATE)
        ├── eventKey.test.ts               (CREATE)
        └── schemas.test.ts                (CREATE)
```

---

## Task 1: Monorepo root scaffolding

**Files:**

- Create: `.nvmrc`
- Create: `.editorconfig`
- Create: `.prettierrc`
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `eslint.config.js`
- Create: `README.md`

- [ ] **Step 1.1: Pin Node version**

Create `.nvmrc`:

```
22
```

- [ ] **Step 1.2: Create .editorconfig**

Create `.editorconfig`:

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
```

- [ ] **Step 1.3: Create .prettierrc**

Create `.prettierrc`:

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "arrowParens": "always"
}
```

- [ ] **Step 1.4: Create root package.json**

Create `package.json`:

```json
{
  "name": "flipturn",
  "version": "0.0.0",
  "private": true,
  "packageManager": "pnpm@9.12.0",
  "engines": {
    "node": ">=22.0.0"
  },
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "db:generate": "pnpm --filter @flipturn/db generate",
    "db:migrate": "pnpm --filter @flipturn/db migrate",
    "db:seed": "pnpm --filter @flipturn/db seed",
    "db:reset": "pnpm --filter @flipturn/db reset",
    "dev:up": "docker compose -f compose.dev.yaml up -d",
    "dev:down": "docker compose -f compose.dev.yaml down",
    "dev:logs": "docker compose -f compose.dev.yaml logs -f"
  },
  "devDependencies": {
    "@types/node": "^22.7.0",
    "eslint": "^9.12.0",
    "prettier": "^3.3.3",
    "typescript": "^5.6.3",
    "typescript-eslint": "^8.8.0"
  }
}
```

- [ ] **Step 1.5: Create pnpm-workspace.yaml**

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

- [ ] **Step 1.6: Create tsconfig.base.json**

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": false,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 1.7: Create eslint.config.js**

Create `eslint.config.js`:

```js
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.expo/**',
      '**/.next/**',
      '**/data/**',
      '**/prisma/migrations/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);
```

- [ ] **Step 1.8: Create README.md placeholder**

Create `README.md`:

```markdown
# Flip Turn

A B2C mobile app for Canadian competitive swim parents.

See [`PROJECT_BRIEF.md`](./PROJECT_BRIEF.md) for strategic context and
[`docs/superpowers/specs/`](./docs/superpowers/specs/) for current design specs.

## Development

Requires:

- Node 22+ (`nvm use`)
- pnpm 9+ (`corepack enable && corepack prepare pnpm@9.12.0 --activate`)
- Docker (for local Postgres + Redis)

Bootstrap:

\`\`\`bash
pnpm install
pnpm dev:up # start postgres + redis in docker
pnpm db:migrate # apply Prisma migrations
pnpm db:seed # seed demo data
pnpm test # run all tests
\`\`\`
```

(Note: keep the backticks escaped in the source so this plan renders cleanly; the engineer will write actual unescaped triple-backticks in the file.)

- [ ] **Step 1.9: Install root dependencies**

Run: `pnpm install`
Expected: pnpm installs 0 workspace deps + the root devDependencies; creates `pnpm-lock.yaml` and `node_modules/`.

- [ ] **Step 1.10: Verify lint config works on an empty repo**

Run: `pnpm lint`
Expected: no files matched (passes silently because no `.ts` files yet) OR exit 0. If it errors due to no input, that's fine — it's just verifying the config parses.

- [ ] **Step 1.11: Commit**

```bash
git add .nvmrc .editorconfig .prettierrc package.json pnpm-workspace.yaml tsconfig.base.json eslint.config.js README.md pnpm-lock.yaml
git commit -m "chore: scaffold monorepo root (pnpm workspace, ts/eslint/prettier)"
```

---

## Task 2: Local infra via docker compose

**Files:**

- Create: `compose.dev.yaml`
- Create: `.env.example`

- [ ] **Step 2.1: Create compose.dev.yaml**

Create `compose.dev.yaml`:

```yaml
name: flipturn-dev

services:
  postgres:
    image: postgres:16-alpine
    container_name: flipturn-postgres
    environment:
      POSTGRES_USER: flipturn
      POSTGRES_PASSWORD: flipturn_dev
      POSTGRES_DB: flipturn
    ports:
      - '5432:5432'
    volumes:
      - flipturn_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U flipturn -d flipturn']
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: flipturn-redis
    ports:
      - '6379:6379'
    volumes:
      - flipturn_redisdata:/data
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  flipturn_pgdata:
  flipturn_redisdata:
```

- [ ] **Step 2.2: Create .env.example**

Create `.env.example`:

```
# Local dev — copy to .env and adjust as needed
DATABASE_URL="postgresql://flipturn:flipturn_dev@localhost:5432/flipturn?schema=public"
REDIS_URL="redis://localhost:6379"
```

- [ ] **Step 2.3: Start services**

Run: `pnpm dev:up`
Expected: docker compose pulls postgres:16-alpine and redis:7-alpine images, starts both containers, both report healthy within ~10s.

Verify with: `docker compose -f compose.dev.yaml ps`
Expected output: two containers listed, both with `Status` = `Up (healthy)`.

- [ ] **Step 2.4: Smoke-test Postgres connection**

Run: `docker exec flipturn-postgres psql -U flipturn -d flipturn -c "SELECT 1;"`
Expected: `?column?` row with value `1`.

- [ ] **Step 2.5: Smoke-test Redis connection**

Run: `docker exec flipturn-redis redis-cli PING`
Expected: `PONG`

- [ ] **Step 2.6: Commit**

```bash
git add compose.dev.yaml .env.example
git commit -m "chore: add docker compose for local postgres + redis"
```

---

## Task 3: ADR 0001 — MVP hosting decision

**Files:**

- Create: `docs/adr/0001-mvp-hosting.md`

- [ ] **Step 3.1: Write the ADR**

Create `docs/adr/0001-mvp-hosting.md`:

```markdown
# ADR 0001 — MVP hosting: Mac Mini + docker compose + pm2 + Cloudflare Tunnel

**Status:** Accepted
**Date:** 2026-05-04
**Deciders:** Darrell Bechtel
**Spec link:** [`docs/superpowers/specs/2026-05-04-flipturn-mvp-design.md`](../superpowers/specs/2026-05-04-flipturn-mvp-design.md)

## Context

Flip Turn MVP needs hosting that is (a) free during closed beta, (b) reachable
from beta users' phones, (c) able to run a long-lived BullMQ worker process,
and (d) trivial to migrate away from when paying users arrive.

## Decision

Run the API and worker processes on the founder's always-on Mac Mini M4,
with Postgres and Redis in docker compose, supervised by pm2, and exposed
to the public internet via Cloudflare Tunnel.

## Alternatives considered

- **Fly.io free tier** — Real serverless, real regions, real DX. Cost: $0
  for closed-beta scale. But: requires designing around scale-to-zero (cold
  start latency), persistent volumes for raw scrape archive cost extra, and
  the worker process model fights the platform's preference for HTTP services.
  Revisit at v1.1 when we want CI/CD without the Mac Mini in the loop.

- **Railway / Render** — Similar to Fly.io but smaller free tiers; same
  worker-process awkwardness.

- **Residential static IP + dynamic DNS** — Free if the ISP allows it, but
  flaky (port forwarding through home router, no automatic TLS), and exposes
  the home network IP to scrapers. Reject.

- **Tailscale Funnel** — Works for closed beta, but ties beta users to a
  Tailscale-hosted ingress; Cloudflare Tunnel is simpler with no per-user
  setup.

## Consequences

- Free during closed beta. Estimated incremental electricity cost: <$5/month.
- Latency from a Toronto/Waterloo user to a Toronto/Waterloo Mac Mini is
  better than to a US-East AWS region.
- Single point of failure: if the Mac Mini reboots or loses power, beta is
  down. Acceptable for closed beta; alert via Cloudflare's tunnel-down
  notification.
- Migration path: when paying users arrive, lift API + workers to AWS / Fly.io
  with no schema changes. Postgres dump/restore. Cloudflare Tunnel can stay
  pointing at the new origin.
```

- [ ] **Step 3.2: Commit**

```bash
git add docs/adr/0001-mvp-hosting.md
git commit -m "docs(adr): 0001 mvp hosting decision (mac mini + cloudflare tunnel)"
```

---

## Task 4: packages/db — skeleton

**Files:**

- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`

- [ ] **Step 4.1: Create packages/db/package.json**

Create `packages/db/package.json`:

```json
{
  "name": "@flipturn/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "generate": "prisma generate",
    "migrate": "prisma migrate dev",
    "migrate:deploy": "prisma migrate deploy",
    "reset": "prisma migrate reset --force",
    "seed": "tsx src/seed.ts",
    "studio": "prisma studio",
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run"
  },
  "prisma": {
    "seed": "tsx src/seed.ts"
  },
  "dependencies": {
    "@prisma/client": "^5.21.0"
  },
  "devDependencies": {
    "prisma": "^5.21.0",
    "tsx": "^4.19.1",
    "typescript": "^5.6.3",
    "vitest": "^2.1.2"
  }
}
```

- [ ] **Step 4.2: Create packages/db/tsconfig.json**

Create `packages/db/tsconfig.json`:

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

- [ ] **Step 4.3: Install package dependencies**

Run: `pnpm install`
Expected: pnpm picks up the new workspace package, installs Prisma + tsx + vitest into `packages/db/node_modules` (or hoisted root); `pnpm-lock.yaml` updates.

- [ ] **Step 4.4: Commit**

```bash
git add packages/db/package.json packages/db/tsconfig.json pnpm-lock.yaml
git commit -m "feat(db): scaffold @flipturn/db package"
```

---

## Task 5: packages/db — Prisma schema

**Files:**

- Create: `packages/db/prisma/schema.prisma`

- [ ] **Step 5.1: Create the Prisma schema**

Create `packages/db/prisma/schema.prisma` (this is the full schema from the design spec, Appendix A):

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── Auth ────────────────────────────────────────────────────────────────

model User {
  id         String           @id @default(cuid())
  email      String           @unique
  createdAt  DateTime         @default(now())
  updatedAt  DateTime         @updatedAt
  magicLinks MagicLinkToken[]
  sessions   Session[]
  athletes   UserAthlete[]
}

model MagicLinkToken {
  id         String    @id @default(cuid())
  userId     String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash  String    @unique
  expiresAt  DateTime
  consumedAt DateTime?
  createdAt  DateTime  @default(now())

  @@index([userId])
  @@index([expiresAt])
}

model Session {
  id         String    @id @default(cuid())
  userId     String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash  String    @unique
  createdAt  DateTime  @default(now())
  lastUsedAt DateTime  @default(now())
  revokedAt  DateTime?

  @@index([userId])
}

// ─── People ──────────────────────────────────────────────────────────────

model Athlete {
  id             String           @id @default(cuid())
  sncId          String           @unique
  primaryName    String
  alternateNames String[]
  dob            DateTime?
  gender         Gender?
  homeClub       String?
  clubHistory    ClubMembership[]
  swims          Swim[]
  personalBests  PersonalBest[]
  users          UserAthlete[]
  lastScrapedAt  DateTime?
  createdAt      DateTime         @default(now())
  updatedAt      DateTime         @updatedAt
}

model UserAthlete {
  userId       String
  athleteId    String
  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  athlete      Athlete      @relation(fields: [athleteId], references: [id], onDelete: Cascade)
  relationship Relationship @default(PARENT)
  addedAt      DateTime     @default(now())

  @@id([userId, athleteId])
  @@index([athleteId])
}

model ClubMembership {
  id        String    @id @default(cuid())
  athleteId String
  athlete   Athlete   @relation(fields: [athleteId], references: [id], onDelete: Cascade)
  clubName  String
  clubCode  String?
  startDate DateTime?
  endDate   DateTime?

  @@index([athleteId])
}

enum Relationship {
  PARENT
  GUARDIAN
  SELF
  OTHER
}

enum Gender {
  M
  F
  X
}

// ─── Competition ────────────────────────────────────────────────────────

model Meet {
  id           String   @id @default(cuid())
  externalId   String   @unique
  name         String
  sanctionBody String?
  course       Course
  location     String?
  startDate    DateTime
  endDate      DateTime
  sourceUrl    String?
  events       Event[]
  swims        Swim[]
  createdAt    DateTime @default(now())
}

enum Course {
  SCM
  LCM
  SCY
}

model Event {
  id        String  @id @default(cuid())
  meetId    String
  meet      Meet    @relation(fields: [meetId], references: [id], onDelete: Cascade)
  distanceM Int
  stroke    Stroke
  gender    Gender
  ageBand   String?
  round     Round
  swims     Swim[]

  @@unique([meetId, distanceM, stroke, gender, ageBand, round])
  @@index([meetId])
}

enum Stroke {
  FR
  BK
  BR
  FL
  IM
}

enum Round {
  PRELIM
  SEMI
  FINAL
  TIMED_FINAL
}

// ─── Results ────────────────────────────────────────────────────────────

model Swim {
  id               String     @id @default(cuid())
  athleteId        String
  athlete          Athlete    @relation(fields: [athleteId], references: [id], onDelete: Cascade)
  meetId           String
  meet             Meet       @relation(fields: [meetId], references: [id], onDelete: Cascade)
  eventId          String
  event            Event      @relation(fields: [eventId], references: [id], onDelete: Cascade)

  timeCentiseconds Int
  splits           Int[]
  place            Int?
  status           SwimStatus @default(OFFICIAL)

  eventKey         String

  dataSource       String
  sourceUrl        String?
  scrapedAt        DateTime   @default(now())

  supersedesId     String?
  supersedes       Swim?      @relation("SwimVersion", fields: [supersedesId], references: [id])
  supersededBy     Swim[]     @relation("SwimVersion")
  isCurrent        Boolean    @default(true)

  @@unique([athleteId, meetId, eventId])
  @@index([athleteId, eventKey])
  @@index([meetId])
}

enum SwimStatus {
  OFFICIAL
  DQ
  NS
  DNF
  WITHDRAWN
}

model PersonalBest {
  id               String   @id @default(cuid())
  athleteId        String
  athlete          Athlete  @relation(fields: [athleteId], references: [id], onDelete: Cascade)
  eventKey         String
  swimId           String
  swim             Swim     @relation(fields: [swimId], references: [id])
  timeCentiseconds Int
  achievedAt       DateTime
  updatedAt        DateTime @updatedAt

  @@unique([athleteId, eventKey])
  @@index([eventKey])
}
```

- [ ] **Step 5.2: Format the schema**

Run: `pnpm --filter @flipturn/db exec prisma format`
Expected: schema is reformatted in place; exit 0.

- [ ] **Step 5.3: Validate the schema**

Run: `pnpm --filter @flipturn/db exec prisma validate`
Expected: `The schema at packages/db/prisma/schema.prisma is valid 🚀` (or equivalent success message).

- [ ] **Step 5.4: Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat(db): add prisma schema (full mvp model from design spec)"
```

---

## Task 6: packages/db — first migration

**Files:**

- Modify: workspace `.env` (created by engineer for local dev; not committed)
- Create: `packages/db/prisma/migrations/<timestamp>_initial/migration.sql` (auto-generated)

- [ ] **Step 6.1: Create local .env from template**

```bash
cp .env.example .env
```

Verify the `DATABASE_URL` in `.env` matches `compose.dev.yaml`'s Postgres credentials (`flipturn:flipturn_dev@localhost:5432/flipturn`).

- [ ] **Step 6.2: Verify Postgres is up**

Run: `docker compose -f compose.dev.yaml ps`
Expected: `flipturn-postgres` listed with `Up (healthy)`. If not, run `pnpm dev:up` first.

- [ ] **Step 6.3: Generate the first migration**

Run: `pnpm --filter @flipturn/db exec prisma migrate dev --name initial`
Expected: prisma creates `packages/db/prisma/migrations/<timestamp>_initial/migration.sql`, applies it to the database, and runs `prisma generate`. Output ends with `Your database is now in sync with your schema.`

- [ ] **Step 6.4: Verify migration applied to database**

Run: `docker exec flipturn-postgres psql -U flipturn -d flipturn -c "\dt"`
Expected: lists tables including `User`, `Athlete`, `Meet`, `Event`, `Swim`, `PersonalBest`, `MagicLinkToken`, `Session`, `UserAthlete`, `ClubMembership`, plus `_prisma_migrations`.

- [ ] **Step 6.5: Inspect migration SQL**

Use the Read tool to verify the generated `packages/db/prisma/migrations/<timestamp>_initial/migration.sql` looks reasonable (includes `CREATE TYPE` for enums and `CREATE TABLE` for all 10 models).

- [ ] **Step 6.6: Commit**

```bash
git add packages/db/prisma/migrations/
git commit -m "feat(db): initial migration for full mvp schema"
```

---

## Task 7: packages/db — exports and generated client wiring

**Files:**

- Create: `packages/db/src/index.ts`

- [ ] **Step 7.1: Create the package entry point**

Create `packages/db/src/index.ts`:

```ts
import { PrismaClient } from '@prisma/client';

export { PrismaClient };
export * from '@prisma/client';

let _client: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (!_client) {
    _client = new PrismaClient();
  }
  return _client;
}

export async function disconnectPrisma(): Promise<void> {
  if (_client) {
    await _client.$disconnect();
    _client = undefined;
  }
}
```

- [ ] **Step 7.2: Typecheck the package**

Run: `pnpm --filter @flipturn/db typecheck`
Expected: exit 0 with no output.

- [ ] **Step 7.3: Commit**

```bash
git add packages/db/src/index.ts
git commit -m "feat(db): export PrismaClient + lazy getPrisma helper"
```

---

## Task 8: packages/db — seed script

**Files:**

- Create: `packages/db/src/seed.ts`

- [ ] **Step 8.1: Create the seed script**

Create `packages/db/src/seed.ts`:

```ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Demo athlete 1 — for local dev only; SNC IDs are placeholders.
  const sarah = await prisma.athlete.upsert({
    where: { sncId: 'DEMO-SARAH-001' },
    update: {},
    create: {
      sncId: 'DEMO-SARAH-001',
      primaryName: 'Sarah Demo',
      alternateNames: ['Sarah D.', 'S. Demo'],
      gender: 'F',
      homeClub: 'Waterloo Region Aquatics',
    },
  });

  const benji = await prisma.athlete.upsert({
    where: { sncId: 'DEMO-BENJI-002' },
    update: {},
    create: {
      sncId: 'DEMO-BENJI-002',
      primaryName: 'Benji Demo',
      gender: 'M',
      homeClub: 'Waterloo Region Aquatics',
    },
  });

  // Demo meet — local-dev only.
  const meet = await prisma.meet.upsert({
    where: { externalId: 'DEMO-MEET-001' },
    update: {},
    create: {
      externalId: 'DEMO-MEET-001',
      name: 'Demo Spring Open 2026',
      sanctionBody: 'SNC',
      course: 'LCM',
      location: 'Waterloo, ON',
      startDate: new Date('2026-04-01'),
      endDate: new Date('2026-04-03'),
    },
  });

  console.log(`Seeded athletes: ${sarah.id}, ${benji.id}; meet: ${meet.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] **Step 8.2: Run the seed**

Run: `pnpm db:seed`
Expected: prints `Seeded athletes: <cuid>, <cuid>; meet: <cuid>`. Exit 0.

- [ ] **Step 8.3: Run again to verify idempotency**

Run: `pnpm db:seed`
Expected: same output (different cuids would mean upsert is broken; the upsert keys are `sncId` / `externalId` so existing rows are returned with their original ids).

- [ ] **Step 8.4: Verify rows in DB**

Run: `docker exec flipturn-postgres psql -U flipturn -d flipturn -c "SELECT \"sncId\", \"primaryName\" FROM \"Athlete\";"`
Expected: two rows with `DEMO-SARAH-001` and `DEMO-BENJI-002`.

- [ ] **Step 8.5: Commit**

```bash
git add packages/db/src/seed.ts
git commit -m "feat(db): add idempotent seed script with two demo athletes"
```

---

## Task 9: packages/db — migration smoke test

**Files:**

- Create: `packages/db/tests/migrations.test.ts`
- Create: `packages/db/vitest.config.ts`

This task does NOT use `@testcontainers` (that's Task 5 of Plan 3 — API tests). It runs against the already-running compose Postgres on a separate test database created on the fly.

- [ ] **Step 9.1: Create vitest config**

Create `packages/db/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    testTimeout: 30_000,
  },
});
```

- [ ] **Step 9.2: Write the failing test**

Create `packages/db/tests/migrations.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const TEST_DB = `flipturn_migrate_test_${Date.now()}`;
const ADMIN_URL = 'postgresql://flipturn:flipturn_dev@localhost:5432/flipturn?schema=public';
const TEST_URL = `postgresql://flipturn:flipturn_dev@localhost:5432/${TEST_DB}?schema=public`;

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
```

- [ ] **Step 9.3: Run the test (expecting it to pass)**

Run: `pnpm --filter @flipturn/db test`
Expected: 2 tests pass. (No "failing first" stage here because the migration was applied in Task 6 — this test verifies that what we already built actually works. It's a regression suite, not new behavior.)

- [ ] **Step 9.4: Commit**

```bash
git add packages/db/tests/migrations.test.ts packages/db/vitest.config.ts
git commit -m "test(db): smoke test for initial migration + swim uniqueness"
```

---

## Task 10: packages/shared — skeleton

**Files:**

- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/vitest.config.ts`

- [ ] **Step 10.1: Create packages/shared/package.json**

Create `packages/shared/package.json`:

```json
{
  "name": "@flipturn/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vitest": "^2.1.2"
  }
}
```

- [ ] **Step 10.2: Create packages/shared/tsconfig.json**

Create `packages/shared/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules", "tests"]
}
```

- [ ] **Step 10.3: Create vitest config**

Create `packages/shared/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
  },
});
```

- [ ] **Step 10.4: Install package dependencies**

Run: `pnpm install`
Expected: pnpm picks up the new workspace package; lockfile updates.

- [ ] **Step 10.5: Commit**

```bash
git add packages/shared/package.json packages/shared/tsconfig.json packages/shared/vitest.config.ts pnpm-lock.yaml
git commit -m "feat(shared): scaffold @flipturn/shared package"
```

---

## Task 11: packages/shared — enums

**Files:**

- Create: `packages/shared/src/enums.ts`

`packages/shared` cannot import from `@flipturn/db` (would create a transitive `@prisma/client` dependency on the mobile app). Instead, mirror the enums as plain TS literal-union types and export an exhaustive list.

- [ ] **Step 11.1: Create the enum file**

Create `packages/shared/src/enums.ts`:

```ts
export const STROKES = ['FR', 'BK', 'BR', 'FL', 'IM'] as const;
export type Stroke = (typeof STROKES)[number];

export const COURSES = ['SCM', 'LCM', 'SCY'] as const;
export type Course = (typeof COURSES)[number];

export const GENDERS = ['M', 'F', 'X'] as const;
export type Gender = (typeof GENDERS)[number];

export const ROUNDS = ['PRELIM', 'SEMI', 'FINAL', 'TIMED_FINAL'] as const;
export type Round = (typeof ROUNDS)[number];

export const SWIM_STATUSES = ['OFFICIAL', 'DQ', 'NS', 'DNF', 'WITHDRAWN'] as const;
export type SwimStatus = (typeof SWIM_STATUSES)[number];

export const RELATIONSHIPS = ['PARENT', 'GUARDIAN', 'SELF', 'OTHER'] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

// Common race distances (meters). Not exhaustive — used for dropdowns / validation hints.
export const COMMON_DISTANCES_M = [25, 50, 100, 200, 400, 800, 1500] as const;
```

- [ ] **Step 11.2: Commit**

```bash
git add packages/shared/src/enums.ts
git commit -m "feat(shared): mirror prisma enums as ts literal unions"
```

---

## Task 12: packages/shared — time formatting (TDD)

**Files:**

- Create: `packages/shared/tests/time.test.ts`
- Create: `packages/shared/src/time.ts`

Times are stored in centiseconds (1/100 second) per the spec. We need:

- `formatSwimTime(centiseconds)` → display string like `"57.32"` for sub-minute, `"1:02.45"` for minute+, `"15:23.07"` for big distances.
- `parseSwimTime(str)` → centiseconds (round-trip with `formatSwimTime`).

- [ ] **Step 12.1: Write the failing tests**

Create `packages/shared/tests/time.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatSwimTime, parseSwimTime } from '../src/time.js';

describe('formatSwimTime', () => {
  it('formats sub-minute times as SS.cc', () => {
    expect(formatSwimTime(0)).toBe('0.00');
    expect(formatSwimTime(1)).toBe('0.01');
    expect(formatSwimTime(99)).toBe('0.99');
    expect(formatSwimTime(100)).toBe('1.00');
    expect(formatSwimTime(5732)).toBe('57.32');
    expect(formatSwimTime(5999)).toBe('59.99');
  });

  it('formats minute+ times as M:SS.cc', () => {
    expect(formatSwimTime(6000)).toBe('1:00.00');
    expect(formatSwimTime(6245)).toBe('1:02.45');
    expect(formatSwimTime(13287)).toBe('2:12.87');
    expect(formatSwimTime(35999)).toBe('5:59.99');
  });

  it('formats 10-minute+ times as MM:SS.cc', () => {
    expect(formatSwimTime(60000)).toBe('10:00.00');
    expect(formatSwimTime(92307)).toBe('15:23.07');
  });

  it('formats hour+ times as H:MM:SS.cc', () => {
    // edge case for ultra-marathon swims; included for completeness
    expect(formatSwimTime(360000)).toBe('1:00:00.00');
    expect(formatSwimTime(367512)).toBe('1:01:15.12');
  });

  it('throws on negative input', () => {
    expect(() => formatSwimTime(-1)).toThrow();
  });

  it('throws on non-integer input', () => {
    expect(() => formatSwimTime(57.32)).toThrow();
  });
});

describe('parseSwimTime', () => {
  it('parses sub-minute display strings', () => {
    expect(parseSwimTime('0.00')).toBe(0);
    expect(parseSwimTime('0.99')).toBe(99);
    expect(parseSwimTime('57.32')).toBe(5732);
    expect(parseSwimTime('59.99')).toBe(5999);
  });

  it('parses minute+ strings', () => {
    expect(parseSwimTime('1:00.00')).toBe(6000);
    expect(parseSwimTime('1:02.45')).toBe(6245);
    expect(parseSwimTime('15:23.07')).toBe(92307);
  });

  it('parses hour+ strings', () => {
    expect(parseSwimTime('1:00:00.00')).toBe(360000);
    expect(parseSwimTime('1:01:15.12')).toBe(367512);
  });

  it('round-trips with formatSwimTime', () => {
    for (const cs of [0, 1, 99, 5732, 6000, 13287, 92307, 367512]) {
      expect(parseSwimTime(formatSwimTime(cs))).toBe(cs);
    }
  });

  it('throws on malformed input', () => {
    expect(() => parseSwimTime('')).toThrow();
    expect(() => parseSwimTime('abc')).toThrow();
    expect(() => parseSwimTime('57.3')).toThrow(); // missing trailing digit
    expect(() => parseSwimTime('1.02.45')).toThrow();
  });
});
```

- [ ] **Step 12.2: Run tests to verify they fail**

Run: `pnpm --filter @flipturn/shared test`
Expected: all tests fail with "Cannot find module '../src/time.js'" or similar.

- [ ] **Step 12.3: Implement formatSwimTime and parseSwimTime**

Create `packages/shared/src/time.ts`:

```ts
/**
 * Swim time canonical unit: centiseconds (1/100 second).
 * 5732 = 57.32 seconds = a 100m freestyle.
 */

export function formatSwimTime(centiseconds: number): string {
  if (!Number.isInteger(centiseconds)) {
    throw new Error(`formatSwimTime: expected integer, got ${centiseconds}`);
  }
  if (centiseconds < 0) {
    throw new Error(`formatSwimTime: expected non-negative, got ${centiseconds}`);
  }

  const totalSeconds = Math.floor(centiseconds / 100);
  const cs = centiseconds % 100;
  const csStr = cs.toString().padStart(2, '0');

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    const mm = minutes.toString().padStart(2, '0');
    const ss = seconds.toString().padStart(2, '0');
    return `${hours}:${mm}:${ss}.${csStr}`;
  }

  if (minutes > 0) {
    const ss = seconds.toString().padStart(2, '0');
    // M:SS.cc — leading minute is not zero-padded for readability
    return `${minutes}:${ss}.${csStr}`;
  }

  return `${seconds}.${csStr}`;
}

const TIME_REGEX =
  /^(?:(?<h>\d+):(?<m1>\d{2}):(?<s1>\d{2})|(?<min>\d+):(?<s2>\d{2})|(?<s3>\d+))\.(?<cs>\d{2})$/;

export function parseSwimTime(input: string): number {
  const match = TIME_REGEX.exec(input);
  if (!match || !match.groups) {
    throw new Error(`parseSwimTime: malformed input: ${JSON.stringify(input)}`);
  }
  const g = match.groups;
  const cs = parseInt(g.cs!, 10);

  if (g.h !== undefined) {
    const h = parseInt(g.h, 10);
    const m = parseInt(g.m1!, 10);
    const s = parseInt(g.s1!, 10);
    return h * 360_000 + m * 6000 + s * 100 + cs;
  }
  if (g.min !== undefined) {
    const m = parseInt(g.min, 10);
    const s = parseInt(g.s2!, 10);
    return m * 6000 + s * 100 + cs;
  }
  const s = parseInt(g.s3!, 10);
  return s * 100 + cs;
}
```

- [ ] **Step 12.4: Run tests to verify they pass**

Run: `pnpm --filter @flipturn/shared test`
Expected: all tests in `time.test.ts` pass.

- [ ] **Step 12.5: Commit**

```bash
git add packages/shared/src/time.ts packages/shared/tests/time.test.ts
git commit -m "feat(shared): add formatSwimTime/parseSwimTime in centiseconds"
```

---

## Task 13: packages/shared — eventKey (TDD)

**Files:**

- Create: `packages/shared/tests/eventKey.test.ts`
- Create: `packages/shared/src/eventKey.ts`

`eventKey` is the denormalized lookup string for swims and PBs (see spec §5.2 and Appendix B). Format: `<distanceM>_<stroke>_<course>`. Builder is the only authorized way to construct it.

- [ ] **Step 13.1: Write the failing tests**

Create `packages/shared/tests/eventKey.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildEventKey, parseEventKey } from '../src/eventKey.js';

describe('buildEventKey', () => {
  it('builds canonical event keys', () => {
    expect(buildEventKey({ distanceM: 50, stroke: 'FR', course: 'LCM' })).toBe('50_FR_LCM');
    expect(buildEventKey({ distanceM: 100, stroke: 'BK', course: 'SCM' })).toBe('100_BK_SCM');
    expect(buildEventKey({ distanceM: 400, stroke: 'IM', course: 'SCY' })).toBe('400_IM_SCY');
    expect(buildEventKey({ distanceM: 1500, stroke: 'FR', course: 'LCM' })).toBe('1500_FR_LCM');
  });

  it('throws on invalid distance', () => {
    // @ts-expect-error invalid input
    expect(() => buildEventKey({ distanceM: 0, stroke: 'FR', course: 'LCM' })).toThrow();
    // @ts-expect-error invalid input
    expect(() => buildEventKey({ distanceM: -100, stroke: 'FR', course: 'LCM' })).toThrow();
    // @ts-expect-error invalid input
    expect(() => buildEventKey({ distanceM: 50.5, stroke: 'FR', course: 'LCM' })).toThrow();
  });
});

describe('parseEventKey', () => {
  it('parses well-formed event keys', () => {
    expect(parseEventKey('50_FR_LCM')).toEqual({ distanceM: 50, stroke: 'FR', course: 'LCM' });
    expect(parseEventKey('1500_FR_LCM')).toEqual({
      distanceM: 1500,
      stroke: 'FR',
      course: 'LCM',
    });
  });

  it('round-trips with buildEventKey', () => {
    const inputs = [
      { distanceM: 50, stroke: 'FR', course: 'LCM' },
      { distanceM: 200, stroke: 'IM', course: 'SCY' },
      { distanceM: 800, stroke: 'FR', course: 'LCM' },
    ] as const;
    for (const i of inputs) {
      expect(parseEventKey(buildEventKey(i))).toEqual(i);
    }
  });

  it('throws on malformed input', () => {
    expect(() => parseEventKey('')).toThrow();
    expect(() => parseEventKey('100_FR')).toThrow();
    expect(() => parseEventKey('100_FR_LCM_extra')).toThrow();
    expect(() => parseEventKey('100_XX_LCM')).toThrow(); // unknown stroke
    expect(() => parseEventKey('100_FR_XXX')).toThrow(); // unknown course
    expect(() => parseEventKey('abc_FR_LCM')).toThrow();
  });
});
```

- [ ] **Step 13.2: Run tests to verify they fail**

Run: `pnpm --filter @flipturn/shared test`
Expected: tests in `eventKey.test.ts` fail with module-not-found.

- [ ] **Step 13.3: Implement buildEventKey and parseEventKey**

Create `packages/shared/src/eventKey.ts`:

```ts
import { STROKES, COURSES, type Stroke, type Course } from './enums.js';

export interface EventKeyParts {
  readonly distanceM: number;
  readonly stroke: Stroke;
  readonly course: Course;
}

export function buildEventKey(parts: EventKeyParts): string {
  if (!Number.isInteger(parts.distanceM) || parts.distanceM <= 0) {
    throw new Error(`buildEventKey: distanceM must be a positive integer, got ${parts.distanceM}`);
  }
  if (!STROKES.includes(parts.stroke)) {
    throw new Error(`buildEventKey: unknown stroke ${parts.stroke}`);
  }
  if (!COURSES.includes(parts.course)) {
    throw new Error(`buildEventKey: unknown course ${parts.course}`);
  }
  return `${parts.distanceM}_${parts.stroke}_${parts.course}`;
}

export function parseEventKey(key: string): EventKeyParts {
  const parts = key.split('_');
  if (parts.length !== 3) {
    throw new Error(`parseEventKey: expected DISTANCE_STROKE_COURSE, got ${JSON.stringify(key)}`);
  }
  const [distanceStr, strokeStr, courseStr] = parts as [string, string, string];

  const distanceM = parseInt(distanceStr, 10);
  if (!Number.isInteger(distanceM) || distanceM <= 0 || `${distanceM}` !== distanceStr) {
    throw new Error(`parseEventKey: invalid distance ${distanceStr}`);
  }
  if (!STROKES.includes(strokeStr as Stroke)) {
    throw new Error(`parseEventKey: unknown stroke ${strokeStr}`);
  }
  if (!COURSES.includes(courseStr as Course)) {
    throw new Error(`parseEventKey: unknown course ${courseStr}`);
  }

  return {
    distanceM,
    stroke: strokeStr as Stroke,
    course: courseStr as Course,
  };
}
```

- [ ] **Step 13.4: Run tests to verify they pass**

Run: `pnpm --filter @flipturn/shared test`
Expected: all tests in `eventKey.test.ts` pass; `time.test.ts` also still passes.

- [ ] **Step 13.5: Commit**

```bash
git add packages/shared/src/eventKey.ts packages/shared/tests/eventKey.test.ts
git commit -m "feat(shared): add buildEventKey/parseEventKey with full validation"
```

---

## Task 14: packages/shared — zod schemas (TDD)

**Files:**

- Create: `packages/shared/tests/schemas.test.ts`
- Create: `packages/shared/src/schemas.ts`

These mirror the API contracts (spec §7). They'll be re-used by `apps/api` (server-side validation) and `apps/mobile` (response parsing). Plan 3 may extend them; this plan establishes the baseline.

- [ ] **Step 14.1: Write the failing tests**

Create `packages/shared/tests/schemas.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  MagicLinkRequestSchema,
  MagicLinkConsumeSchema,
  OnboardAthleteSchema,
  AthleteDtoSchema,
  SwimDtoSchema,
  PersonalBestDtoSchema,
} from '../src/schemas.js';

describe('MagicLinkRequestSchema', () => {
  it('accepts a valid email', () => {
    expect(MagicLinkRequestSchema.parse({ email: 'darrell@example.com' })).toEqual({
      email: 'darrell@example.com',
    });
  });

  it('rejects non-email', () => {
    expect(() => MagicLinkRequestSchema.parse({ email: 'not-an-email' })).toThrow();
    expect(() => MagicLinkRequestSchema.parse({})).toThrow();
  });

  it('lowercases and trims emails', () => {
    expect(MagicLinkRequestSchema.parse({ email: '  Darrell@Example.COM  ' })).toEqual({
      email: 'darrell@example.com',
    });
  });
});

describe('MagicLinkConsumeSchema', () => {
  it('accepts a non-empty token', () => {
    expect(MagicLinkConsumeSchema.parse({ token: 'abc123' })).toEqual({ token: 'abc123' });
  });

  it('rejects empty token', () => {
    expect(() => MagicLinkConsumeSchema.parse({ token: '' })).toThrow();
  });
});

describe('OnboardAthleteSchema', () => {
  it('accepts SNC ID with default relationship', () => {
    expect(OnboardAthleteSchema.parse({ sncId: 'SNC-12345' })).toEqual({
      sncId: 'SNC-12345',
      relationship: 'PARENT',
    });
  });

  it('accepts explicit relationship', () => {
    expect(OnboardAthleteSchema.parse({ sncId: 'SNC-12345', relationship: 'GUARDIAN' })).toEqual({
      sncId: 'SNC-12345',
      relationship: 'GUARDIAN',
    });
  });

  it('rejects empty sncId', () => {
    expect(() => OnboardAthleteSchema.parse({ sncId: '' })).toThrow();
  });

  it('rejects unknown relationship', () => {
    expect(() =>
      OnboardAthleteSchema.parse({ sncId: 'SNC-12345', relationship: 'COACH' }),
    ).toThrow();
  });
});

describe('AthleteDtoSchema', () => {
  it('parses a full athlete payload', () => {
    const dto = AthleteDtoSchema.parse({
      id: 'cuid-1',
      sncId: 'SNC-12345',
      primaryName: 'Sarah Demo',
      gender: 'F',
      homeClub: 'WRA',
      lastScrapedAt: '2026-05-04T00:00:00.000Z',
    });
    expect(dto.primaryName).toBe('Sarah Demo');
    expect(dto.lastScrapedAt).toBeInstanceOf(Date);
  });

  it('accepts null/undefined optional fields', () => {
    const dto = AthleteDtoSchema.parse({
      id: 'cuid-2',
      sncId: 'SNC-67890',
      primaryName: 'Benji Demo',
    });
    expect(dto.gender).toBeUndefined();
  });
});

describe('SwimDtoSchema', () => {
  it('parses a swim payload', () => {
    const dto = SwimDtoSchema.parse({
      id: 'swim-1',
      eventKey: '100_FR_LCM',
      timeCentiseconds: 6512,
      splits: [3120, 3392],
      place: 1,
      status: 'OFFICIAL',
      meetName: 'Spring Open',
      swamAt: '2026-04-01T10:00:00.000Z',
    });
    expect(dto.timeCentiseconds).toBe(6512);
    expect(dto.splits).toEqual([3120, 3392]);
    expect(dto.swamAt).toBeInstanceOf(Date);
  });
});

describe('PersonalBestDtoSchema', () => {
  it('parses a PB payload', () => {
    const dto = PersonalBestDtoSchema.parse({
      eventKey: '100_FR_LCM',
      timeCentiseconds: 6512,
      achievedAt: '2026-04-01T10:00:00.000Z',
      swimId: 'swim-1',
    });
    expect(dto.achievedAt).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 14.2: Run tests to verify they fail**

Run: `pnpm --filter @flipturn/shared test`
Expected: tests in `schemas.test.ts` fail with module-not-found.

- [ ] **Step 14.3: Implement the schemas**

Create `packages/shared/src/schemas.ts`:

```ts
import { z } from 'zod';
import { GENDERS, RELATIONSHIPS, SWIM_STATUSES } from './enums.js';

// ─── Auth ────────────────────────────────────────────────────────────────

export const MagicLinkRequestSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.string().email()),
});
export type MagicLinkRequest = z.infer<typeof MagicLinkRequestSchema>;

export const MagicLinkConsumeSchema = z.object({
  token: z.string().min(1),
});
export type MagicLinkConsume = z.infer<typeof MagicLinkConsumeSchema>;

// ─── Athletes ───────────────────────────────────────────────────────────

export const OnboardAthleteSchema = z.object({
  sncId: z.string().min(1),
  relationship: z.enum(RELATIONSHIPS).default('PARENT'),
});
export type OnboardAthleteRequest = z.infer<typeof OnboardAthleteSchema>;

export const AthleteDtoSchema = z.object({
  id: z.string(),
  sncId: z.string(),
  primaryName: z.string(),
  gender: z.enum(GENDERS).optional(),
  homeClub: z.string().optional(),
  lastScrapedAt: z.coerce.date().optional(),
});
export type AthleteDto = z.infer<typeof AthleteDtoSchema>;

// ─── Swims & PBs ────────────────────────────────────────────────────────

export const SwimDtoSchema = z.object({
  id: z.string(),
  eventKey: z.string(),
  timeCentiseconds: z.number().int().nonnegative(),
  splits: z.array(z.number().int().nonnegative()),
  place: z.number().int().positive().optional(),
  status: z.enum(SWIM_STATUSES),
  meetName: z.string(),
  swamAt: z.coerce.date(),
});
export type SwimDto = z.infer<typeof SwimDtoSchema>;

export const PersonalBestDtoSchema = z.object({
  eventKey: z.string(),
  timeCentiseconds: z.number().int().nonnegative(),
  achievedAt: z.coerce.date(),
  swimId: z.string(),
});
export type PersonalBestDto = z.infer<typeof PersonalBestDtoSchema>;

export const ProgressionPointSchema = z.object({
  date: z.coerce.date(),
  timeCentiseconds: z.number().int().nonnegative(),
  meetName: z.string(),
});
export type ProgressionPoint = z.infer<typeof ProgressionPointSchema>;
```

- [ ] **Step 14.4: Run tests to verify they pass**

Run: `pnpm --filter @flipturn/shared test`
Expected: all schema tests pass; all earlier tests still pass.

- [ ] **Step 14.5: Commit**

```bash
git add packages/shared/src/schemas.ts packages/shared/tests/schemas.test.ts
git commit -m "feat(shared): add zod schemas for auth, athletes, swims, PBs"
```

---

## Task 15: packages/shared — package entry point

**Files:**

- Create: `packages/shared/src/index.ts`

- [ ] **Step 15.1: Create the entry point**

Create `packages/shared/src/index.ts`:

```ts
export * from './enums.js';
export * from './eventKey.js';
export * from './schemas.js';
export * from './time.js';
```

- [ ] **Step 15.2: Typecheck the package**

Run: `pnpm --filter @flipturn/shared typecheck`
Expected: exit 0.

- [ ] **Step 15.3: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): re-export public api from package root"
```

---

## Task 16: Final integration check

**Files:** none

- [ ] **Step 16.1: Clean install from scratch**

Run: `rm -rf node_modules packages/*/node_modules && pnpm install`
Expected: clean install succeeds.

- [ ] **Step 16.2: Run all typechecks**

Run: `pnpm typecheck`
Expected: both packages typecheck cleanly. Exit 0.

- [ ] **Step 16.3: Run all tests**

Run: `pnpm test`
Expected: both packages' test suites run; all tests pass. (`packages/db` migration test requires the docker compose Postgres to be running — verify with `pnpm dev:up` first.)

- [ ] **Step 16.4: Run lint**

Run: `pnpm lint`
Expected: exit 0.

- [ ] **Step 16.5: Run format check**

Run: `pnpm format:check`
Expected: exit 0. If anything is unformatted, run `pnpm format` and commit the result.

- [ ] **Step 16.6: Verify all migrations apply to a fresh DB**

```bash
pnpm db:reset
```

Expected: drops the dev database, re-runs all migrations, runs the seed. Output ends with `Seeded athletes: ... ; meet: ...`.

- [ ] **Step 16.7: Final commit if anything was reformatted**

```bash
git status
# if anything changed:
git add -A
git commit -m "chore: format pass after foundation plan"
```

---

## Acceptance criteria for Plan 1

This plan is complete when:

- [ ] `pnpm install` from a fresh clone succeeds
- [ ] `pnpm dev:up` brings up Postgres + Redis
- [ ] `pnpm db:migrate` applies the schema cleanly to a fresh DB
- [ ] `pnpm db:seed` populates two demo athletes idempotently
- [ ] `pnpm test` passes in both `packages/db` and `packages/shared`
- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm format:check` passes
- [ ] ADR 0001 (hosting) is committed
- [ ] All work is in commits with conventional-commit-style messages on `main`

When all of the above are checked, hand back to the brainstorming/writing-plans flow to scope **Plan 2 — Spike + Workers** (the spike investigation followed by the BullMQ-driven Tier-4 scrape pipeline).
