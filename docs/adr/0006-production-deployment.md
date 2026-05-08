# ADR 0006 — Production deployment: pm2 + Cloudflare Tunnel + Resend on flipturn.ca

**Status:** Accepted
**Date:** 2026-05-07
**Deciders:** Darrell Bechtel
**Builds on:** [ADR 0001](./0001-mvp-hosting.md), [ADR 0004](./0004-auth-design.md)
**Spec link:** [Plan 6 — `2026-05-05-03-flipturn-mvp-hosting.md`](../superpowers/plans/2026-05-05-03-flipturn-mvp-hosting.md)

## Context

Plan 6 takes the locally-functional MVP (Plans 1–5) to a closed-beta-shippable
state. The hosting strategy was set in ADR 0001 (Mac Mini + Cloudflare Tunnel)
but the operational details were deferred. This ADR captures them as they
landed.

## Decisions

### 1. Process supervision: pm2

Three processes run on the Mac Mini under pm2:

- **`flipturn-api`** — Hono HTTP server on port 3000 (`tsx apps/server/api/src/index.ts`)
- **`flipturn-workers`** — BullMQ worker process (`tsx apps/server/workers/src/index.ts`)
- **`flipturn-tunnel`** — `cloudflared tunnel run flipturn-prod`

pm2 handles crash-restart, log rotation (`~/.pm2/logs/`), and `pm2 startup` for
boot auto-start. Memory ceiling at `max_memory_restart: 512M` prevents runaway
processes. PR #22 fixed an earlier mistake of supervising the `pnpm` shim
instead of `tsx` directly — that lost SIGTERM propagation and caused zombie
children on `pm2 reload`.

**Alternatives:** launchd (native macOS) would also work but pm2 produces
nicer logs and is more familiar across teams.

### 2. Public ingress: Cloudflare Tunnel (named)

`api.flipturn.ca` resolves to a Cloudflare Tunnel pointing at `localhost:3000`.
Tunnel name `flipturn-prod`, UUID `1431a0f0-ad42-43a7-a435-c5fa44a28a71`,
deploy user `hank` on the Mac Mini. Credentials JSON lives at
`/Users/hank/.cloudflared/<UUID>.json` (NOT committed). UUID + credentials
path are baked into `infra/cloudflared/config.yml` for reproducible deploys.

Benefits:

- No port forwarding on the home router
- TLS terminated at Cloudflare (free wildcard cert)
- DDoS protection at the edge
- Stable URL even if the Mac Mini's residential IP rotates

**Alternative:** Tailscale Funnel works but ties beta users to a Tailscale-
hosted ingress. Cloudflare is more standard.

### 3. Email delivery: Resend on a verified `flipturn.ca`

`flipturn.ca` is verified with Resend (SPF + DKIM + SPF MX aligned; DMARC
optional and `p=none` for now). Magic-link emails come from
`noreply@flipturn.ca`. Free tier (3000/month, 100/day) covers closed beta
comfortably.

DNS records live on the Cloudflare DNS panel for `flipturn.ca` (Cloudflare
also being the registrar). All four records are **DNS only** (gray cloud) —
mail records must not be proxied.

**Alternative:** Postmark has slightly better delivery reputation but is
priced higher; defer until delivery becomes a problem.

### 4. Magic-link delivery: `flipturn://` scheme during closed beta, Universal Links once first EAS build is shipped

The magic-link email body uses `flipturn://auth?token=…` while we're testing
in Expo Go and the first dev EAS build. Once a real iOS / Android dev build
is installed on the founder's device, `MOBILE_DEEP_LINK_BASE` flips to
`https://flipturn.ca/auth` and the email body uses an `https://` URL. iOS
Universal Links and Android App Links route the URL to the installed app;
if the app isn't installed, the URL opens in the browser (graceful fallback).

`apple-app-site-association` and `assetlinks.json` are served by the API at
`/.well-known/`. They are gated on two env vars
(`IOS_APP_TEAM_ID`, `ANDROID_APP_SHA256`) populated from the first EAS build's
output — the routes return 404 until those values land in `secrets.env`.

