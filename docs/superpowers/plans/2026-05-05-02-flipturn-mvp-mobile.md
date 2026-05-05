# Flip Turn MVP — Mobile Plan (Plan 5 of 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Plan series:** This is plan 5 of 6 derived from [`docs/superpowers/specs/2026-05-04-01-flipturn-mvp-design.md`](../specs/2026-05-04-01-flipturn-mvp-design.md).

- ✅ Plan 1 — Foundation (monorepo + db + shared) — landed
- ✅ Plan 2 — Spike + Worker infrastructure with stub parser — landed
- ✅ Plan 3 — Real parser + integration — landed
- ✅ Plan 4 — API (Hono + magic-link auth + endpoints) — landed
- **Plan 5 — Mobile (this plan)**
- Plan 6 — Hosting + closed-beta launch

**Goal:** Stand up `apps/client/mobile/` as an Expo + React Native app implementing the five MVP screens from spec §8: email entry, magic-link landing, onboarding, home (athlete switcher + PB list), and event detail (progression chart + swim history). After this plan, a parent on iOS or Android can install via TestFlight / Expo internal links, sign in via magic-link email, onboard their kid by SNC ID, and view their swim data.

**Architecture:**

- Expo SDK with managed workflow (no bare React Native)
- `expo-router` for file-based routing
- `expo-linking` for the magic-link deep link (`flipturn://auth?token=...`)
- `expo-secure-store` for session token persistence
- `@tanstack/react-query` for server-state caching, polling, and stale-while-revalidate
- `react-native-svg` for the progression chart (small custom impl; no heavyweight chart library in MVP)
- Plain `fetch` wrapped behind a typed API client; no axios/ky
- Vanilla `StyleSheet` with shared design tokens (colors from PROJECT_BRIEF.md branding palette); no NativeWind/Tailwind in MVP
- Plain unit tests via Vitest for non-RN code (api client, session helpers, time formatters re-exported from `@flipturn/shared`); RN component testing deferred per design spec §10.2

**Tech Stack:** Expo SDK 52, expo-router 4, React 18, React Native 0.76, React Query 5, react-native-svg 15, TypeScript 5.6+, Vitest 2.x for unit tests.

**Recommended execution:** Use `superpowers:subagent-driven-development` with `model: "opus"` per the project's preference.

---

## Context the implementer needs

### Brand palette (from PROJECT_BRIEF.md)

- Primary red: `#C8332D` (maple leaf)
- Primary navy: `#1F3D5C` (wordmark / primary buttons)
- Wave teal-blue gradient: `#2A9DA6` → `#1F3D5C` (background accent)
- Neutral grays: standard 50/100/200/.../900 scale

The design has to be Canadian, athletic, not childish, not corporate-cold. Closed-beta UX target: functional, readable, fast — not polished. Plan 6 may add a designer pass.

### API surface to consume (Plan 4)

All endpoints under `/v1`. Response shapes are zod-validated by `@flipturn/shared`'s `*DtoSchema` exports.

```
POST   /v1/auth/magic-link/request   { email }                      → 202
POST   /v1/auth/magic-link/consume   { token }                      → { sessionToken }
GET    /v1/auth/me                                                  → { user, athletes }
POST   /v1/athletes/onboard          { sncId, relationship? }       → { athlete }
GET    /v1/athletes                                                 → { athletes }
DELETE /v1/user-athletes/:id                                        → 204
GET    /v1/athletes/:id/swims?eventKey=&limit=&cursor=             → { swims, nextCursor }
GET    /v1/athletes/:id/personal-bests                              → { personalBests }
GET    /v1/athletes/:id/progression?eventKey=                       → { points }
GET    /v1/health                                                   → { db, redis }
DELETE /v1/me                                                       → 204
```

All authenticated endpoints require `Authorization: Bearer <sessionToken>`.

Plan 4's review surfaced these data-shape facts the mobile must handle:

- `gender`, `homeClub`, `lastScrapedAt` may be `null` (DTOs are `.nullable().optional()`)
- `swamAt` is `meet.startDate.toISOString()` — proper race date, not the scrape time
- Onboarding creates an `Athlete` with `primaryName: "Pending scrape"` until the worker fills it in. The mobile UI should poll until `lastScrapedAt !== null` (or a timeout, ~60s) and show a "Loading…" state in the meantime.

### Deep-link configuration

The API's magic-link email body contains `flipturn://auth?token=<plain-token>`. Expo's app config must register `flipturn` as the URL scheme. `expo-linking` handles parsing.

For dev, deep links also need to work with the Expo Go scheme (`exp://...`). expo-router handles this via the same routing config.

### API base URL configuration

The mobile app reads `EXPO_PUBLIC_API_BASE_URL` from `.env` / app config. Defaults:

| Environment                 | Value                                                        |
| --------------------------- | ------------------------------------------------------------ |
| Local dev (simulator)       | `http://localhost:3000`                                      |
| Local dev (physical device) | `http://<mac-LAN-IP>:3000` (e.g. `http://192.168.1.42:3000`) |
| Closed beta                 | Cloudflare Tunnel public URL (set in Plan 6)                 |

The build must read this at compile time (`EXPO_PUBLIC_*` is the standard prefix Expo exposes to client code).

### Out of scope (deferred)

- Push notifications — already deferred to a future spec (PB alerts)
- Multi-meet split analysis view
- Time-standard tracking (AAA / Provincial / National progress bars)
- Family dashboard view (multi-athlete side-by-side)
- Live results
- Video features
- Kid mode / kid-facing UI
- Web/PWA build (`expo start --web` works for dev but is not a release target in MVP)
- App Store + Play Store submission (Plan 6 covers TestFlight / Expo internal links only)
- Designer-led visual polish (Plan 6+)
- Detox/Maestro automated UI testing (deferred per spec §10.2)

---

## File map (created by this plan)

```
apps/client/mobile/
├── package.json
├── tsconfig.json
├── app.json
├── babel.config.js
├── metro.config.js
├── README.md
├── .env.example
├── .gitignore                            (entries specific to Expo build artifacts)
├── app/                                   (expo-router routes)
│   ├── _layout.tsx                       (root layout: providers + nav stack)
│   ├── index.tsx                          (auth gate redirector)
│   ├── (auth)/
│   │   ├── _layout.tsx
│   │   ├── email-entry.tsx
│   │   └── magic-link.tsx                (consumes ?token=)
│   └── (app)/
│       ├── _layout.tsx                   (authenticated route group)
│       ├── home.tsx
│       ├── onboarding.tsx
│       └── event/
│           └── [eventKey].tsx            (progression chart)
├── api/
│   ├── client.ts                          (fetch wrapper)
│   ├── auth.ts                            (magic-link request/consume)
│   ├── athletes.ts                        (onboard, list, swims, PBs, progression)
│   └── queries.ts                         (React Query hooks)
├── auth/
│   ├── session.ts                         (SecureStore wrapper)
│   └── AuthProvider.tsx                   (React context)
├── theme/
│   ├── colors.ts
│   ├── spacing.ts
│   └── typography.ts
├── components/
│   ├── Button.tsx
│   ├── TextField.tsx
│   ├── Screen.tsx                         (layout container)
│   ├── Loading.tsx
│   ├── ErrorMessage.tsx
│   ├── PBListItem.tsx
│   └── ProgressionChart.tsx               (custom react-native-svg chart)
├── lib/
│   ├── env.ts                             (reads EXPO_PUBLIC_*)
│   └── format.ts                          (re-exports formatSwimTime, etc.)
└── tests/
    ├── setup.ts                           (env loading; pattern matches workers/api)
    ├── api/
    │   ├── client.test.ts
    │   └── auth.test.ts
    ├── auth/
    │   └── session.test.ts
    └── lib/
        └── format.test.ts

docs/adr/0005-mobile-architecture.md      (CREATE)
```

The `apps/client/` parent directory is created here for the first time (Plan 1's structure had `apps/server/*` only after Plan 4's restructure). The `apps/client/mobile` package is a sibling to `apps/server/api` and `apps/server/workers`.

---

## Task 1: Scaffold `apps/client/mobile`

**Files:**

- Create: `apps/client/mobile/package.json`
- Create: `apps/client/mobile/tsconfig.json`
- Create: `apps/client/mobile/app.json`
- Create: `apps/client/mobile/babel.config.js`
- Create: `apps/client/mobile/metro.config.js`
- Create: `apps/client/mobile/.gitignore`
- Create: `apps/client/mobile/.env.example`
- Create: `apps/client/mobile/README.md`
- Create: `apps/client/mobile/app/_layout.tsx` (placeholder)
- Create: `apps/client/mobile/app/index.tsx` (placeholder)
- Modify: root `package.json` — add `mobile:dev`, `mobile:start`, `mobile:test` scripts
- Modify: `pnpm-workspace.yaml` — already covers `apps/*/*` from Plan 4 PR; verify no change needed

### Step 1.1: Create `apps/client/mobile/package.json`

```json
{
  "name": "@flipturn/mobile",
  "version": "0.0.0",
  "private": true,
  "main": "expo-router/entry",
  "scripts": {
    "start": "expo start",
    "ios": "expo start --ios",
    "android": "expo start --android",
    "tunnel": "expo start --tunnel",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@flipturn/shared": "workspace:*",
    "@tanstack/react-query": "^5.59.0",
    "expo": "~52.0.0",
    "expo-constants": "~17.0.0",
    "expo-linking": "~7.0.0",
    "expo-router": "~4.0.0",
    "expo-secure-store": "~14.0.0",
    "expo-status-bar": "~2.0.0",
    "react": "18.3.1",
    "react-native": "0.76.0",
    "react-native-gesture-handler": "~2.20.0",
    "react-native-reanimated": "~3.16.0",
    "react-native-safe-area-context": "~4.12.0",
    "react-native-screens": "~4.0.0",
    "react-native-svg": "15.8.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@babel/core": "^7.25.0",
    "@types/react": "~18.3.0",
    "typescript": "^5.6.3",
    "vitest": "^2.1.2"
  }
}
```

