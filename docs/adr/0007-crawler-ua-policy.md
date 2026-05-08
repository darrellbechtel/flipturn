# ADR 0007 — Crawler User-Agent policy: browser UA + From: header

**Status:** Proposed
**Date:** 2026-05-08
**Deciders:** Darrell Bechtel
**Spec links:**
- [`docs/superpowers/specs/2026-05-08-01-athlete-search-index-design.md`](../superpowers/specs/2026-05-08-01-athlete-search-index-design.md) — original "transparent identifiable bot UA" stance
- [`docs/superpowers/specs/2026-05-08-03-data-substrate-transition.md`](../superpowers/specs/2026-05-08-03-data-substrate-transition.md) — strategic roadmap; this ADR records the Phase 0 values trade-off
- [`docs/adr/0002-snc-data-source.md`](./0002-snc-data-source.md) — earlier UA decision this supersedes

## Context

The athlete-search v2 implementation (PR #44 on `darrellbechtel/feat/athlete-search-impl`) shipped a working priority-warmer end-to-end. Smoke testing the wired warmer revealed that `swimming.ca/?s=<query>` returns:

- HTTP **403** for `User-Agent: FlipTurnBot/0.1 (+https://flipturn.ca/bot; contact@flipturn.ca)` (the identifiable UA from ADR 0002).
- HTTP **200** for a current desktop Chrome / Safari User-Agent.

This is a Cloudflare WAF rule that treats identifiable bot UAs as a block heuristic. The volume is low (≤ a few thousand requests / day, jittered, evening window), well below any reasonable burden threshold — but the WAF doesn't see volume, it sees the UA string and decides.

The original spec at `2026-05-08-01-athlete-search-index-design.md:144` committed to:

> No User-Agent rotation. We send a static, identifiable User-Agent that names Flipturn and a contact URL. Goal is not to evade detection; it is to not trip naive heuristics while remaining transparent about who we are.

The smoke test inverted the assumption underneath that quote. **Identifying as a bot IS the trip wire.** Continuing the crawler therefore requires a different transparency model — one that's adversarial to UA-based heuristics but retains operator-accessible identifying signals.

## Decision

**Send a static modern Safari User-Agent string. Retain transparency through a `From:` header instead of through the User-Agent.**

Concretely, on every outbound request from `politeFetch()`:

| Header           | Value                                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| `User-Agent`     | `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15` |
| `Accept`         | `text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8`                                            |
| `Accept-Language`| `en-CA,en;q=0.9,fr-CA;q=0.8`                                                                                 |
| `From`           | `flipturn-ops@flipturn.ca`                                                                                   |

The Safari UA is chosen over Chrome because it's stable across point releases (Chrome's version string changes monthly) and reduces the risk that a future crawler version drifts behind the real UA fleet.

## Why this is acceptable

1. **The data is already public.** `swimming.ca/?s=` and `/swimmer/<id>/` pages are served to any browser without authentication. No private data is being exfiltrated.
2. **Volume is low and jittered.** The existing `politeFetch` sampled-delay layer (1500–4000 ms inter-request, evening-only window) keeps load below any threshold a human-traffic-tuned WAF would care about.
3. **Transparency moves to `From:`.** RFC 9110 §10.1.2 defines `From:` as "an Internet email address for a human user who controls the requesting user agent." We use a role address (`flipturn-ops@flipturn.ca`) rather than personal email, but the intent is preserved: any operator inspecting the request can identify and contact us.
4. **`robots.txt` is still honored.** ADR 0002's robots check stays in force — we don't fetch any path matching a `Disallow:` for `User-agent: *`.
5. **Halt-on-contact.** If Swimming Canada or their hosting operator emails `flipturn-ops@flipturn.ca` asking us to stop, we comply immediately (within the same business day) and accelerate Phase 4 of the substrate roadmap (host-club `.hy3` ingestion) as the principled exit.

## Why this is uncomfortable

This is a values trade-off we are deliberately making, not a thing we like:

- **Browser UA is indistinguishable from organic traffic.** A naïve operator looking at access logs cannot easily separate Flipturn's traffic from a parent reading the same pages in their browser. The `From:` header is only inspectable to operators who know to look at request headers, not access logs.
- **The original spec's framing was idealistic.** "Stay openly identified, accept the consequences" is the cleaner stance. We are moving off it because the consequence (warmer fully blocked) is incompatible with shipping the closed-beta MVP, and the substrate-transition roadmap exists precisely so this isn't a permanent posture.

This ADR exists so the codebase doesn't silently say one thing (browser UA) while the design spec says another (transparent UA). Future readers can find the trade-off recorded here.

## Consequences

- `politeFetch()` gains a non-trivial header set. Tests must lock the `From:` header in (it is the only piece of transparency we still control; if it's accidentally removed, this whole ADR's justification collapses).
- The Phase 0 plan (`docs/superpowers/plans/2026-05-09-01-crawler-ua-unblock.md`) is the implementation slice for this decision.
- The original "transparent UA" line in `2026-05-08-01-athlete-search-index-design.md:144` should be amended to reference this ADR rather than carry the original wording forward unchanged.
- ADR 0002's User-Agent default (`FlipTurnBot/0.1 (+...)`) is **superseded** by this ADR for crawler use. Other contexts (e.g. internal admin CLIs, health checks, anything not pretending to be a parent reading swim results) should continue to identify themselves honestly.
- This ADR is reversed when Phase 4 of the substrate roadmap completes (i.e. `.hy3` ingestion is the dominant data path). At that point the crawler can either be retired (Phase 6) or revert to the identifiable UA — the WAF block becomes acceptable because the crawler is the gap-filler, not the primary path.

## Alternatives considered

- **Email Swimming Canada and ask for an allowlist.** Slow (days to weeks), might require a partnership conversation before the closed beta can ship. Worth doing in parallel — this ADR does not preclude it. If SNC responds with an allowlist, we revert to the identifiable UA and amend this ADR.
- **Rotate UAs across a fleet.** Unnecessary for our volume and crosses further into bot-evasion territory than is justified. Single static Safari UA is enough to dodge the heuristic without playing UA-rotation cat-and-mouse.
- **Add `X-Flipturn-Bot: true` as a custom header.** Operators who do header inspection would see it; WAFs would not. Considered redundant with the `From:` header — RFC standard wins over a custom header for operator interpretability.
- **Skip this and switch substrate now.** Tempting but premature: the substrate-transition roadmap (`2026-05-08-03-data-substrate-transition.md`) explicitly argues that we need a working crawler-fed MVP (Phase 1) and a credible public face (Phase 2) before Phase 3 outreach has any chance of producing a `.hy3`. Skipping Phase 0 means the crawler MVP doesn't ship, and the rest of the roadmap stalls.

## Risks

- **Swimming Canada formally objects.** Mitigation: `From:` header makes us findable; we comply and accelerate Phase 4. Recorded in roadmap §12.
- **`From:` header is silently dropped** (e.g. by a future refactor of `politeFetch`). Mitigation: regression test asserts the header is present on every request. Without that test, this whole ADR's transparency claim is vacuous.
- **WAF rule changes.** A future WAF tighten could block our Safari UA too. We rely on the same `429 → backoff` and Sentry-alerting path already in place; if the warmer starts failing systematically again, that's the trigger to re-evaluate (likely accelerating Phase 3 outreach rather than UA gymnastics).
- **This ADR is read as license for further posture drift.** Keep the scope tight: browser UA + `From:` header, nothing else. Captcha solving, IP rotation, residential proxies — all out of scope and would require a new ADR with a much higher bar.
