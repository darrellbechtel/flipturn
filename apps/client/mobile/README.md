# @flipturn/mobile

Expo / React Native client for the Flip Turn MVP. Five screens: email
entry, magic-link landing, onboarding, home, event detail.

See [`docs/superpowers/specs/2026-05-04-01-flipturn-mvp-design.md`](../../../docs/superpowers/specs/2026-05-04-01-flipturn-mvp-design.md) §8 for the screen specs and [`docs/adr/0005-mobile-architecture.md`](../../../docs/adr/0005-mobile-architecture.md) for the architecture decisions.

## Local development

The API must be running for the mobile app to do anything beyond render
auth screens. From the repo root:

```bash
pnpm dev:up # postgres + redis
pnpm api:dev # API on http://localhost:3000
```

Then in another terminal:

```bash
pnpm mobile:dev # Expo dev server with QR for Expo Go
```

If running on a physical device, set `EXPO_PUBLIC_API_BASE_URL` to your
Mac's LAN IP (e.g. `http://192.168.1.42:3000`) — `localhost` doesn't
resolve on the device.

## Screens

1. **Email entry** — single email field, magic-link request
2. **Magic-link landing** — handles `flipturn://auth?token=…` deep link, consumes token, stores session
3. **Onboarding** — SNC athlete ID input, polls for first scrape result
4. **Home** — athlete switcher (top), PB list grouped by stroke
5. **Event detail** — line-chart progression + swim history list

## Architecture

- `app/` — expo-router file-based routes
- `api/` — fetch wrapper + React Query hooks
- `auth/` — session storage (SecureStore) + AuthProvider context
- `theme/` — colors, spacing, typography tokens
- `components/` — RN components shared across screens
- `lib/` — utilities (env, time formatting)
- `tests/` — Vitest unit tests (no RN component tests in MVP)
