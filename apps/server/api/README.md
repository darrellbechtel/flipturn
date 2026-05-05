# @flipturn/api

Hono HTTP server for the Flip Turn MVP. Authenticates parents via magic-link
email and exposes athlete + swim + PB endpoints over a small JSON API.

## Local development

Requires the dev infra (Postgres + Redis) running:

```bash
pnpm dev:up
```

Then from the repo root:

```bash
pnpm api:dev      # tsx --watch
pnpm api:test     # run API tests
```

`RESEND_API_KEY` may be left blank in dev — the API falls back to an
`InMemoryEmailSender` that captures messages in process memory.

## Endpoints (v1)

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

- Hono v4 with `@hono/zod-validator` for request validation, reusing
  `packages/shared` schemas.
- Sessions are DB-backed (`Session` table); no JWTs.
- Magic-link emails via Resend, with an `InMemoryEmailSender` test fake.
- Onboarding enqueues a worker scrape via `enqueueScrapeAthlete` from
  `@flipturn/workers/queue`.

See [`docs/adr/0004-auth-design.md`](../../../docs/adr/0004-auth-design.md) for
the auth model details and [`docs/superpowers/specs/2026-05-04-01-flipturn-mvp-design.md`](../../../docs/superpowers/specs/2026-05-04-01-flipturn-mvp-design.md)
§7 for the full API surface.