NOTE: Expo SDK 52 ships with React Native 0.76 (the New Architecture is on by default). Pin versions to exactly what Expo SDK 52 expects; mismatches cause runtime crashes. If `expo doctor` reports version mismatches after install, accept its recommendations.

### Step 1.2: Create `apps/client/mobile/tsconfig.json`

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": ".",
    "types": ["react", "react-native"],
    "jsx": "react-native",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"]
  },
  "include": ["app/**/*", "api/**/*", "auth/**/*", "components/**/*", "lib/**/*", "theme/**/*"],
  "exclude": ["dist", "node_modules", "tests", ".expo"]
}
```

NOTE: `lib: ["ES2022", "DOM"]` is needed because RN ships some web globals (URL, fetch) that the TS compiler picks up from DOM types. The base config has `lib: ["ES2022"]` only.

### Step 1.3: Create `apps/client/mobile/app.json`

```json
{
  "expo": {
    "name": "Flip Turn",
    "slug": "flipturn-mobile",
    "version": "0.1.0",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "scheme": "flipturn",
    "userInterfaceStyle": "automatic",
    "newArchEnabled": true,
    "splash": {
      "image": "./assets/splash.png",
      "resizeMode": "contain",
      "backgroundColor": "#1F3D5C"
    },
    "ios": {
      "supportsTablet": false,
      "bundleIdentifier": "app.flipturn.mobile"
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#1F3D5C"
      },
      "package": "app.flipturn.mobile"
    },
    "plugins": ["expo-router", "expo-secure-store"],
    "experiments": {
      "typedRoutes": true
    },
    "extra": {
      "eas": {
        "projectId": "TBD-set-during-eas-init"
      }
    }
  }
}
```

NOTE: The `assets/icon.png`, `assets/splash.png`, `assets/adaptive-icon.png` files don't exist yet. Either create placeholders (1024×1024 PNGs of a solid `#1F3D5C` square) or remove the keys from `app.json` for now. Recommended: create placeholder solid-color PNGs so `expo start` doesn't error. A 1×1 PNG that the bundler upscales is fine for dev. Real branded icons come in Plan 6.

### Step 1.4: Create `apps/client/mobile/babel.config.js`

```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // react-native-reanimated/plugin must be last
      'react-native-reanimated/plugin',
    ],
  };
};
```

### Step 1.5: Create `apps/client/mobile/metro.config.js`

```js
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

// Find the project and workspace directories
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch all files within the monorepo
config.watchFolders = [workspaceRoot];
// 2. Let Metro know where to resolve packages and in what order
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// 3. Force Metro to resolve (sub)dependencies only from `nodeModulesPaths`
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
```

This is the standard pnpm-workspace Metro config. Without it, Metro can't find symlinked packages.

### Step 1.6: Create `apps/client/mobile/.gitignore`

```
# Expo
.expo/
.expo-shared/
dist/
web-build/

# Native build outputs (managed workflow generates these in dev)
ios/
android/

# Build secrets / EAS
.easignore
secrets.json

# Misc
*.log
node_modules/
```

### Step 1.7: Create `apps/client/mobile/.env.example`

```
# Mobile (apps/client/mobile)
# All EXPO_PUBLIC_* vars are bundled into the app at build time and visible in DevTools.
# Do NOT put secrets here.

EXPO_PUBLIC_API_BASE_URL="http://localhost:3000"
```

### Step 1.8: Create `apps/client/mobile/README.md`

Use real triple-backticks in the file:

```markdown
# @flipturn/mobile

Expo / React Native client for the Flip Turn MVP. Five screens: email
entry, magic-link landing, onboarding, home, event detail.

See [`docs/superpowers/specs/2026-05-04-01-flipturn-mvp-design.md`](../../../docs/superpowers/specs/2026-05-04-01-flipturn-mvp-design.md) §8 for the screen specs and [`docs/adr/0005-mobile-architecture.md`](../../../docs/adr/0005-mobile-architecture.md) for the architecture decisions.

## Local development

The API must be running for the mobile app to do anything beyond render
auth screens. From the repo root:

\`\`\`bash
pnpm dev:up # postgres + redis
pnpm api:dev # API on http://localhost:3000
\`\`\`

Then in another terminal:

\`\`\`bash
pnpm mobile:dev # Expo dev server with QR for Expo Go
\`\`\`

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
```

### Step 1.9: Create placeholder route files

Create `apps/client/mobile/app/_layout.tsx`:

```tsx
import { Stack } from 'expo-router';

export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

Create `apps/client/mobile/app/index.tsx`:

```tsx
import { Text, View } from 'react-native';

export default function Index() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Text>Flip Turn — wiring in progress</Text>
    </View>
  );
}
```

### Step 1.10: Update root `package.json`

Read the current root `package.json`. In the `"scripts"` block, add three entries AFTER `api:test`:

```json
"mobile:dev": "pnpm --filter @flipturn/mobile start",
"mobile:start": "pnpm --filter @flipturn/mobile start",
"mobile:test": "pnpm --filter @flipturn/mobile test"
```

### Step 1.11: Verify `pnpm-workspace.yaml`

Read the current file. After Plan 4 PR's restructure, it should be:

```yaml
packages:
  - 'apps/*/*'
  - 'packages/*'
```

The `apps/*/*` glob already matches `apps/client/mobile`. No change needed.

### Step 1.12: Create placeholder asset PNGs

Three placeholder 1024×1024 solid-color PNGs for icon, splash, adaptive-icon. The simplest approach: write a small Node script that uses no extra deps. Or use `convert` if ImageMagick is installed. Or skip PNGs and remove those keys from `app.json`.

Recommended: write a tiny Python script (Python ships with macOS) to generate solid-color PNGs:

```bash
mkdir -p apps/client/mobile/assets
cat > /tmp/mkicon.py <<'EOF'
import struct, zlib
def png(w, h, color):
    sig = b'\x89PNG\r\n\x1a\n'
    def chunk(t, d):
        l = struct.pack('!I', len(d))
        c = struct.pack('!I', zlib.crc32(t + d))
        return l + t + d + c
    ihdr = chunk(b'IHDR', struct.pack('!IIBBBBB', w, h, 8, 2, 0, 0, 0))
    raw = b''
    for _ in range(h):
        raw += b'\x00' + (color * w)
    idat = chunk(b'IDAT', zlib.compress(raw))
    iend = chunk(b'IEND', b'')
    return sig + ihdr + idat + iend
import sys
out = png(1024, 1024, bytes.fromhex(sys.argv[2]))
open(sys.argv[1], 'wb').write(out)
EOF
python3 /tmp/mkicon.py apps/client/mobile/assets/icon.png 1F3D5C
python3 /tmp/mkicon.py apps/client/mobile/assets/splash.png 1F3D5C
python3 /tmp/mkicon.py apps/client/mobile/assets/adaptive-icon.png 1F3D5C
```

Verify: `ls -la apps/client/mobile/assets/`
Expected: three `.png` files, each ~1-3KB.

### Step 1.13: Install + verify

```bash
pnpm install
pnpm ls --filter @flipturn/mobile --depth -1
```

Expected: pnpm picks up `@flipturn/mobile@0.0.0` at `apps/client/mobile`. Adds ~300+ transitive packages (Expo's deps are large).

If `pnpm install` fails because of version mismatches between Expo's expected versions and the listed versions, run `pnpm dlx expo install --fix` from inside `apps/client/mobile/` to align them. Then re-run `pnpm install` at the root.

### Step 1.14: Smoke-test typecheck + format

```bash
pnpm --filter @flipturn/mobile typecheck
pnpm format:check
pnpm lint
```

All exit 0. Note: Expo's `tsconfig` and the global ESLint config may not yet recognize all RN-specific patterns — add overrides in `eslint.config.js` if needed (likely just an `ignores` entry for `apps/client/mobile/.expo/**`).

If lint fails with React/RN-specific complaints, add to root `eslint.config.js`:

```js
{
  files: ['apps/client/mobile/**/*.{ts,tsx}'],
  rules: {
    // React Native code uses JSX; loosen any rule that complains about it
    '@typescript-eslint/no-explicit-any': 'warn',
  },
},
```

Or extend with `eslint-plugin-react-native` later if needed.

### Step 1.15: Smoke-test Expo dev server (optional)

```bash
cd apps/client/mobile
pnpm start
```

Expected: Expo prints a QR code and waits. The placeholder route at `app/index.tsx` should render "Flip Turn — wiring in progress" if you scan it with Expo Go on a device. Hit `Ctrl-C` to stop.

If `pnpm start` crashes complaining about missing native modules, check that `metro.config.js` is correct and `pnpm install` completed without errors.

This step is optional — the test gate doesn't require it. But running it once confirms the dev server boots.

### Step 1.16: Commit

```bash
git add apps/client/mobile package.json pnpm-lock.yaml
git commit -m "feat(mobile): scaffold @flipturn/mobile Expo package"
```

Use exactly that commit message.

## Self-Review

- All scaffolding files exist with the correct content
- Three placeholder PNG assets exist
- Root `package.json` has the three new scripts
- `pnpm install` succeeded
- Typecheck passes
- Format check passes
- Lint passes (with any necessary mobile-specific overrides added to root config)
- Commit message exact

## Report Format

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- What you created
- Output of `pnpm install` summary, `pnpm --filter @flipturn/mobile typecheck`
- Files in commit
- Self-review findings
- Commit SHA

---

## Task 2: Theme tokens

**Files:**

- Create: `apps/client/mobile/theme/colors.ts`
- Create: `apps/client/mobile/theme/spacing.ts`
- Create: `apps/client/mobile/theme/typography.ts`
- Create: `apps/client/mobile/theme/index.ts`

These are tiny modules — pure data, no logic. No tests; consumed by every component.

### Step 2.1: Create `apps/client/mobile/theme/colors.ts`

```ts
export const colors = {
  // Brand
  red: '#C8332D',
  navy: '#1F3D5C',
  teal: '#2A9DA6',

  // Neutrals
  white: '#FFFFFF',
  gray50: '#F8FAFC',
  gray100: '#F1F5F9',
  gray200: '#E2E8F0',
  gray300: '#CBD5E1',
  gray400: '#94A3B8',
  gray500: '#64748B',
  gray600: '#475569',
  gray700: '#334155',
  gray800: '#1E293B',
  gray900: '#0F172A',

  // Semantic
  background: '#F8FAFC',
  surface: '#FFFFFF',
  text: '#0F172A',
  textMuted: '#64748B',
  textInverse: '#FFFFFF',
  border: '#E2E8F0',
  primary: '#1F3D5C',
  primaryText: '#FFFFFF',
  danger: '#C8332D',
  success: '#16A34A',
} as const;

