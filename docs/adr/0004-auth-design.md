# ADR 0004 — Auth design: magic-link email + DB sessions

**Status:** Accepted
**Date:** 2026-05-05
**Deciders:** Darrell Bechtel
**Spec link:** [`docs/superpowers/specs/2026-05-04-flipturn-mvp-design.md`](../superpowers/specs/2026-05-04-flipturn-mvp-design.md)

## Context

The Flip Turn MVP serves a closed beta of 10–20 swim parents. The data is
public (it's already on results.swimming.ca). The auth layer's job is to
identify which parent owns which athlete record for personalization, not
to protect secret data. Spec §9 chose magic-link email + long-lived sessions.

## Decisions

### 1. Magic-link tokens

- 32 random bytes from `crypto.randomBytes`, hex-encoded (64 chars)
- Hashed at rest with sha256; the plaintext lives only in the email
- TTL: 15 minutes from creation
- Single-use: `consumedAt` set on consume; subsequent attempts return 401
- Hard-deleted 24h after expiry by the workers scheduler (Plan 4 Task 9)

### 2. Sessions

- DB-backed (`Session` table from Plan 1's schema)
- 32 random bytes, hex-encoded, hashed at rest
- **No expiry in MVP**; sessions revoke only via `revokedAt` (manual ops or
  `DELETE /v1/me`)
- Plan 5+ may add session refresh / device list; out of scope for MVP

### 3. Email delivery

- Production: Resend (chosen for free tier + good DX). `EMAIL_FROM` is a
  configured envelope. The `noreply@flipturn.ca` placeholder will be
  replaced with the verified domain in Plan 6.
- Tests / dev without `RESEND_API_KEY`: `InMemoryEmailSender` captures
  messages on a per-process outbox so tests can extract magic-link tokens
  from the rendered HTML body.

### 4. Bearer token convention

- `Authorization: Bearer <sessionToken>` on every authenticated endpoint
- `parseBearerHeader` returns null on missing/malformed; the session
  middleware throws `401 unauthenticated` for both cases (intentionally
  uniform — don't leak whether a token is malformed vs invalid)

### 5. Hono error handling pattern

(Discovered during Plan 4 Task 5: Hono v4's middleware-based try/catch
doesn't catch errors thrown after `next()` resolves. Plan-4 standard is
`app.onError(errorHandler)` plus `r.onError(errorHandler)` on each
sub-app, with throwable `ApiError` classes carrying status + code.)

## Alternatives considered

- **JWT instead of DB sessions** — JWTs avoid the lookup but require key
  management, refresh tokens, and revocation lists. DB sessions are simpler
  and faster to invalidate (Plan 6 hosting work; matters more under load).
  Rejected for MVP.
- **OAuth (Google / Apple Sign In)** — Closer to user expectation on iOS,
  but complicates the same-day signup → onboard flow and adds platform-
  specific work. Plan 5 may revisit when Apple Sign In becomes mandatory
  for App Store submission.
- **Passwords** — Security cost is too high for the value (the data is
  public anyway), and password recovery requires email anyway. Rejected.

## Consequences

- Sessions don't expire, which means a leaked session token grants access
  until manually revoked. PIPEDA `DELETE /v1/me` covers user-initiated
  revocation; ops-side revocation is a manual `UPDATE Session SET revokedAt = NOW()`.
- The InMemoryEmailSender is the right test double, but if dev wants to
  see emails in the browser, a quick localhost mailcatcher could be added
  in Plan 6.
- Magic-link tokens are tied to a specific email (User row). If a parent
  changes email, they need to request a fresh link from the new address.

## Risks

- Resend's free tier has rate limits. Closed beta is well under them, but
  Plan 6 should monitor and have a Postmark / SES fallback.
- Email delivery is the auth primitive. If Gmail/Apple flag the sending
  domain, the entire system is unusable. Plan 6 should set up SPF/DKIM/DMARC
  on `flipturn.ca` before launch.
