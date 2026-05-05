# ADR 0003 — Parser architecture: dispatch by URL, retry semantics, gender derivation

**Status:** Accepted
**Date:** 2026-05-04
**Deciders:** Darrell Bechtel
**Spec link:** [`docs/superpowers/specs/2026-05-04-flipturn-mvp-design.md`](../superpowers/specs/2026-05-04-flipturn-mvp-design.md)
**Builds on:** [ADR 0002 — SNC data source](./0002-snc-data-source.md)

## Context

ADR 0002 chose cheerio-on-static-HTML for SNC fetching. Plan 3 needed
to land three architectural details that ADR 0002 deferred:

1. How does the worker pipeline dispatch between athlete-page and meet-page parsers?
2. How does it react to HTTP 429 / `Retry-After` from Cloudflare?
3. How does it handle data the source page doesn't expose (most notably athlete gender)?

## Decisions

### 1. URL-classification dispatch

`apps/workers/src/url.ts` exposes `classifyUrl(fullUrl) → 'athlete' | 'meet' | 'unknown'`
based on host + path prefix:

- `www.swimming.ca/swimmer/*` → athlete
- `results.swimming.ca/*` → meet
- everything else → unknown (defensive fail-closed)

The worker's job processor decides which URL to fetch via `buildAthleteUrl`
or `buildMeetUrl`, then routes the response body to the matching parser.
The parser modules (`parser/athletePage.ts` and `parser/meetPage.ts`)
don't know about each other.

### 2. 429 / Retry-After handling

`politeFetch` parses the `Retry-After` header (RFC 7231: integer seconds OR HTTP-date),
clamps the resulting delay to `[60s, 24h]`, applies the delay to the host's
politeness key via `applyBackoff(redis, host, delayMs)`, and throws
`FetchRetryError`. BullMQ's existing retry config picks up the throw and re-runs
the job after its own exponential backoff — by which time the host's
politeness budget will block until `Retry-After` has elapsed.

Two layers stack here: BullMQ's job-level backoff and the politeness key's
host-level backoff. Both must clear before the next fetch.

The 60s minimum is a defensive floor: a server that says `Retry-After: 1`
is asking for trouble, not for politeness.

### 3. Gender derivation (revised after spike + implementation)

The athlete page does not expose athlete gender directly. The original plan
expected derivation from per-swim event headers like "Boys 100 Free", but
Plan 3 Task 3's implementation discovered that **SNC swimmer pages don't
prefix events with gender** — each row just says "100m Freestyle". The
implementer adapted by deriving gender from the bio text on the swimmer's
profile page (e.g. "Male Swimmer of the Year" → `'M'`).

If neither pathway yields a gender (e.g. an athlete with a sparse bio and
only mixed-gender relay entries), the field stays `null`.

This is best-effort, not authoritative. Plan 4 (parent onboarding) gives
the parent a chance to confirm or correct the value during athlete linking.

## Alternatives considered

- **Single combined parser** — one `parseSwimmingPage(body, hint)` function
  with internal branching. Rejected: the two parsers have entirely different
  selectors, error modes, and golden test fixtures. Composition over
  conditionals.

- **Retry inside `politeFetch`** — automatic retry-with-sleep within a
  single fetch. Rejected: ties up the BullMQ worker for the duration,
  prevents the host from being released to other jobs, and obscures the
  retry from the job-level retry config.

- **Inferring gender from the SNC ID** — SNC IDs are not gendered. Rejected.

## Consequences

- The parser interface is stable: athlete pages and meet pages produce
  `AthleteSnapshot` and `MeetSnapshot` respectively. Adding a third source
  (e.g. SwimCloud one-off lookups, or live results from TouchPadLive) is
  a new parser + a new URL classification, no upstream changes.
- 429 handling is correct but verbose: a job that hits a 429 will be
  retried by BullMQ up to its `attempts` limit. A WAF-mediated long block
  could fail the job permanently and dead-letter; manual recovery happens
  by re-enqueuing.
- Gender is an inference, not a fact. Future migrations should preserve
  the option of nullable gender; user-confirmed values must override the
  derived one.