### 5. Distribution: TestFlight (iOS) + EAS internal links (Android)

Closed-beta testers install via:

- **iOS:** TestFlight (requires Apple Developer Program — $99/yr, already paid)
- **Android:** EAS internal-link APK download (no Play Store fee)

EAS Build profiles (`development` / `preview` / `production`) live in
`apps/client/mobile/eas.json`. Production profile pins
`EXPO_PUBLIC_API_BASE_URL=https://api.flipturn.ca` and auto-increments
build numbers.

Public store submission is post-MVP.

### 6. Observability

- **Sentry** captures unhandled errors in API + workers (DSN per service in
  `secrets.env`; capture wired in `apps/server/api/src/middleware/error.ts`
  and `apps/server/workers/src/index.ts`)
- **pino** structured logs flow to `~/.pm2/logs/flipturn-{api,workers,tunnel}-*.log`
- **Worker heartbeat** in Redis (`workers:heartbeat`, 90s TTL) — staleness
  should alert; for MVP, manual `redis-cli GET workers:heartbeat` check is
  acceptable
- **Health endpoint** `/v1/health` pings DB and Redis with a 1s timeout each;
  used by Cloudflare's health checks via the tunnel

### 7. Unattended boot recovery (single-tenant residential)

A power-outage cycle should bring `api.flipturn.ca` back without anyone
touching the Mac Mini. The chain (documented in `infra/README.md`):

1. Power-on → disk auto-decrypts (FileVault off — single-tenant only)
2. macOS auto-login (no password prompt)
3. User-level `launchd` runs `pm2 resurrect` → api / workers / tunnel
4. OrbStack auto-starts at login → docker daemon up
5. Postgres + Redis come back via `restart: unless-stopped` in `compose.dev.yaml`

Recovery is ~60s from power-on to public health 200, no human required.

The security trade-off (FileVault off + auto-login) is documented in the
runbook with the explicit threat-model boundary: this configuration is
acceptable only for single-tenant residential deploys; do not replicate on
multi-user or office hosts.

## Alternatives considered (broader)

- **Cloud-hosted backend (Fly.io / Railway / AWS):** would simplify scaling
  but costs ~$30–60/mo, and the MVP doesn't need it. Mac Mini is free given
  it's already always-on. Migration path is clean — the architecture doesn't
  depend on the host.
- **Push notifications via Expo Push Service:** out of scope for MVP. Plan 7
  candidate.

## Consequences

- The Mac Mini is a single point of failure. If it powers off and doesn't
  auto-recover, the closed beta is offline. Acceptable for 10–20 testers;
  re-evaluate at scale.
- `~/.config/flipturn/secrets.env` is the production config. It must be
  backed up (encrypted) separately from the repo. The repo never holds
  production secrets.
- Cloudflare account dependency: if the Cloudflare account is suspended,
  ingress breaks. Mitigation: keep the account healthy and low-risk.
- Resend free-tier rate limit (3000/mo) is fine for closed beta but a
  future onboarding spike would hit it. Plan 7 monitors and upgrades or
  migrates.
- Hardcoded Postgres password (`flipturn_dev` in committed `compose.dev.yaml`)
  is a known closed-beta-only compromise. The security boundary is
  "Postgres only listens on `localhost`, never proxied through Cloudflare
  Tunnel" — not password secrecy. Pre-public-launch follow-up: random
  per-host password sourced from the secrets file.

## Risks

- **Cloudflare 403 on `www.swimming.ca`** — checked from the Mac Mini's
  residential IP in Plan 6 Task 13. Fallback runbook lives in
  `infra/README.md` ("Cloudflare 403 fallback" section); options ladder
  from "wait it out" → slower scrape rate → residential proxy → manual
  fixture import → SNC partnership conversation.
- **DNS propagation** for SPF / DKIM / DMARC was instant in our case
  (verified in <1 minute) but can take up to 48 hours on other registrars.
- **Apple Developer enrollment** is a recurring renewal; calendar reminder
  set for the next one.