export type ColorToken = keyof typeof colors;
```

### Step 2.2: Create `apps/client/mobile/theme/spacing.ts`

```ts
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export type SpacingToken = keyof typeof spacing;
```

### Step 2.3: Create `apps/client/mobile/theme/typography.ts`

```ts
import type { TextStyle } from 'react-native';

export const typography: Record<string, TextStyle> = {
  display: { fontSize: 28, fontWeight: '700', lineHeight: 34 },
  title: { fontSize: 22, fontWeight: '700', lineHeight: 28 },
  heading: { fontSize: 18, fontWeight: '600', lineHeight: 24 },
  body: { fontSize: 16, fontWeight: '400', lineHeight: 22 },
  label: { fontSize: 14, fontWeight: '600', lineHeight: 20 },
  caption: { fontSize: 12, fontWeight: '400', lineHeight: 16 },
};
```

### Step 2.4: Create `apps/client/mobile/theme/index.ts`

```ts
export { colors } from './colors.js';
export type { ColorToken } from './colors.js';
export { spacing } from './spacing.js';
export type { SpacingToken } from './spacing.js';
export { typography } from './typography.js';
```

### Step 2.5: Typecheck + format

```bash
pnpm --filter @flipturn/mobile typecheck
pnpm format:check
```

Both exit 0.

### Step 2.6: Commit

```bash
git add apps/client/mobile/theme
git commit -m "feat(mobile): theme tokens (colors, spacing, typography)"
```

Use exactly that commit message.

---

## Task 3: API client + env helper

**Files:**

- Create: `apps/client/mobile/lib/env.ts`
- Create: `apps/client/mobile/lib/format.ts`
- Create: `apps/client/mobile/api/client.ts`
- Create: `apps/client/mobile/tests/setup.ts`
- Create: `apps/client/mobile/vitest.config.ts`
- Create: `apps/client/mobile/tests/lib/format.test.ts`
- Create: `apps/client/mobile/tests/api/client.test.ts`

### Step 3.1: Create `apps/client/mobile/vitest.config.ts`

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
  },
});
```

### Step 3.2: Create `apps/client/mobile/tests/setup.ts`

Read `apps/server/api/tests/setup.ts` and copy verbatim to `apps/client/mobile/tests/setup.ts`. The hand-rolled `.env` loader handles `EXPO_PUBLIC_*` env vars via `process.env`. Note: in production the Expo bundler reads `EXPO_PUBLIC_*` from `.env` and inlines them at build time; tests run in Node and access them via `process.env` directly.

### Step 3.3: Create `apps/client/mobile/lib/env.ts`

```ts
/**
 * EXPO_PUBLIC_* env vars are bundled into the JS bundle at build time
 * by the Expo bundler. At runtime (both in the bundle and in Node tests)
 * they're accessible via process.env.
 *
 * Don't put secrets in EXPO_PUBLIC_* vars — they're shipped to the client.
 */
export function apiBaseUrl(): string {
  const url = process.env['EXPO_PUBLIC_API_BASE_URL'];
  if (!url) {
    throw new Error(
      'EXPO_PUBLIC_API_BASE_URL is not set. ' +
        'Copy .env.example to .env (or .env.local) and rebuild.',
    );
  }
  return url.replace(/\/$/, ''); // strip trailing slash
}
```

### Step 3.4: Create `apps/client/mobile/lib/format.ts`

```ts
// Re-export the shared formatters so screens import from one place.
export { formatSwimTime, parseSwimTime, buildEventKey, parseEventKey } from '@flipturn/shared';
export type { Stroke, Course, Gender, Round, SwimStatus } from '@flipturn/shared';
```

### Step 3.5: Write the format test

Create `apps/client/mobile/tests/lib/format.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatSwimTime, parseEventKey } from '../../lib/format.js';

describe('format re-exports', () => {
  it('formatSwimTime works via the mobile re-export', () => {
    expect(formatSwimTime(5732)).toBe('57.32');
  });

  it('parseEventKey works via the mobile re-export', () => {
    expect(parseEventKey('100_FR_LCM')).toEqual({
      distanceM: 100,
      stroke: 'FR',
      course: 'LCM',
    });
  });
});
```

### Step 3.6: Run — should pass immediately

Run: `pnpm --filter @flipturn/mobile test format`
Expected: 2 tests pass (these test the re-export, which Just Works because `@flipturn/shared` is already implemented).

### Step 3.7: Write the failing api client test

Create `apps/client/mobile/tests/api/client.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { apiClient, ApiError } from '../../api/client.js';

const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
  vi.stubEnv('EXPO_PUBLIC_API_BASE_URL', 'http://test.local');
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.unstubAllEnvs();
});

function mockFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: response.status ? response.status < 400 : true,
    status: response.status ?? 200,
    statusText: response.statusText ?? 'OK',
    headers: new Headers(response.headers ?? { 'content-type': 'application/json' }),
    json: response.json ?? (async () => ({})),
    text: async () => JSON.stringify(await (response.json?.() ?? Promise.resolve({}))),
  } as Response);
}

describe('apiClient', () => {
  it('GETs and returns parsed JSON', async () => {
    mockFetch({ status: 200, json: async () => ({ ok: true }) });
    const result = await apiClient<{ ok: boolean }>('/v1/health');
    expect(result).toEqual({ ok: true });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://test.local/v1/health',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('POSTs with JSON body and content-type header', async () => {
    mockFetch({ status: 202, json: async () => ({}) });
    await apiClient('/v1/auth/magic-link/request', {
      method: 'POST',
      body: { email: 'a@b.com' },
    });
    const call = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect(call[1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({ 'content-type': 'application/json' }),
      body: JSON.stringify({ email: 'a@b.com' }),
    });
  });

  it('attaches Authorization header when sessionToken is provided', async () => {
    mockFetch({ status: 200, json: async () => ({}) });
    await apiClient('/v1/auth/me', { sessionToken: 'tok-123' });
    const call = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect(call[1]).toMatchObject({
      headers: expect.objectContaining({ authorization: 'Bearer tok-123' }),
    });
  });

  it('throws ApiError for 4xx responses', async () => {
    mockFetch({
      status: 401,
      json: async () => ({ error: { code: 'unauthenticated', message: 'Invalid session' } }),
    });
    await expect(apiClient('/v1/auth/me', { sessionToken: 'bad' })).rejects.toThrow(ApiError);
  });

  it('throws ApiError for 5xx responses', async () => {
    mockFetch({
      status: 500,
      json: async () => ({ error: { code: 'internal_error', message: 'Server Error' } }),
    });
    await expect(apiClient('/v1/health')).rejects.toThrow(ApiError);
  });

  it('returns void for 204 responses (no body)', async () => {
    mockFetch({ status: 204, json: async () => ({}) });
    const result = await apiClient<void>('/v1/me', { method: 'DELETE', sessionToken: 'tok' });
    expect(result).toBeUndefined();
  });
});
```

### Step 3.8: Run — verify failure

Run: `pnpm --filter @flipturn/mobile test client`
Expected: tests fail with module-not-found.

### Step 3.9: Implement `apps/client/mobile/api/client.ts`

```ts
import { apiBaseUrl } from '../lib/env.js';

export interface ApiClientOptions {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  readonly body?: unknown;
  readonly sessionToken?: string | undefined;
  readonly query?: Record<string, string | number | undefined>;
  readonly signal?: AbortSignal | undefined;
}

export interface ApiErrorPayload {
  readonly code?: string;
  readonly message?: string;
  readonly issues?: unknown;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly payload: ApiErrorPayload,
    public readonly path: string,
  ) {
    super(payload.message ?? `API error ${status} on ${path}`);
    this.name = 'ApiError';
  }
}

export async function apiClient<T = unknown>(
  path: string,
  options: ApiClientOptions = {},
): Promise<T> {
  const base = apiBaseUrl();
  const queryString = options.query
    ? '?' +
      Object.entries(options.query)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : '';
  const url = `${base}${path}${queryString}`;

  const headers: Record<string, string> = {
    accept: 'application/json',
  };
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (options.sessionToken) {
    headers['authorization'] = `Bearer ${options.sessionToken}`;
  }

  const init: RequestInit = {
    method: options.method ?? 'GET',
    headers,
  };
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }
  if (options.signal) {
    init.signal = options.signal;
  }

  const response = await fetch(url, init);

  if (response.status === 204) {
    return undefined as T;
  }

  if (!response.ok) {
    let payload: ApiErrorPayload = {};
    try {
      const json = (await response.json()) as { error?: ApiErrorPayload };
      payload = json.error ?? {};
    } catch {
      // body wasn't JSON
    }
    throw new ApiError(response.status, payload, path);
  }

  return (await response.json()) as T;
}
```

### Step 3.10: Run — verify pass

Run: `pnpm --filter @flipturn/mobile test`
Expected: all tests pass — 2 format + 6 client = 8 total.

