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
