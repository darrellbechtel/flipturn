# ADR 0001 — MVP hosting: Mac Mini + docker compose + pm2 + Cloudflare Tunnel

**Status:** Accepted
**Date:** 2026-05-04
**Deciders:** Darrell Bechtel
**Spec link:** [`docs/superpowers/specs/2026-05-04-01-flipturn-mvp-design.md`](../superpowers/specs/2026-05-04-01-flipturn-mvp-design.md)

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
