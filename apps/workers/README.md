# @flipturn/workers

BullMQ-driven scrape pipeline for the Flip Turn MVP. Fetches athlete history from
public sources (Tier 4: results.swimming.ca), archives raw responses, parses to
normalized records, reconciles into Postgres, and recomputes per-athlete PBs.

## Local development

Requires the dev infra (Postgres + Redis) to be running:

```bash
pnpm dev:up
```

Then from the repo root:

```bash
pnpm --filter @flipturn/workers dev
```

## Architecture

See [`docs/superpowers/specs/2026-05-04-flipturn-mvp-design.md`](../../docs/superpowers/specs/2026-05-04-flipturn-mvp-design.md) §6 for the full worker design.

The pipeline is structured fetch-shape-agnostic so the spike's outcome (HTML vs.
JSON vs. Playwright) only affects the parser layer.

## Modules

- `env.ts` — zod-validated env vars
- `redis.ts` — ioredis singleton
- `queue.ts` — BullMQ queue + job type
- `politeness.ts` — Redis-backed token bucket, user-agent header, robots.txt cache
- `archive.ts` — raw artifact disk store under `data/raw/`
- `fetch.ts` — combines politeness + archive
- `parser/` — normalized record types + parser implementations
- `reconcile.ts` — idempotent DB upsert
- `personalBest.ts` — PB recompute
- `worker.ts` — pipeline: fetch → parse → reconcile → PB recompute
- `scheduler.ts` — daily cron enqueuer
- `heartbeat.ts` — Redis liveness key

## Current state (Plan 3)

This package ships the full scrape pipeline:

- BullMQ + Redis client + queue
- Politeness (token bucket, robots.txt cache, user-agent, **429/Retry-After backoff**)
- Raw artifact archive on disk
- Idempotent reconciler against Postgres (with snapshot-driven `dataSource`)
- PersonalBest recompute (single-query, DQ handling, idempotent)
- Daily scheduler via BullMQ repeatable jobs (with unit test)
- Heartbeat key in Redis
- **Real cheerio parsers** for `www.swimming.ca/swimmer/<id>/` and `results.swimming.ca/<slug>/`
- End-to-end integration test using captured fixtures

To enqueue a job manually for local testing:

```ts
import { enqueueScrapeAthlete } from './src/queue.js';
await enqueueScrapeAthlete({
  athleteId: '<some athlete id>',
  sncId: '4030816',
});
```

See [`docs/adr/0002-snc-data-source.md`](../../docs/adr/0002-snc-data-source.md)
and [`docs/adr/0003-parser-architecture.md`](../../docs/adr/0003-parser-architecture.md)
for the design decisions.
