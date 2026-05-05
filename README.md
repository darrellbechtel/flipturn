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

```bash
pnpm install
pnpm dev:up        # start postgres + redis in docker
pnpm db:migrate    # apply Prisma migrations
pnpm db:seed       # seed demo data
pnpm test          # run all tests
```

## Workers

Run the BullMQ scrape worker locally (after `pnpm dev:up` brings up Postgres + Redis):

```bash
pnpm workers:dev      # tsx --watch (auto-reloads on src changes)
pnpm workers:start    # one-shot run
pnpm workers:test     # run worker tests
```

Plan 2 ships a **stub parser** that returns hardcoded snapshots for `fixtureName="demo-sarah"` and `fixtureName="demo-benji"`. Plan 3 will replace it with the real `results.swimming.ca` parser based on ADR 0002.