### Step 3.11: Typecheck + format

```bash
pnpm --filter @flipturn/mobile typecheck
pnpm format:check
```

Both exit 0.

### Step 3.12: Commit

```bash
git add apps/client/mobile/lib apps/client/mobile/api apps/client/mobile/tests apps/client/mobile/vitest.config.ts
git commit -m "feat(mobile): api client + env helper + format re-exports"
```

Use exactly that commit message.

---

## Task 4: Session storage + AuthProvider

**Files:**

- Create: `apps/client/mobile/auth/session.ts`
- Create: `apps/client/mobile/auth/AuthProvider.tsx`
- Create: `apps/client/mobile/tests/auth/session.test.ts`

### Step 4.1: Write the failing session test

Create `apps/client/mobile/tests/auth/session.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadSession,
  saveSession,
  clearSession,
  __setSecureStoreFakeForTests,
} from '../../auth/session.js';

const fakeStore = new Map<string, string>();

beforeEach(() => {
  fakeStore.clear();
  __setSecureStoreFakeForTests({
    setItemAsync: async (key, value) => {
      fakeStore.set(key, value);
    },
    getItemAsync: async (key) => fakeStore.get(key) ?? null,
    deleteItemAsync: async (key) => {
      fakeStore.delete(key);
    },
  });
});

describe('session storage', () => {
  it('returns null when no session is saved', async () => {
    expect(await loadSession()).toBeNull();
  });

  it('persists and loads a session', async () => {
    await saveSession({ token: 'abc-123', userEmail: 'a@b.com' });
    const loaded = await loadSession();
    expect(loaded).toEqual({ token: 'abc-123', userEmail: 'a@b.com' });
  });

  it('clears the session', async () => {
    await saveSession({ token: 'abc-123', userEmail: 'a@b.com' });
    await clearSession();
    expect(await loadSession()).toBeNull();
  });
});
```

### Step 4.2: Run — verify failure

Run: `pnpm --filter @flipturn/mobile test session`
Expected: fails with module-not-found.

### Step 4.3: Implement `apps/client/mobile/auth/session.ts`

```ts
/**
 * Session persistence wrapper around expo-secure-store.
 *
 * In tests we don't import the real expo-secure-store (it requires the
 * Expo runtime). __setSecureStoreFakeForTests injects a Map-backed
 * implementation. In production (Expo bundle), the real module is used.
 */

export interface PersistedSession {
  readonly token: string;
  readonly userEmail: string;
}

interface SecureStoreLike {
  setItemAsync(key: string, value: string): Promise<void>;
  getItemAsync(key: string): Promise<string | null>;
  deleteItemAsync(key: string): Promise<void>;
}

const SESSION_KEY = 'flipturn.session';

let _store: SecureStoreLike | undefined;

async function getStore(): Promise<SecureStoreLike> {
  if (_store) return _store;
  // Lazy import so tests can override before the first call.
  const real = (await import('expo-secure-store')) as unknown as SecureStoreLike;
  _store = real;
  return _store;
}

/** Test-only: inject a fake SecureStore for unit tests. */
export function __setSecureStoreFakeForTests(fake: SecureStoreLike): void {
  _store = fake;
}

export async function saveSession(s: PersistedSession): Promise<void> {
  const store = await getStore();
  await store.setItemAsync(SESSION_KEY, JSON.stringify(s));
}

export async function loadSession(): Promise<PersistedSession | null> {
  const store = await getStore();
  const raw = await store.getItemAsync(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersistedSession;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  const store = await getStore();
  await store.deleteItemAsync(SESSION_KEY);
}
```

### Step 4.4: Implement `apps/client/mobile/auth/AuthProvider.tsx`

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { loadSession, saveSession, clearSession, type PersistedSession } from './session.js';

interface AuthState {
  readonly status: 'loading' | 'unauthenticated' | 'authenticated';
  readonly session: PersistedSession | null;
}

