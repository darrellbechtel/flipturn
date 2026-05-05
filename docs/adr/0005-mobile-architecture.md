# ADR 0005 — Mobile architecture: Expo + expo-router + React Query

**Status:** Accepted
**Date:** 2026-05-05
**Deciders:** Darrell Bechtel
**Spec link:** [`docs/superpowers/specs/2026-05-04-01-flipturn-mvp-design.md`](../superpowers/specs/2026-05-04-01-flipturn-mvp-design.md)

## Context

Plan 5 needed to ship five MVP screens (email entry, magic-link landing,
onboarding, home, event detail) on iOS and Android via the Expo managed
workflow. Three architectural choices needed pinning down: routing, server
state, and the chart library.

## Decisions

### 1. Routing — `expo-router` (file-based)

`expo-router` v4 with the file system at `apps/client/mobile/app/` defines
the route tree. Auth-gated routes live under `(app)/` and unauthenticated
routes under `(auth)/`. The `app/index.tsx` redirector consults
`AuthProvider` and dispatches to the right group.

Alternatives:

- React Navigation directly: more boilerplate; expo-router is built on
  top of it anyway.
- Manual screen switching in a single root component: doesn't compose
  with deep links cleanly.

### 2. Server state — React Query

`@tanstack/react-query` v5 wraps every API call. Hooks in
`apps/client/mobile/api/queries.ts` expose `useAthletes`, `useSwims`,
`usePersonalBests`, `useProgression`, `useOnboardAthlete`, `useUnlinkAthlete`.

Why:

- The onboarding flow needs polling-until-scraped; React Query's
  `invalidateQueries` from a `setInterval` is the simplest fit.
- Caching across screens: `useAthletes` on home and on event detail
  share the same cache.
- Stale-while-revalidate by default; UX feels snappier.

### 3. Chart library — custom `react-native-svg` chart

Spec §8 floated `victory-native` or `react-native-svg-charts`. We pinned
neither — instead a small custom component (`ProgressionChart`) draws the
line + dots directly with `react-native-svg`.

Why:

- The chart in MVP is one screen, one shape, no interaction. ~80 lines.
- `victory-native@40` requires Skia + Reanimated and adds ~5MB to the
  bundle for features we don't use (animations, multi-series, gestures).
- `react-native-svg-charts` is in maintenance mode.

If Plan 6 adds time-standard overlays or multi-event compare views, that's
the right time to swap in a real chart library.

### 4. Session storage — `expo-secure-store`

DB-backed sessions on the server; the client only stores the bearer token.
`expo-secure-store` uses Keychain on iOS and Keystore on Android. Tests
inject a Map-backed fake via `__setSecureStoreFakeForTests`.

### 5. UI — vanilla `StyleSheet` + design tokens

No NativeWind, no React Native Paper, no Tamagui. The five screens are
simple enough that the indirection cost of a UI kit isn't justified.
Tokens live in `apps/client/mobile/theme/` and are imported wherever
needed.

If Plan 6 adds a designer pass, NativeWind would be a reasonable upgrade
path (preserves StyleSheet semantics).

### 6. Testing — Vitest unit tests for non-RN code; manual QA for screens

Per design spec §10.2: "apps/mobile: Manual QA only in closed beta — no
Detox/Maestro for MVP." Plan 5 follows that. Vitest covers the API client,
session storage, and format re-exports. Plan 6 may add Maestro flows
ahead of public launch.

## Alternatives considered

- **Bare React Native** — too much config overhead; Expo managed workflow
  is fine for MVP and lets EAS handle iOS provisioning + Android signing
  in Plan 6.
- **Web/PWA build** — `expo start --web` works for dev but isn't a
  release target. Spec brief calls this a stretch; defer.
- **Tamagui** — modern, fast, type-safe styling. But the build complexity
  is real and the team isn't using it elsewhere. Defer to a future
  designer pass.

## Consequences

- The `app/index.tsx` auth gate is the single source of "where does the
  user land?" logic. New auth states (e.g. "session expired" vs "never
  signed in") plug in there.
- Polling on onboarding is hand-rolled with `setInterval`. If Plan 6 adds
  more polling-style flows (live-results, scrape progress), consider a
  shared `usePolling(query, predicate)` hook.
- The `EXPO_PUBLIC_API_BASE_URL` indirection means a single build can
  point at dev or beta backends by changing the bundled env var. EAS will
  build separate variants for staging vs production in Plan 6.

## Risks

- Expo SDK upgrades (annual, breaking) — pin SDK 52 for MVP; bump in a
  dedicated PR with native rebuild + smoke test.
- React Native New Architecture is on by default in SDK 52; some
  libraries lag. We use only Expo-blessed modules to minimize risk.
- The custom progression chart is fine for one event; if it grows to N
  series, the design wasn't built for that. Re-evaluate before adding
  features.
