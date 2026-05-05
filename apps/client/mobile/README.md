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

## Brand assets

Plan 6 ships placeholder icons (white "F" wordmark on navy `#1F3D5C`).
Final designer-built mark with maple-leaf + swimmer + waves silhouette
ships post-MVP. To replace:

1. Get final 1024×1024 PNGs (icon, adaptive-icon foreground) and 1284×2778
   portrait splash from the designer.
2. Drop into `apps/client/mobile/assets/`, overwriting the placeholders.
3. Re-build via EAS: `npx eas-cli build --profile development --platform all`.

## Demo mode (instant sign-in with pre-populated data)

For a quick first look without going through the magic-link round-trip
or waiting for a live scrape, run the fixture seeder:

```bash
pnpm dev:up                  # postgres + redis
pnpm db:reset                # fresh DB (optional but cleaner)
pnpm api:dev                 # API in another terminal
pnpm mobile:dev              # Expo dev server in another terminal
pnpm db:seed-fixture         # parses Cochrane fixture, creates demo user, prints sign-in deep link
```

The seeder:

- Parses the captured Ryan Cochrane fixture and reconciles 39 swims + 33 PBs into the DB
- Creates a `demo@flipturn.local` user and links it to Cochrane
- Mints a fresh single-use magic-link token (15-minute TTL) and prints the deep link

Open the printed `flipturn://auth?token=…` URL on your simulator/device:

- iOS Simulator: `xcrun simctl openurl booted "flipturn://auth?token=…"`
- Android emulator: `adb shell am start -W -a android.intent.action.VIEW -d "flipturn://auth?token=…"`
- Physical iPhone with Expo Go: paste into Notes, tap, accept the redirect

The home screen will show Cochrane's PBs grouped by stroke; tap any PB to see the progression chart and swim history. Re-run `pnpm db:seed-fixture` any time to mint a fresh sign-in token.

Demo mode bypasses both the magic-link email round-trip and the worker scrape pipeline (which can hit Cloudflare 403s from non-residential IPs). Plan 6 hardens the live auth and scrape flows for the closed beta.

## Manual smoke testing (live magic-link flow)

If you want to exercise the actual magic-link flow rather than the demo seeder:

Without a Resend API key, the API uses an in-memory email sender — magic-link
emails are captured in process memory and not actually sent. To complete the
sign-in flow during local dev:

1. Briefly add `console.log('magic-link token:', tokenPlain)` to
   `apps/server/api/src/routes/auth.ts` inside the magic-link/request handler.
2. Restart the API: `pnpm api:dev`.
3. In the app, request a magic link.
4. Copy the token from the API logs.
5. Open the deep link manually:
   - iOS sim: `xcrun simctl openurl booted "flipturn://auth?token=<paste>"`
   - Android emulator: `adb shell am start -a android.intent.action.VIEW -d "flipturn://auth?token=<paste>"`

The mobile app will consume the token and sign you in.

This workaround is dev-only — Plan 6 wires up real Resend delivery for the
closed beta.