interface AuthContextValue extends AuthState {
  signIn(session: PersistedSession): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', session: null });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const persisted = await loadSession();
      if (cancelled) return;
      setState(
        persisted
          ? { status: 'authenticated', session: persisted }
          : { status: 'unauthenticated', session: null },
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const value: AuthContextValue = {
    ...state,
    signIn: async (session) => {
      await saveSession(session);
      setState({ status: 'authenticated', session });
    },
    signOut: async () => {
      await clearSession();
      setState({ status: 'unauthenticated', session: null });
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
```

### Step 4.5: Run — verify pass

Run: `pnpm --filter @flipturn/mobile test`
Expected: 3 session + 2 format + 6 client = 11 total tests pass.

### Step 4.6: Typecheck + format

```bash
pnpm --filter @flipturn/mobile typecheck
pnpm format:check
```

Both exit 0.

### Step 4.7: Commit

```bash
git add apps/client/mobile/auth apps/client/mobile/tests/auth
git commit -m "feat(mobile): session storage + AuthProvider context"
```

Use exactly that commit message.

---

## Task 5: API methods + React Query setup

**Files:**

- Create: `apps/client/mobile/api/auth.ts`
- Create: `apps/client/mobile/api/athletes.ts`
- Create: `apps/client/mobile/api/queries.ts`
- Create: `apps/client/mobile/tests/api/auth.test.ts`

### Step 5.1: Implement `apps/client/mobile/api/auth.ts`

```ts
import { apiClient } from './client.js';

export async function requestMagicLink(email: string): Promise<void> {
  await apiClient<void>('/v1/auth/magic-link/request', {
    method: 'POST',
    body: { email },
  });
}

export async function consumeMagicLink(token: string): Promise<{ sessionToken: string }> {
  return apiClient<{ sessionToken: string }>('/v1/auth/magic-link/consume', {
    method: 'POST',
    body: { token },
  });
}

export interface MeResponse {
  readonly user: { id: string; email: string; createdAt: string };
  readonly athletes: Array<{
    id: string;
    sncId: string;
    primaryName: string;
    gender: 'M' | 'F' | 'X' | null;
    homeClub: string | null;
    relationship: 'PARENT' | 'GUARDIAN' | 'SELF' | 'OTHER';
  }>;
}

export async function getMe(sessionToken: string): Promise<MeResponse> {
  return apiClient<MeResponse>('/v1/auth/me', { sessionToken });
}

export async function deleteMe(sessionToken: string): Promise<void> {
  await apiClient<void>('/v1/me', { method: 'DELETE', sessionToken });
}
```

### Step 5.2: Implement `apps/client/mobile/api/athletes.ts`

```ts
import { apiClient } from './client.js';

export interface AthleteDto {
  readonly id: string;
  readonly sncId: string;
  readonly primaryName: string;
  readonly gender: 'M' | 'F' | 'X' | null;
  readonly homeClub: string | null;
  readonly lastScrapedAt: string | null;
}

export interface OnboardResponse {
  readonly athlete: AthleteDto;
}

export async function onboardAthlete(
  sessionToken: string,
  sncId: string,
  relationship?: 'PARENT' | 'GUARDIAN' | 'SELF' | 'OTHER',
): Promise<OnboardResponse> {
  return apiClient<OnboardResponse>('/v1/athletes/onboard', {
    method: 'POST',
    body: relationship ? { sncId, relationship } : { sncId },
    sessionToken,
  });
}

export async function listAthletes(sessionToken: string): Promise<{ athletes: AthleteDto[] }> {
  return apiClient<{ athletes: AthleteDto[] }>('/v1/athletes', { sessionToken });
}

export async function unlinkAthlete(sessionToken: string, athleteId: string): Promise<void> {
  await apiClient<void>(`/v1/user-athletes/${athleteId}`, {
    method: 'DELETE',
    sessionToken,
  });
}

export interface SwimDto {
  readonly id: string;
  readonly eventKey: string;
  readonly timeCentiseconds: number;
  readonly splits: number[];
  readonly place: number | null;
  readonly status: 'OFFICIAL' | 'DQ' | 'NS' | 'DNF' | 'WITHDRAWN';
  readonly meetName: string;
  readonly swamAt: string;
}

export interface SwimsPage {
  readonly swims: SwimDto[];
  readonly nextCursor: string | null;
}

export async function getSwims(
  sessionToken: string,
  athleteId: string,
  options: { eventKey?: string; cursor?: string; limit?: number } = {},
): Promise<SwimsPage> {
  return apiClient<SwimsPage>(`/v1/athletes/${athleteId}/swims`, {
    sessionToken,
    query: {
      eventKey: options.eventKey,
      cursor: options.cursor,
      limit: options.limit,
    },
  });
}

export interface PersonalBestDto {
  readonly eventKey: string;
  readonly timeCentiseconds: number;
  readonly achievedAt: string;
  readonly swimId: string;
}

export async function getPersonalBests(
  sessionToken: string,
  athleteId: string,
): Promise<{ personalBests: PersonalBestDto[] }> {
  return apiClient<{ personalBests: PersonalBestDto[] }>(
    `/v1/athletes/${athleteId}/personal-bests`,
    { sessionToken },
  );
}

export interface ProgressionPoint {
  readonly date: string;
  readonly timeCentiseconds: number;
  readonly meetName: string;
}

export async function getProgression(
  sessionToken: string,
  athleteId: string,
  eventKey: string,
): Promise<{ points: ProgressionPoint[] }> {
  return apiClient<{ points: ProgressionPoint[] }>(`/v1/athletes/${athleteId}/progression`, {
    sessionToken,
    query: { eventKey },
  });
}
```

### Step 5.3: Implement `apps/client/mobile/api/queries.ts`

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider.js';
import {
  listAthletes,
  onboardAthlete,
  unlinkAthlete,
  getSwims,
  getPersonalBests,
  getProgression,
} from './athletes.js';
import { getMe } from './auth.js';

function tokenOrThrow(token: string | null | undefined): string {
  if (!token) throw new Error('not authenticated');
  return token;
}

export function useMe() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['me', session?.token],
    queryFn: () => getMe(tokenOrThrow(session?.token)),
    enabled: !!session?.token,
  });
}

export function useAthletes() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['athletes', session?.token],
    queryFn: () => listAthletes(tokenOrThrow(session?.token)),
    enabled: !!session?.token,
  });
}

export function useOnboardAthlete() {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      sncId: string;
      relationship?: 'PARENT' | 'GUARDIAN' | 'SELF' | 'OTHER';
    }) => onboardAthlete(tokenOrThrow(session?.token), input.sncId, input.relationship),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['athletes'] });
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export function useUnlinkAthlete() {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (athleteId: string) => unlinkAthlete(tokenOrThrow(session?.token), athleteId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['athletes'] });
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export function useSwims(athleteId: string | undefined, eventKey?: string) {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['swims', athleteId, eventKey, session?.token],
    queryFn: () => getSwims(tokenOrThrow(session?.token), athleteId!, { eventKey }),
    enabled: !!session?.token && !!athleteId,
  });
}

export function usePersonalBests(athleteId: string | undefined) {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['personal-bests', athleteId, session?.token],
    queryFn: () => getPersonalBests(tokenOrThrow(session?.token), athleteId!),
    enabled: !!session?.token && !!athleteId,
  });
}

export function useProgression(athleteId: string | undefined, eventKey: string | undefined) {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['progression', athleteId, eventKey, session?.token],
    queryFn: () => getProgression(tokenOrThrow(session?.token), athleteId!, eventKey!),
    enabled: !!session?.token && !!athleteId && !!eventKey,
  });
}
```

### Step 5.4: Write a small auth-API smoke test

Create `apps/client/mobile/tests/api/auth.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { requestMagicLink, consumeMagicLink, getMe } from '../../api/auth.js';

beforeEach(() => {
  vi.stubEnv('EXPO_PUBLIC_API_BASE_URL', 'http://test.local');
});

describe('auth API methods', () => {
  it('requestMagicLink POSTs to /v1/auth/magic-link/request', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      headers: new Headers(),
      json: async () => ({}),
      text: async () => '',
    });
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
    await requestMagicLink('a@b.com');
    expect(fetch).toHaveBeenCalledWith(
      'http://test.local/v1/auth/magic-link/request',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('consumeMagicLink returns sessionToken', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ sessionToken: 'tok-1' }),
    }) as unknown as typeof globalThis.fetch;
    const r = await consumeMagicLink('magic-1');
    expect(r.sessionToken).toBe('tok-1');
  });

  it('getMe sends bearer token', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        user: { id: 'u', email: 'a@b.com', createdAt: '2026-01-01' },
        athletes: [],
      }),
    });
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
    await getMe('tok-1');
    const call = fetch.mock.calls[0]!;
    expect(call[1]).toMatchObject({
      headers: expect.objectContaining({ authorization: 'Bearer tok-1' }),
    });
  });
});
```

### Step 5.5: Run — verify all pass

Run: `pnpm --filter @flipturn/mobile test`
Expected: 11 prior + 3 new = 14 total tests pass.

### Step 5.6: Typecheck + format

```bash
pnpm --filter @flipturn/mobile typecheck
pnpm format:check
```

Both exit 0.

### Step 5.7: Commit

```bash
git add apps/client/mobile/api apps/client/mobile/tests/api/auth.test.ts
git commit -m "feat(mobile): API methods + React Query hooks"
```

Use exactly that commit message.

---

## Task 6: Shared components (Button, TextField, Screen, Loading, ErrorMessage)

**Files:**

- Create: `apps/client/mobile/components/Screen.tsx`
- Create: `apps/client/mobile/components/Button.tsx`
- Create: `apps/client/mobile/components/TextField.tsx`
- Create: `apps/client/mobile/components/Loading.tsx`
- Create: `apps/client/mobile/components/ErrorMessage.tsx`

These are RN components with no logic worth unit-testing in isolation. Manual QA on Expo Go covers them.

### Step 6.1: Create `apps/client/mobile/components/Screen.tsx`

```tsx
import { SafeAreaView, ScrollView, StyleSheet, View, type ViewProps } from 'react-native';
import { colors, spacing } from '../theme/index.js';

interface ScreenProps extends ViewProps {
  readonly scroll?: boolean;
}

export function Screen({ scroll, style, children, ...rest }: ScreenProps) {
  const Container = scroll ? ScrollView : View;
  return (
    <SafeAreaView style={styles.safe}>
      <Container style={[styles.container, style]} {...rest}>
        {children}
      </Container>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, padding: spacing.lg },
});
```

### Step 6.2: Create `apps/client/mobile/components/Button.tsx`

```tsx
import { ActivityIndicator, Pressable, StyleSheet, Text, type PressableProps } from 'react-native';
import { colors, spacing, typography } from '../theme/index.js';

interface ButtonProps extends Omit<PressableProps, 'children'> {
  readonly label: string;
  readonly variant?: 'primary' | 'secondary' | 'danger';
  readonly loading?: boolean;
}

export function Button({
  label,
  variant = 'primary',
  loading = false,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const variantStyles = STYLES_BY_VARIANT[variant];
  const isDisabled = disabled || loading;
  return (
    <Pressable
      {...rest}
      disabled={isDisabled}
      style={(state) => [
        styles.base,
        variantStyles.container,
        isDisabled ? styles.disabled : null,
        state.pressed ? styles.pressed : null,
        typeof style === 'function' ? style(state) : style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variantStyles.text.color as string} />
      ) : (
        <Text style={[styles.text, variantStyles.text]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  text: { ...typography.label },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
});

const STYLES_BY_VARIANT = {
  primary: StyleSheet.create({
    container: { backgroundColor: colors.primary },
    text: { color: colors.primaryText },
  }),
  secondary: StyleSheet.create({
    container: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    text: { color: colors.text },
  }),
  danger: StyleSheet.create({
    container: { backgroundColor: colors.danger },
    text: { color: colors.primaryText },
  }),
};
```

### Step 6.3: Create `apps/client/mobile/components/TextField.tsx`

```tsx
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { colors, spacing, typography } from '../theme/index.js';

interface TextFieldProps extends TextInputProps {
  readonly label?: string;
  readonly error?: string | null;
  readonly hint?: string;
}

export function TextField({ label, error, hint, style, ...rest }: TextFieldProps) {
  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        {...rest}
        placeholderTextColor={colors.gray400}
        style={[styles.input, error ? styles.inputError : null, style]}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!error && hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs, marginBottom: spacing.md },
  label: { ...typography.label, color: colors.text },
  input: {
    ...typography.body,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    color: colors.text,
  },
  inputError: { borderColor: colors.danger },
  error: { ...typography.caption, color: colors.danger },
  hint: { ...typography.caption, color: colors.textMuted },
});
```

### Step 6.4: Create `apps/client/mobile/components/Loading.tsx`

```tsx
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '../theme/index.js';

export function Loading({ message }: { message?: string }) {
  return (
    <View style={styles.container}>
      <ActivityIndicator color={colors.primary} size="large" />
      {message ? <Text style={styles.text}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  text: { ...typography.body, color: colors.textMuted },
});
```

### Step 6.5: Create `apps/client/mobile/components/ErrorMessage.tsx`

```tsx
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '../theme/index.js';

export function ErrorMessage({ message }: { message: string }) {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FEE2E2',
    borderRadius: 8,
    padding: spacing.md,
    marginVertical: spacing.sm,
  },
  text: { ...typography.body, color: colors.danger },
});
```

### Step 6.6: Typecheck

```bash
pnpm --filter @flipturn/mobile typecheck
```

Exit 0. (Can't unit-test these RN components without a DOM-like renderer; manual QA only.)

### Step 6.7: Commit

```bash
git add apps/client/mobile/components
git commit -m "feat(mobile): shared UI components (Screen, Button, TextField, Loading, ErrorMessage)"
```

Use exactly that commit message.

---

## Task 7: Auth screens (email entry + magic-link landing) + auth gate

**Files:**

- Create: `apps/client/mobile/app/(auth)/_layout.tsx`
- Create: `apps/client/mobile/app/(auth)/email-entry.tsx`
- Create: `apps/client/mobile/app/(auth)/magic-link.tsx`
- Modify: `apps/client/mobile/app/_layout.tsx` — wire `AuthProvider` + React Query + nav stack
- Modify: `apps/client/mobile/app/index.tsx` — auth gate redirector

### Step 7.1: Replace `apps/client/mobile/app/_layout.tsx`

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { AuthProvider } from '../auth/AuthProvider.js';

export default function RootLayout() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
```

### Step 7.2: Replace `apps/client/mobile/app/index.tsx` — auth gate

```tsx
import { Redirect } from 'expo-router';
import { useAuth } from '../auth/AuthProvider.js';
import { Loading } from '../components/Loading.js';

export default function AuthGate() {
  const { status } = useAuth();
  if (status === 'loading') return <Loading message="Loading…" />;
  if (status === 'authenticated') return <Redirect href="/(app)/home" />;
  return <Redirect href="/(auth)/email-entry" />;
}
```

### Step 7.3: Create `apps/client/mobile/app/(auth)/_layout.tsx`

```tsx
import { Stack } from 'expo-router';

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

### Step 7.4: Create `apps/client/mobile/app/(auth)/email-entry.tsx`

```tsx
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { Screen } from '../../components/Screen.js';
import { Button } from '../../components/Button.js';
import { TextField } from '../../components/TextField.js';
import { ErrorMessage } from '../../components/ErrorMessage.js';
import { colors, spacing, typography } from '../../theme/index.js';
import { requestMagicLink } from '../../api/auth.js';

export default function EmailEntry() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const mutation = useMutation({
    mutationFn: (e: string) => requestMagicLink(e),
    onSuccess: () => setSubmitted(true),
  });

  if (submitted) {
    return (
      <Screen>
        <Text style={styles.title}>Check your email</Text>
        <Text style={styles.body}>
          We sent a sign-in link to {email}. Tap the link to open the app.
        </Text>
        <Button
          label="Send another"
          variant="secondary"
          onPress={() => {
            setSubmitted(false);
            mutation.reset();
          }}
          style={{ marginTop: spacing.lg }}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={styles.title}>Sign in to Flip Turn</Text>
      <Text style={styles.subtitle}>We'll email you a link. No password needed.</Text>
      <TextField
        label="Email"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        placeholder="parent@example.com"
        value={email}
        onChangeText={setEmail}
      />
      {mutation.error ? (
        <ErrorMessage message={(mutation.error as Error).message ?? 'Something went wrong.'} />
      ) : null}
      <Button
        label="Send sign-in link"
        loading={mutation.isPending}
        disabled={!email.trim()}
        onPress={() => mutation.mutate(email.trim())}
        style={{ marginTop: spacing.md }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.display, color: colors.text, marginBottom: spacing.sm },
  subtitle: {
    ...typography.body,
    color: colors.textMuted,
    marginBottom: spacing.xl,
  },
  body: { ...typography.body, color: colors.text },
});
```

### Step 7.5: Create `apps/client/mobile/app/(auth)/magic-link.tsx`

```tsx
import { useEffect } from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { Screen } from '../../components/Screen.js';
import { Loading } from '../../components/Loading.js';
import { ErrorMessage } from '../../components/ErrorMessage.js';
import { Button } from '../../components/Button.js';
import { consumeMagicLink, getMe } from '../../api/auth.js';
import { useAuth } from '../../auth/AuthProvider.js';

export default function MagicLinkLanding() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const { signIn } = useAuth();

  const mutation = useMutation({
    mutationFn: async (t: string) => {
      const { sessionToken } = await consumeMagicLink(t);
      const me = await getMe(sessionToken);
      return { sessionToken, email: me.user.email };
    },
    onSuccess: async (data) => {
      await signIn({ token: data.sessionToken, userEmail: data.email });
      router.replace('/(app)/home');
    },
  });

  useEffect(() => {
    if (token && !mutation.isPending && !mutation.isSuccess) {
      mutation.mutate(token);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (!token) {
    return (
      <Screen>
        <ErrorMessage message="Missing token in the sign-in link. Try requesting a new one." />
        <Button
          label="Back to sign in"
          variant="secondary"
          onPress={() => router.replace('/(auth)/email-entry')}
        />
      </Screen>
    );
  }

  if (mutation.error) {
    return (
      <Screen>
        <ErrorMessage
          message={
            (mutation.error as Error).message ??
            'Sign-in link is invalid or expired. Request a new one.'
          }
        />
        <Button
          label="Back to sign in"
          variant="secondary"
          onPress={() => router.replace('/(auth)/email-entry')}
        />
      </Screen>
    );
  }

  return <Loading message="Signing in…" />;
}
```

### Step 7.6: Run typecheck + format

```bash
pnpm --filter @flipturn/mobile typecheck
pnpm format:check
```

Both exit 0.

### Step 7.7: Commit

```bash
git add apps/client/mobile/app
git commit -m "feat(mobile): auth screens + gate (email entry, magic-link landing)"
```

Use exactly that commit message.

---

## Task 8: Onboarding screen

**Files:**

- Create: `apps/client/mobile/app/(app)/_layout.tsx`
- Create: `apps/client/mobile/app/(app)/onboarding.tsx`

### Step 8.1: Create `apps/client/mobile/app/(app)/_layout.tsx`

```tsx
import { Stack, Redirect } from 'expo-router';
import { useAuth } from '../../auth/AuthProvider.js';
import { Loading } from '../../components/Loading.js';

export default function AppLayout() {
  const { status } = useAuth();
  if (status === 'loading') return <Loading message="Loading…" />;
  if (status === 'unauthenticated') return <Redirect href="/(auth)/email-entry" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

### Step 8.2: Create `apps/client/mobile/app/(app)/onboarding.tsx`

```tsx
import { useState, useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Screen } from '../../components/Screen.js';
import { Button } from '../../components/Button.js';
import { TextField } from '../../components/TextField.js';
import { ErrorMessage } from '../../components/ErrorMessage.js';
import { Loading } from '../../components/Loading.js';
import { colors, spacing, typography } from '../../theme/index.js';
import { useAthletes, useOnboardAthlete } from '../../api/queries.js';

export default function Onboarding() {
  const [sncId, setSncId] = useState('');
  const onboard = useOnboardAthlete();
  const athletes = useAthletes();
  const qc = useQueryClient();
  const [pollingForId, setPollingForId] = useState<string | null>(null);

  // Once a new athlete is onboarded, poll the athletes list every 5s
  // until that athlete's lastScrapedAt becomes non-null OR 60s elapse.
  useEffect(() => {
    if (!pollingForId) return;
    const start = Date.now();
    const interval = setInterval(() => {
      void qc.invalidateQueries({ queryKey: ['athletes'] });
      const found = athletes.data?.athletes.find((a) => a.id === pollingForId);
      if (found?.lastScrapedAt) {
        clearInterval(interval);
        setPollingForId(null);
        router.replace('/(app)/home');
        return;
      }
      if (Date.now() - start > 60_000) {
        clearInterval(interval);
        setPollingForId(null);
        router.replace('/(app)/home'); // home will show "Loading…" status
      }
    }, 5_000);
    return () => clearInterval(interval);
  }, [pollingForId, athletes.data, qc]);

  if (pollingForId) {
    return <Loading message="Fetching swim history…" />;
  }

  return (
    <Screen>
      <Text style={styles.title}>Add your swimmer</Text>
      <Text style={styles.subtitle}>
        Enter your kid's Swimming Canada athlete ID. You can find it in their SNC profile or on
        their meet results.
      </Text>
      <TextField
        label="SNC athlete ID"
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="e.g. 4030816"
        value={sncId}
        onChangeText={setSncId}
      />
      {onboard.error ? (
        <ErrorMessage message={(onboard.error as Error).message ?? 'Could not onboard.'} />
      ) : null}
      <Button
        label="Add swimmer"
        loading={onboard.isPending}
        disabled={!sncId.trim()}
        onPress={() => {
          onboard.mutate(
            { sncId: sncId.trim() },
            {
              onSuccess: (data) => {
                setPollingForId(data.athlete.id);
              },
            },
          );
        }}
        style={{ marginTop: spacing.md }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.display, color: colors.text, marginBottom: spacing.sm },
  subtitle: {
    ...typography.body,
    color: colors.textMuted,
    marginBottom: spacing.xl,
  },
});
```

### Step 8.3: Typecheck + format

```bash
pnpm --filter @flipturn/mobile typecheck
pnpm format:check
```

Both exit 0.

### Step 8.4: Commit

```bash
git add apps/client/mobile/app
git commit -m "feat(mobile): onboarding screen with SNC ID input + scrape poll"
```

Use exactly that commit message.

---

## Task 9: Home screen + PB list item

**Files:**

- Create: `apps/client/mobile/components/PBListItem.tsx`
- Create: `apps/client/mobile/app/(app)/home.tsx`

### Step 9.1: Create `apps/client/mobile/components/PBListItem.tsx`

```tsx
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { colors, spacing, typography } from '../theme/index.js';
import { formatSwimTime, parseEventKey } from '../lib/format.js';

interface PBListItemProps {
  readonly athleteId: string;
  readonly eventKey: string;
  readonly timeCentiseconds: number;
  readonly achievedAt: string;
}

const STROKE_LABELS: Record<string, string> = {
  FR: 'Freestyle',
  BK: 'Backstroke',
  BR: 'Breaststroke',
  FL: 'Butterfly',
  IM: 'IM',
};

export function PBListItem({ athleteId, eventKey, timeCentiseconds, achievedAt }: PBListItemProps) {
  const parts = parseEventKey(eventKey);
  const label = `${parts.distanceM}m ${STROKE_LABELS[parts.stroke] ?? parts.stroke} (${parts.course})`;
  const date = new Date(achievedAt).toLocaleDateString();
  return (
    <Pressable
      onPress={() =>
        router.push({ pathname: '/(app)/event/[eventKey]', params: { eventKey, athleteId } })
      }
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
    >
      <View style={styles.left}>
        <Text style={styles.event}>{label}</Text>
        <Text style={styles.date}>{date}</Text>
      </View>
      <Text style={styles.time}>{formatSwimTime(timeCentiseconds)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  pressed: { opacity: 0.7 },
  left: { flex: 1, gap: spacing.xs },
  event: { ...typography.heading, color: colors.text },
  date: { ...typography.caption, color: colors.textMuted },
  time: { ...typography.title, color: colors.primary },
});
```

### Step 9.2: Create `apps/client/mobile/app/(app)/home.tsx`

```tsx
import { useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../../components/Screen.js';
import { Loading } from '../../components/Loading.js';
import { ErrorMessage } from '../../components/ErrorMessage.js';
import { Button } from '../../components/Button.js';
import { PBListItem } from '../../components/PBListItem.js';
import { colors, spacing, typography } from '../../theme/index.js';
import { useAthletes, usePersonalBests } from '../../api/queries.js';
import { useAuth } from '../../auth/AuthProvider.js';
import { parseEventKey } from '../../lib/format.js';

const STROKE_ORDER = ['FR', 'BK', 'BR', 'FL', 'IM'];

export default function Home() {
  const { signOut } = useAuth();
  const athletes = useAthletes();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Default selection: first athlete with at least one scrape.
  const list = athletes.data?.athletes ?? [];
  const activeId = selectedId ?? list[0]?.id ?? null;
  const active = list.find((a) => a.id === activeId);

  const pbs = usePersonalBests(activeId ?? undefined);

  if (athletes.isLoading) return <Loading message="Loading athletes…" />;
  if (athletes.error)
    return (
      <Screen>
        <ErrorMessage message={(athletes.error as Error).message} />
      </Screen>
    );

  if (list.length === 0) {
    return (
      <Screen>
        <Text style={styles.h1}>No athletes yet</Text>
        <Text style={styles.body}>Add a swimmer to get started.</Text>
        <Button
          label="Add swimmer"
          onPress={() => router.push('/(app)/onboarding')}
          style={{ marginTop: spacing.lg }}
        />
        <Button
          label="Sign out"
          variant="secondary"
          onPress={signOut}
          style={{ marginTop: spacing.md }}
        />
      </Screen>
    );
  }

  const groups = groupPBsByStroke(pbs.data?.personalBests ?? []);

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.h1}>{active?.primaryName ?? 'Athlete'}</Text>
        {list.length > 1 ? (
          <View style={styles.switcher}>
            {list.map((a) => (
              <Button
                key={a.id}
                label={a.primaryName}
                variant={a.id === activeId ? 'primary' : 'secondary'}
                onPress={() => setSelectedId(a.id)}
                style={{ marginRight: spacing.sm }}
              />
            ))}
          </View>
        ) : null}
        <Button
          label="Add swimmer"
          variant="secondary"
          onPress={() => router.push('/(app)/onboarding')}
          style={{ marginTop: spacing.md }}
        />
      </View>

      {active && !active.lastScrapedAt ? (
        <View style={styles.pendingBox}>
          <Text style={styles.pendingTitle}>Fetching swims…</Text>
          <Text style={styles.body}>
            We're pulling {active.primaryName}'s history from results.swimming.ca. This usually
            takes a minute or two.
          </Text>
        </View>
      ) : null}

      {pbs.isLoading ? <Loading /> : null}
      {pbs.error ? <ErrorMessage message={(pbs.error as Error).message} /> : null}

      {groups.map(([stroke, items]) => (
        <View key={stroke} style={styles.group}>
          <Text style={styles.groupTitle}>{stroke}</Text>
          <FlatList
            scrollEnabled={false}
            data={items}
            keyExtractor={(p) => p.eventKey}
            renderItem={({ item }) => (
              <PBListItem
                athleteId={activeId!}
                eventKey={item.eventKey}
                timeCentiseconds={item.timeCentiseconds}
                achievedAt={item.achievedAt}
              />
            )}
          />
        </View>
      ))}

      <Button
        label="Sign out"
        variant="secondary"
        onPress={signOut}
        style={{ marginTop: spacing.xl }}
      />
    </Screen>
  );
}

interface PB {
  readonly eventKey: string;
  readonly timeCentiseconds: number;
  readonly achievedAt: string;
}

function groupPBsByStroke(pbs: readonly PB[]): Array<[string, PB[]]> {
  const map = new Map<string, PB[]>();
  for (const pb of pbs) {
    const stroke = parseEventKey(pb.eventKey).stroke;
    const arr = map.get(stroke) ?? [];
    arr.push(pb);
    map.set(stroke, arr);
  }
  // Sort each group by distance asc.
  for (const arr of map.values()) {
    arr.sort((a, b) => parseEventKey(a.eventKey).distanceM - parseEventKey(b.eventKey).distanceM);
  }
  // Order groups by stroke conventional order.
  return STROKE_ORDER.filter((s) => map.has(s)).map((s) => [s, map.get(s)!]);
}

const styles = StyleSheet.create({
  header: { marginBottom: spacing.lg },
  h1: { ...typography.display, color: colors.text },
  body: { ...typography.body, color: colors.text },
  switcher: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.md },
  pendingBox: {
    backgroundColor: colors.gray100,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  pendingTitle: { ...typography.heading, color: colors.text },
  group: { marginBottom: spacing.lg, gap: spacing.sm },
  groupTitle: { ...typography.heading, color: colors.textMuted },
});
```

### Step 9.3: Typecheck + format

```bash
pnpm --filter @flipturn/mobile typecheck
pnpm format:check
```

Both exit 0.

### Step 9.4: Commit

```bash
git add apps/client/mobile/components apps/client/mobile/app
git commit -m "feat(mobile): home screen with athlete switcher + grouped PB list"
```

Use exactly that commit message.

---

## Task 10: Event detail screen + ProgressionChart

**Files:**

- Create: `apps/client/mobile/components/ProgressionChart.tsx`
- Create: `apps/client/mobile/app/(app)/event/[eventKey].tsx`

### Step 10.1: Create `apps/client/mobile/components/ProgressionChart.tsx`

A small custom chart using `react-native-svg`. No third-party chart lib — we draw axes, dots, and a line.

```tsx
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';
import { colors, spacing, typography } from '../theme/index.js';
import { formatSwimTime } from '../lib/format.js';

interface Point {
  readonly date: string;
  readonly timeCentiseconds: number;
}

interface ProgressionChartProps {
  readonly points: readonly Point[];
  readonly height?: number;
}

export function ProgressionChart({ points, height = 200 }: ProgressionChartProps) {
  if (points.length === 0) {
    return null;
  }

  // Layout
  const padding = { top: 12, right: 16, bottom: 28, left: 56 };
  const width = 320; // SVG viewport; scaled by SafeAreaView container
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  // Domains: x = time, y = swim time (ascending = slower; faster on top)
  const xs = points.map((p) => new Date(p.date).getTime());
  const ys = points.map((p) => p.timeCentiseconds);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  // Pad y-domain a bit so dots aren't on the axes.
  const yPad = (yMax - yMin) * 0.1 || yMin * 0.05;
  const yLo = yMin - yPad;
  const yHi = yMax + yPad;

  function xPx(t: number): number {
    if (xMax === xMin) return padding.left + innerW / 2;
    return padding.left + ((t - xMin) / (xMax - xMin)) * innerW;
  }
  function yPx(v: number): number {
    if (yHi === yLo) return padding.top + innerH / 2;
    // Faster (smaller) at the top.
    return padding.top + ((v - yLo) / (yHi - yLo)) * innerH;
  }

  const polylinePts = points
    .slice()
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .map((p) => `${xPx(new Date(p.date).getTime())},${yPx(p.timeCentiseconds)}`)
    .join(' ');

  const fastest = Math.min(...ys);
  const slowest = Math.max(...ys);

  return (
    <View style={styles.container}>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        {/* y-axis labels (fastest on top, slowest on bottom) */}
        <SvgText
          x={padding.left - 8}
          y={padding.top + 8}
          fontSize={10}
          fill={colors.textMuted}
          textAnchor="end"
        >
          {formatSwimTime(fastest)}
        </SvgText>
        <SvgText
          x={padding.left - 8}
          y={padding.top + innerH}
          fontSize={10}
          fill={colors.textMuted}
          textAnchor="end"
        >
          {formatSwimTime(slowest)}
        </SvgText>

        {/* x-axis baseline */}
        <Line
          x1={padding.left}
          x2={padding.left + innerW}
          y1={padding.top + innerH}
          y2={padding.top + innerH}
          stroke={colors.border}
          strokeWidth={1}
        />

        {/* connecting line */}
        <Polyline points={polylinePts} stroke={colors.primary} strokeWidth={2} fill="none" />

        {/* points */}
        {points.map((p, i) => (
          <Circle
            key={i}
            cx={xPx(new Date(p.date).getTime())}
            cy={yPx(p.timeCentiseconds)}
            r={4}
            fill={colors.primary}
            stroke={colors.surface}
            strokeWidth={1.5}
          />
        ))}

        {/* x-axis labels */}
        <SvgText
          x={padding.left}
          y={padding.top + innerH + 16}
          fontSize={10}
          fill={colors.textMuted}
          textAnchor="start"
        >
          {new Date(xMin).toLocaleDateString()}
        </SvgText>
        <SvgText
          x={padding.left + innerW}
          y={padding.top + innerH + 16}
          fontSize={10}
          fill={colors.textMuted}
          textAnchor="end"
        >
          {new Date(xMax).toLocaleDateString()}
        </SvgText>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    marginBottom: spacing.lg,
  },
});

// Suppress unused warning for typography; kept for potential future axis labels.
void typography;
```

### Step 10.2: Create `apps/client/mobile/app/(app)/event/[eventKey].tsx`

```tsx
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Screen } from '../../../components/Screen.js';
import { Loading } from '../../../components/Loading.js';
import { ErrorMessage } from '../../../components/ErrorMessage.js';
import { Button } from '../../../components/Button.js';
import { ProgressionChart } from '../../../components/ProgressionChart.js';
import { colors, spacing, typography } from '../../../theme/index.js';
import { useSwims, useProgression } from '../../../api/queries.js';
import { formatSwimTime, parseEventKey } from '../../../lib/format.js';

const STROKE_LABELS: Record<string, string> = {
  FR: 'Freestyle',
  BK: 'Backstroke',
  BR: 'Breaststroke',
  FL: 'Butterfly',
  IM: 'IM',
};

export default function EventDetail() {
  const { eventKey, athleteId } = useLocalSearchParams<{
    eventKey: string;
    athleteId: string;
  }>();
  const swims = useSwims(athleteId, eventKey);
  const progression = useProgression(athleteId, eventKey);

  if (!eventKey || !athleteId) {
    return (
      <Screen>
        <ErrorMessage message="Missing event or athlete." />
        <Button label="Back" variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  const parts = parseEventKey(eventKey);
  const title = `${parts.distanceM}m ${STROKE_LABELS[parts.stroke] ?? parts.stroke} (${parts.course})`;

  return (
    <Screen scroll>
      <Text style={styles.h1}>{title}</Text>

      {progression.isLoading ? (
        <Loading />
      ) : progression.error ? (
        <ErrorMessage message={(progression.error as Error).message} />
      ) : progression.data?.points.length ? (
        <ProgressionChart points={progression.data.points} />
      ) : (
        <Text style={styles.muted}>No progression data yet.</Text>
      )}

      <Text style={styles.h2}>Swim history</Text>
      {swims.isLoading ? (
        <Loading />
      ) : swims.error ? (
        <ErrorMessage message={(swims.error as Error).message} />
      ) : (
        <FlatList
          scrollEnabled={false}
          data={swims.data?.swims ?? []}
          keyExtractor={(s) => s.id}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <Text style={styles.meet}>{item.meetName}</Text>
                <Text style={styles.date}>{new Date(item.swamAt).toLocaleDateString()}</Text>
              </View>
              <Text
                style={[styles.time, item.status !== 'OFFICIAL' ? styles.timeNonOfficial : null]}
              >
                {item.status === 'OFFICIAL' ? formatSwimTime(item.timeCentiseconds) : item.status}
              </Text>
            </View>
          )}
          ListEmptyComponent={<Text style={styles.muted}>No swims for this event yet.</Text>}
        />
      )}

      <Button
        label="Back"
        variant="secondary"
        onPress={() => router.back()}
        style={{ marginTop: spacing.xl }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  h1: { ...typography.display, color: colors.text, marginBottom: spacing.lg },
  h2: { ...typography.title, color: colors.text, marginTop: spacing.md, marginBottom: spacing.sm },
  muted: { ...typography.body, color: colors.textMuted },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  rowLeft: { flex: 1, gap: spacing.xs },
  meet: { ...typography.body, color: colors.text },
  date: { ...typography.caption, color: colors.textMuted },
  time: { ...typography.heading, color: colors.primary },
  timeNonOfficial: { color: colors.textMuted },
});
```

### Step 10.3: Typecheck + format

```bash
pnpm --filter @flipturn/mobile typecheck
pnpm format:check
```

Both exit 0.

### Step 10.4: Commit

```bash
git add apps/client/mobile/components apps/client/mobile/app
git commit -m "feat(mobile): event detail screen with progression chart + swim history"
```

Use exactly that commit message.

---

## Task 11: Manual smoke test against the running API

**Files:** none — this is a manual verification step.

Boot the API and the Expo dev server, then walk through the five screens against the seeded demo data.

### Step 11.1: Start the backend

In one terminal:

```bash
pnpm dev:up
pnpm db:reset && pnpm db:seed   # fresh DB with demo athletes
pnpm api:dev
```

API serves on `http://localhost:3000`.

### Step 11.2: Start the mobile dev server

In another terminal:

```bash
cd apps/client/mobile
pnpm start
```

Open with the iOS Simulator (`i` in the Expo CLI) or a physical device via Expo Go (scan the QR; if on physical device, set `EXPO_PUBLIC_API_BASE_URL` to your Mac's LAN IP first).

### Step 11.3: Walk through each screen

1. **Email entry:** enter `darrell@example.com` → tap "Send sign-in link" → confirmation screen appears.

2. **Magic link consume:** since the API is using `InMemoryEmailSender` in dev (no Resend key), the magic-link email isn't actually sent. Workaround for the smoke test: in a third terminal, query the local DB to fetch the most recent `MagicLinkToken`'s plaintext token (you'll need to query the InMemoryEmailSender's outbox via a debug endpoint, OR temporarily log the token in the API for dev testing).

   Simplest: in `apps/server/api/src/routes/auth.ts`, add a temporary `console.log({ token: tokenPlain })` line in the magic-link request handler, restart the API, request a link, copy the token from the API logs, then paste it into the deep-link URL.

   In Expo dev, open `flipturn://auth?token=<paste-here>` either via `xcrun simctl openurl booted "flipturn://auth?token=..."` (iOS sim) or Android equivalent.

   Verify: app navigates to magic-link landing → loading → home screen.

3. **Onboarding:** if it's a fresh account (no athletes), home will show "No athletes yet" + "Add swimmer" → tap, enter `4030816` (Ryan Cochrane's SNC ID) → tap "Add swimmer" → polling spinner → after a few seconds the worker scrapes and home shows Cochrane's PBs grouped by stroke.

   Note: the worker process must be running. If not, the onboarding poll will time out at 60s and home will show "Fetching swims…" indefinitely. Start the worker too:

   ```bash
   pnpm workers:start
   ```

4. **Home screen:** verify athlete name "Ryan Cochrane", PBs grouped by stroke (FR, BK, BR, FL, IM), each row is tappable.

5. **Event detail:** tap any PB row (e.g. `400m Freestyle (LCM)`) → progression chart renders → swim history list below.

If any of these breaks, capture the specific failure and report DONE_WITH_CONCERNS — don't try to fix in this task; flag for a follow-up.

### Step 11.4: Tear down

```bash
# Ctrl-C the workers, api, and Expo dev server in their terminals
pnpm dev:down
```

Remove the temporary `console.log({ token })` if you added one to the API.

### Step 11.5: Document the workaround

Add a "Manual smoke testing without Resend" section to `apps/client/mobile/README.md`:

```markdown
## Manual smoke testing

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
```

Commit the README update:

```bash
git add apps/client/mobile/README.md
git commit -m "docs(mobile): manual smoke-testing instructions for local dev"
```

## Self-Review

- API + workers + Expo all booted
- All 5 screens reachable and functional against seeded data
- README documents the dev-only token workaround

## Report Format

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Smoke-test results (pass/fail per screen)
- Any issues encountered
- README updated
- Commit SHA

---

## Task 12: ADR 0005 + final integration check

**Files:**

- Create: `docs/adr/0005-mobile-architecture.md`

### Step 12.1: Write ADR 0005

Create `docs/adr/0005-mobile-architecture.md`:

```markdown
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
```

### Step 12.2: Run all gates

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm format:check
```

All exit 0. Total tests: 29 (shared) + 2 (db) + 56 (workers) + 42 (api) + 14 (mobile) = **143**.

### Step 12.3: Verify clean install

```bash
rm -rf node_modules apps/*/*/node_modules packages/*/node_modules
pnpm install
pnpm typecheck
pnpm test
```

Expected: clean install succeeds; all 143 tests pass. `pnpm install` for the mobile package may take longer (~3-5 min) due to Expo's deep dep tree.

### Step 12.4: Commit ADR

```bash
git add docs/adr/0005-mobile-architecture.md
git commit -m "docs(mobile): adr 0005 mobile architecture"
```

Use exactly that commit message.

### Step 12.5: Push branch and open PR

```bash
git push -u origin feat/mobile
gh pr create --title "Plan 5 — Mobile (Expo + auth + onboarding + screens)" --body "$(cat <<'EOF'
## Summary

Plan 5 of 6 — `@flipturn/mobile` Expo / React Native client implementing the spec §8 screens:

- Email entry (magic-link request)
- Magic-link landing (consumes `flipturn://auth?token=…` deep link)
- Onboarding (SNC athlete ID input + scrape-poll loop)
- Home (athlete switcher + grouped PB list)
- Event detail (custom react-native-svg progression chart + swim history)

Architecture: expo-router for routing, React Query for server state, expo-secure-store for sessions, custom react-native-svg chart, vanilla StyleSheet + theme tokens. ADR 0005 documents the choices.

## Test Plan

- [x] `pnpm test` — 143 tests pass (29 shared + 2 db + 56 workers + 42 api + 14 mobile)
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm format:check` all green
- [x] Manual smoke against `pnpm dev:up && pnpm api:dev && pnpm workers:start`:
  - Email entry → magic-link request hits API
  - Magic-link landing consumes a token and stores a session
  - Onboarding accepts an SNC ID, kicks off a scrape, polls until done
  - Home displays grouped PBs for the athlete
  - Event detail renders progression chart + swim history

## Plan-5-known-deferred

- Real Resend email delivery wired into the running API (Plan 6)
- App icons / splash screens (placeholder solid-color PNGs in this plan; Plan 6)
- TestFlight / Expo internal-link distribution (Plan 6)
- Detox/Maestro automated UI testing (post-MVP)
- Designer pass / Tamagui or NativeWind upgrade (post-MVP)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Print the PR URL.

## Self-Review

- All 5 screens implemented and functional
- ADR 0005 committed
- 143 tests pass; typecheck, lint, format clean
- Clean install verified
- PR opened

## Report Format

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Total test count
- Output of clean reinstall + test cycle
- PR URL
- Self-review findings
- Final commit SHA on feat/mobile

---

## Acceptance criteria for Plan 5

This plan is complete when:

- [ ] `apps/client/mobile/` package exists with all modules in the file map
- [ ] All five MVP screens render and function against the running API: email entry, magic-link landing, onboarding, home, event detail
- [ ] Magic-link deep links work via `flipturn://auth?token=…`
- [ ] Session persists across app restarts via SecureStore
- [ ] Onboarding polls until scrape completes (or times out gracefully at 60s)
- [ ] Home groups PBs by stroke and orders by distance
- [ ] Event detail renders a custom SVG progression chart + swim history list
- [ ] ADR 0005 (mobile architecture) committed
- [ ] All 143 tests pass; typecheck/lint/format/clean-install all green
- [ ] Plan 5 PR opened against main

When all of the above are checked, hand off to Plan 6 — the final plan: hosting (Cloudflare Tunnel + pm2 + Resend domain verification + Sentry instrumentation) and closed-beta launch (TestFlight + Expo internal links + first 10–20 parents).

## Open items deferred to Plan 6

- Real Resend wiring + `flipturn.app` domain verification (SPF/DKIM/DMARC)
- TestFlight + Expo internal-link distribution
- pm2 production config + Cloudflare Tunnel
- Sentry actually capturing errors (the API and workers `Sentry.init` is wired but not instrumented)
- Per-IP rate limit on `POST /v1/auth/magic-link/request`
- Graceful shutdown that awaits in-flight requests (`server.close()` + close-idle-connections)
- Real `/v1/health` Redis check
- App icons + splash screens with the brand mark
- The Plan 4 carry-forward backlog (worker robustness, etc.)
