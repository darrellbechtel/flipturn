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
