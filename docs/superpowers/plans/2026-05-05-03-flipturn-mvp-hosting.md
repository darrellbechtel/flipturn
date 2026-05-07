# Flip Turn MVP — Hosting + Closed-Beta Launch Plan (Plan 6 of 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Plan series:** This is the final plan in the series. The MVP is shippable when this plan completes.

- ✅ Plan 1 — Foundation (monorepo + db + shared) — landed
- ✅ Plan 2 — Spike + Worker infrastructure with stub parser — landed
- ✅ Plan 3 — Real parser + integration — landed
- ✅ Plan 4 — API (Hono + magic-link auth + endpoints) — landed
- ✅ Plan 5 — Mobile (Expo + auth + onboarding + screens) — landed
- **Plan 6 — Hosting + closed-beta launch (this plan)**

**Goal:** Take the locally-functional MVP and ship a closed-beta–ready system: Mac Mini production hosting via Cloudflare Tunnel + pm2; real Resend email delivery on a verified `flipturn.ca` domain; Expo SDK upgraded so the App Store version of Expo Go works; iOS + Android dev builds distributed via TestFlight + EAS internal links; the Plan 4–5 carry-forward backlog items closed; and a beta-recruit checklist with privacy / TOS / takedown surfaces in place. After this plan, the user can hand a TestFlight link to 10–20 swim parents and the system runs without intervention.

**Architecture:** No new packages. Existing services (`@flipturn/api`, `@flipturn/workers`, `@flipturn/mobile`) get production configuration, observability, and distribution. The Mac Mini runs `pm2` supervising `apps/server/api` + `apps/server/workers` + `docker compose`'s Postgres/Redis. Cloudflare Tunnel exposes the API to mobile clients without opening home-network ports. Resend sends real magic-link emails from `noreply@flipturn.ca`. EAS Build produces signed iOS / Android dev builds for closed-beta install.

**Tech Stack additions:**

- Expo SDK 54 (upgrade from 52)
- EAS CLI for build pipeline
- `cloudflared` for Cloudflare Tunnel
- pm2 for process supervision
- Resend domain verification (DNS records: SPF, DKIM, DMARC)
- A small Redis-backed rate limiter for the magic-link endpoint

**Recommended execution:** Use `superpowers:subagent-driven-development` with `model: "opus"` per the project's preference.

---

## Context the implementer needs

### What "shippable" means for this plan

The MVP closed beta target is 10–20 swim parents installing the app and using it weekly for 4 weeks (per spec §1's success criterion). To get there, the following must be true after Plan 6 completes:

1. **The mobile app is installable.** A friend of the founder can scan a QR / tap a TestFlight link and have the Flip Turn app on their phone — without needing Expo Go from the App Store, and without needing access to the Mac Mini's local network.
2. **The API is publicly reachable** from those phones, on a stable URL, with TLS, and at acceptable latency.
3. **Magic-link emails actually arrive** in the parents' inboxes from a domain that won't be marked as spam (SPF/DKIM/DMARC aligned to `flipturn.ca`).
4. **The scrape pipeline works** against `results.swimming.ca` from the Mac Mini's residential IP. (Plan 5 smoke surfaced a 403 from a different egress; the Mac's IP needs verification, with a fallback if it's also blocked.)
5. **Errors are observable.** Sentry actually captures unhandled errors in the API + workers; pm2 keeps services running; a heartbeat alerts if the worker stops.
6. **Beta-tester onboarding is welcoming.** Privacy policy + TOS pages are reachable; a takedown form exists; a support email is monitored.

### Out of scope (post-MVP — recorded for completeness)

- App Store + Play Store public submission (closed beta uses TestFlight + EAS internal links only)
- Stripe + paywall (MVP is unpaid validation)
- Time-standard tracking, push notifications, AI features, video, kid mode, recruiting tier (all deferred per spec)
- CI on a non-Mac-Mini host (optional Plan 7 item; the brief allows continuing on the Mac Mini for v1)
- Production-grade Sentry alert routing (Slack/PagerDuty) — basic Sentry email alerts only
- Designer-led visual polish for the mobile app (current UI is functional, not branded beyond color tokens + brand-mark icons)

### Plan 4–5 review backlog being closed in Plan 6

These were carried forward from prior reviews; this plan resolves each:

| ID           | Item                                                     |
| ------------ | -------------------------------------------------------- |
| Plan 4 #3    | Sentry init wired but doesn't capture errors             |
| Plan 4 #6    | No rate limit on `POST /v1/auth/magic-link/request`      |
| Plan 4 #7    | `server.close()` doesn't await in-flight requests        |
| Plan 4 #8    | `/v1/health` reports `redis: 'ok'` without checking      |
| Plan 5 #6    | `apiBaseUrl()` env error UX (use EAS build profiles)     |
| Plan 5 UX    | Stuck on "Add swimmer" with no back button               |
| Plan 5 SDK   | Expo SDK 52 — App Store Expo Go requires SDK 54          |
| Plan 5 smoke | Cloudflare 403 from non-residential IPs (Mac Mini check) |

### What the implementer can and cannot automate

| Task                      | Can the agent do it?                                                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Expo SDK 54 upgrade       | yes — `pnpm dlx expo@54 install`, run tests                                                                                                                 |
| Onboarding back button    | yes — small RN edit                                                                                                                                         |
| Sentry capture wiring     | yes — code change + tests                                                                                                                                   |
| Rate limit                | yes — Redis-backed implementation + tests                                                                                                                   |
| Graceful shutdown         | yes — code change                                                                                                                                           |
| Real Redis health         | yes — code change                                                                                                                                           |
| App icons / splash        | partial — generate brand-derived placeholders programmatically; final-quality icons benefit from a designer                                                 |
| EAS init / build profiles | partial — write the config; **EAS account setup + first build requires `npx eas-cli login` and Apple/Google developer credentials, which the user must do** |
| Cloudflare Tunnel         | partial — write config; **the user must `cloudflared tunnel login` (browser auth) and add the DNS record on `flipturn.ca`**                                 |
| Resend domain             | no — **the user must verify the domain in the Resend dashboard and add SPF/DKIM/DMARC records on `flipturn.ca`**                                            |
| Privacy / TOS / takedown  | partial — the agent can draft the markdown; the user accepts legal liability                                                                                |
| Recruit 10–20 parents     | no — the user's outreach                                                                                                                                    |

Tasks marked "partial" or "no" produce documentation + verification commands; the implementer flags them as DONE_WITH_CONCERNS and the user does the external step.

---

## File map (created/modified by this plan)

```
flipturn/
├── apps/
│   ├── client/mobile/
│   │   ├── package.json                   (MODIFY: SDK 54 versions)
│   │   ├── app.json                       (MODIFY: real eas projectId; updated runtime)
│   │   ├── eas.json                       (CREATE: build profiles)
│   │   ├── app/(app)/onboarding.tsx       (MODIFY: cancel button)
│   │   ├── assets/icon.png                (REPLACE: brand-mark variant)
│   │   ├── assets/splash.png              (REPLACE: brand-mark variant)
│   │   └── assets/adaptive-icon.png       (REPLACE: brand-mark variant)
│   └── server/
│       ├── api/
│       │   ├── src/middleware/error.ts    (MODIFY: Sentry capture)
│       │   ├── src/middleware/rateLimit.ts (CREATE: Redis-backed sliding window)
│       │   ├── src/routes/auth.ts         (MODIFY: apply rate limit)
│       │   ├── src/routes/ops.ts          (MODIFY: real Redis ping in /health)
│       │   ├── src/redis.ts               (CREATE: Redis client for API; mirror workers)
│       │   ├── src/index.ts               (MODIFY: graceful shutdown)
│       │   └── tests/middleware/rateLimit.test.ts (CREATE)
│       └── workers/
│           └── src/sentry.ts              (MODIFY: helpers for capture)
├── infra/
│   ├── pm2/ecosystem.config.cjs          (CREATE: pm2 production config)
│   ├── cloudflared/config.yml             (CREATE: tunnel config template)
│   └── README.md                          (CREATE: deployment runbook)
├── docs/
│   ├── adr/0006-production-deployment.md  (CREATE)
│   ├── legal/privacy-policy.md            (CREATE)
│   ├── legal/terms-of-service.md          (CREATE)
│   └── legal/takedown.md                  (CREATE)
└── PROJECT_BRIEF.md                       (no change)
```

The `infra/` directory is new. It holds production-deploy configs (pm2, cloudflared, env-secrets templates). It's not a workspace package — just static config files.

---

## Task 1: Expo SDK 52 → 54 upgrade

**Files:**

- Modify: `apps/client/mobile/package.json` (Expo SDK 54 dep versions)
- Modify: `apps/client/mobile/app.json` (runtimeVersion if needed)
- Possibly modify: `apps/client/mobile/babel.config.js`, `metro.config.js` (per migration notes)

### Step 1.1: Branch off main

```bash
git checkout main
git pull
git checkout -b feat/sdk54-upgrade
```

### Step 1.2: Run Expo's automated upgrade

```bash
cd apps/client/mobile
pnpm dlx expo@latest install --fix
```

This installs the SDK-aligned versions of every Expo dep. Expect updates to:

- `expo`, `expo-router`, `expo-linking`, `expo-secure-store`, `expo-constants`, `expo-status-bar`
- `react`, `react-native`, `react-native-reanimated`, `react-native-screens`, `react-native-safe-area-context`, `react-native-svg`, `react-native-gesture-handler`

If `--fix` flags additional packages, accept its suggestions.

### Step 1.3: Re-run pnpm install at the root

```bash
cd ../../..
pnpm install
```

The lockfile updates with the new versions.

### Step 1.4: Migrate breaking changes

Read [Expo SDK 53 release notes](https://expo.dev/changelog) and [SDK 54 release notes](https://expo.dev/changelog) for breaking changes between SDK 52 and 54. Common items to address:

- `expo-router` v4 → v5: route group syntax, navigation types
- React 18 → React 19 (peer-dep upgrade): some hook signatures may have moved
- `react-native` 0.76 → 0.78: `New Architecture` defaults; `Hermes` may need re-enable

If any of our code (`apps/client/mobile/`) breaks under typecheck, fix in place. The most likely friction points:

- `expo-router`'s typed-routes config (`app.json` `experiments.typedRoutes`) may move
- Some component prop names may have changed (rare for the core API surface we use)

### Step 1.5: Verify gates

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm format:check
```

All exit 0. Mobile-package tests should still be 14 passing.

### Step 1.6: Smoke-test on iOS Simulator

```bash
pnpm dev:up
pnpm api:dev &
pnpm mobile:dev
# Press 'i' to open iOS Simulator
```

Verify the app boots to the email entry screen. If a runtime error pops up that wasn't caught by typecheck, fix it (likely a deprecated component or hook).

### Step 1.7: Commit

```bash
git add apps/client/mobile package.json pnpm-lock.yaml
git commit -m "feat(mobile): upgrade Expo SDK 52 → 54"
```

### Step 1.8: Push + open PR

```bash
git push -u origin feat/sdk54-upgrade
gh pr create --title "Plan 6 #1 — Expo SDK 54 upgrade" --body "Run-of-the-mill SDK bump so the App Store version of Expo Go works for closed-beta testers. Migration done via expo install --fix; tests still pass."
```

Merge after review.

---

## Task 2: Onboarding back-button UX fix

**File:** `apps/client/mobile/app/(app)/onboarding.tsx`

### Step 2.1: Add a Cancel button at the bottom of the onboarding form

Read the current onboarding.tsx. Below the "Add swimmer" button, add a Cancel button that navigates back to home:

```tsx
<Button
  label="Cancel"
  variant="secondary"
  onPress={() => router.back()}
  style={{ marginTop: spacing.md }}
/>
```

(`router` is already imported from `expo-router`.)

If the user is mid-poll (`pollingForId !== null`), the Cancel button should also clear `pollingForId` so the cleanup effect fires:

```tsx
<Button
  label="Cancel"
  variant="secondary"
  onPress={() => {
    setPollingForId(null);
    router.back();
  }}
  style={{ marginTop: spacing.md }}
/>
```

### Step 2.2: Manual smoke

In the simulator: home → Add swimmer → Cancel → returns to home. Both before and after entering an SNC ID.

### Step 2.3: Commit + PR

```bash
git checkout -b fix/onboarding-cancel
git add apps/client/mobile/app/\(app\)/onboarding.tsx
git commit -m "fix(mobile): cancel button on onboarding (no longer stuck)"
git push -u origin fix/onboarding-cancel
gh pr create --title "Plan 6 #2 — Onboarding cancel button"
```

This and the SDK upgrade can land independently or in the same PR; the implementer picks.

---

## Task 3: Brand-derived app icons + splash

**Files:**

- Replace: `apps/client/mobile/assets/icon.png` (1024×1024)
- Replace: `apps/client/mobile/assets/splash.png` (1284×2778 portrait)
- Replace: `apps/client/mobile/assets/adaptive-icon.png` (Android adaptive, 1024×1024 foreground on `#1F3D5C` background — the `app.json`'s `backgroundColor` already handles the back layer)

The brief calls for "maple leaf silhouette with a swimmer mid-stroke and stylized waves." Without a designer, the implementer ships a **text-mark placeholder** that's at least branded:

### Step 3.1: Generate text-mark icons via the existing Python helper

The Plan 5 Task 1 implementer used a Python script to generate solid-color PNGs. Extend it to draw a text-based logo using PIL (Pillow). PIL is in macOS's bundled Python by default; if not, install via `pip3 install Pillow`.

Create `/tmp/mkicon-textmark.py`:

```python
import sys
from PIL import Image, ImageDraw, ImageFont

def render(size, scale, output, color_bg='#1F3D5C', color_fg='#FFFFFF', text='F'):
    img = Image.new('RGB', (size, size), color_bg)
    draw = ImageDraw.Draw(img)
    # Use the system default font scaled large
    try:
        font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', int(size * scale))
    except OSError:
        font = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    draw.text(((size - w) / 2 - bbox[0], (size - h) / 2 - bbox[1]), text, fill=color_fg, font=font)
    img.save(output)

render(1024, 0.7, sys.argv[1] if len(sys.argv) > 1 else 'icon.png')
```

Run:

```bash
python3 /tmp/mkicon-textmark.py apps/client/mobile/assets/icon.png
python3 /tmp/mkicon-textmark.py apps/client/mobile/assets/adaptive-icon.png

# Splash is portrait — generate a centered version:
python3 -c "
from PIL import Image, ImageDraw, ImageFont
W, H = 1284, 2778
img = Image.new('RGB', (W, H), '#1F3D5C')
d = ImageDraw.Draw(img)
font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', 600)
bbox = d.textbbox((0, 0), 'F', font=font)
w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
d.text(((W - w) / 2 - bbox[0], (H - h) / 2 - bbox[1]), 'F', fill='#C8332D', font=font)
img.save('apps/client/mobile/assets/splash.png')
"
```

This produces:

- `icon.png`, `adaptive-icon.png`: white "F" on navy `#1F3D5C` background
- `splash.png`: red "F" on navy background (matches the brand red `#C8332D`)

Not the final designer mark, but better than solid color — readable on the simulator + TestFlight.

### Step 3.2: Document the placeholder + final-asset plan

In `apps/client/mobile/README.md`, add a "Brand assets" section:

```markdown
## Brand assets

Plan 6 ships placeholder icons (white "F" wordmark on navy `#1F3D5C`).
Final designer-built mark with maple-leaf + swimmer + waves silhouette
ships post-MVP. To replace:

1. Get final 1024×1024 PNGs (icon, adaptive-icon foreground) and 1284×2778
   portrait splash from the designer.
2. Drop into `apps/client/mobile/assets/`, overwriting the placeholders.
3. Re-build via EAS: `npx eas-cli build --profile development --platform all`.
```

### Step 3.3: Commit

```bash
git checkout -b feat/brand-icons
git add apps/client/mobile/assets apps/client/mobile/README.md
git commit -m "feat(mobile): wordmark-on-navy placeholder icons (designer mark post-MVP)"
git push -u origin feat/brand-icons
gh pr create --title "Plan 6 #3 — Wordmark placeholder icons"
```

---

## Task 4: Sentry capture wiring (API + workers)

**Files:**

- Modify: `apps/server/api/src/middleware/error.ts`
- Modify: `apps/server/api/src/index.ts` (Sentry init at boot)
- Modify: `apps/server/workers/src/worker.ts` and `scheduler.ts` (catch errors per job)

### Step 4.1: Add `Sentry.captureException` in API errorHandler

Read `apps/server/api/src/middleware/error.ts`. After the `log.error({ err }, 'unhandled error')` line in the `internal_error` branch, add:

```ts
import { Sentry } from '../sentry.js';

// ...inside errorHandler, in the unhandled-error branch:
log.error({ err }, 'unhandled error');
Sentry.captureException(err); // NEW
return c.json({ error: { code: 'internal_error', message: 'Internal Server Error' } }, 500);
```

For `ApiError` 5xx (status >= 500), also capture. For 4xx, skip — those are client-induced.

The `ApiError` branch can become:

```ts
if (err instanceof ApiError) {
  log.warn({ err, status: err.status, code: err.code }, 'api error');
  if (err.status >= 500) {
    Sentry.captureException(err);
  }
  return c.json(
    { error: { code: err.code ?? 'api_error', message: err.message } },
    err.status as 400 | 401 | 403 | 404 | 409 | 500,
  );
}
```

### Step 4.2: Add `Sentry.captureException` in workers

Read `apps/server/workers/src/worker.ts`. The existing `worker.on('failed', (job, err) => ...)` handlers log to pino. Add a Sentry capture call:

```ts
import { Sentry } from './sentry.js';

worker.on('failed', (job, err) => {
  if (err instanceof FetchRetryError) {
    log.warn({ jobId: job?.id, retryAfterMs: err.retryAfterMs }, 'job will retry on backoff');
  } else {
    log.error({ jobId: job?.id, err }, 'job failed');
    Sentry.captureException(err);
  }
});
```

Same for the scheduler worker's `failed` handler.

### Step 4.3: Verify in dev

Sentry is no-op without `SENTRY_DSN`. To verify the capture path actually fires (without a real Sentry account):

- Add a temporary route at `apps/server/api/src/routes/ops.ts`:
  ```ts
  if (process.env.NODE_ENV !== 'production') {
    r.get('/__crash', () => {
      throw new Error('test crash');
    });
  }
  ```
- Boot the API, hit `curl http://localhost:3000/v1/__crash`
- Verify in API logs that the `errorHandler` runs and `Sentry.captureException` is called (add a temp `console.log` inside `Sentry.captureException` if needed, then revert)
- Remove the crash route before commit

### Step 4.4: Tests

Add to `apps/server/api/tests/ops.test.ts` an integration test that confirms unhandled errors return 500 (already covered by happy path; explicit 500 path may need adding). For Sentry capture itself, mock `Sentry.captureException` and assert it was called. Reference the testApp helper.

```ts
import { vi } from 'vitest';
vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
}));
```

If wiring this test gets complex, document the Sentry path as manual-QA and skip the unit test for now. The prod evidence comes from real DSN-connected Sentry events post-deploy.

### Step 4.5: Commit + PR

```bash
git checkout -b feat/sentry-capture
git add apps/server
git commit -m "feat(api,workers): wire Sentry.captureException into error paths"
git push -u origin feat/sentry-capture
gh pr create --title "Plan 6 #4 — Sentry capture (API + workers)"
```

---

## Task 5: Rate-limit the magic-link endpoint

**Files:**

- Create: `apps/server/api/src/redis.ts` (mirror workers' redis.ts pattern)
- Create: `apps/server/api/src/middleware/rateLimit.ts`
- Modify: `apps/server/api/src/routes/auth.ts` (apply the middleware)
- Create: `apps/server/api/tests/middleware/rateLimit.test.ts`
- Modify: `apps/server/api/src/app.ts` (pass redis into the route closure)

### Step 5.1: Create API's Redis client

Read `apps/server/workers/src/redis.ts` for the exact pattern. Create `apps/server/api/src/redis.ts` with the same structure:

```ts
import { Redis, type RedisOptions } from 'ioredis';
import { getEnv } from './env.js';
import { getLogger } from './logger.js';

let _client: Redis | undefined;

const COMMON_OPTIONS: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: false,
};

export function getRedis(): Redis {
  if (!_client) {
    const env = getEnv();
    _client = new Redis(env.REDIS_URL, COMMON_OPTIONS);
    _client.on('error', (err) => getLogger().error({ err }, 'redis error'));
    _client.on('connect', () => getLogger().debug('redis connected'));
  }
  return _client;
}

export async function disconnectRedis(): Promise<void> {
  if (_client) {
    await _client.quit();
    _client = undefined;
  }
}
```

This requires `ioredis` as a dep of the API package. Add to `apps/server/api/package.json`:

```json
"ioredis": "^5.4.1",
```

### Step 5.2: Implement the rate limiter

Create `apps/server/api/src/middleware/rateLimit.ts`:

```ts
import type { Context, Next } from 'hono';
import type { Redis } from 'ioredis';
import { ApiError } from './error.js';

export interface RateLimitOptions {
  /** Logical bucket name; combined with the request identity. */
  readonly bucket: string;
  /** Window length in seconds. */
  readonly windowSec: number;
  /** Max requests per window. */
  readonly limit: number;
  /** Identity extractor. Default: IP. */
  readonly identify?: (c: Context) => string;
}

function defaultIdentify(c: Context): string {
  // Cloudflare Tunnel injects cf-connecting-ip; fall back to x-forwarded-for, then req.ip.
  return (
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

export function rateLimit(redis: Redis, options: RateLimitOptions) {
  const identify = options.identify ?? defaultIdentify;
  return async (c: Context, next: Next): Promise<Response | void> => {
    const id = identify(c);
    const key = `rl:${options.bucket}:${id}`;
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, options.windowSec);
    }
    if (count > options.limit) {
      throw new ApiError(429, 'Too many requests', 'rate_limited');
    }
    await next();
  };
}
```

This is an INCR-with-TTL pattern: simple, atomic, sliding-window-ish (technically a fixed window with reset on first hit). Adequate for closed beta.

### Step 5.3: Apply to magic-link endpoint

Modify `apps/server/api/src/routes/auth.ts`. The `authRoutes(deps)` factory takes `AppDeps` which includes `prisma` and `email`. Extend `AppDeps` to optionally include `redis`:

```ts
// in app.ts
import type { Redis } from 'ioredis';

export interface AppDeps {
  // ... existing fields
  readonly redis?: Redis; // optional so testApp helper can omit if rate-limit not needed
}
```

In `auth.ts`, apply the middleware to the magic-link request route only:

```ts
import { rateLimit } from '../middleware/rateLimit.js';

export function authRoutes(deps: AppDeps): Hono {
  const r = new Hono();
  r.onError(errorHandler);

  // Rate limit: 5 magic-link requests per IP per hour.
  // Closed beta has ~10-20 users; this is generous enough for legitimate users
  // and tight enough to slow down email-bomb / token-spam attempts.
  if (deps.redis) {
    r.post(
      '/magic-link/request',
      rateLimit(deps.redis, {
        bucket: 'magic-link-request',
        windowSec: 3600,
        limit: 5,
      }),
      // ... existing zValidator + handler
    );
  } else {
    // Fallback for tests without a Redis dep
    r.post('/magic-link/request' /* existing handlers */);
  }
  // ... other routes unchanged
}
```

Or cleaner: always apply the rate limit, but the testApp helper provides a fake Redis that's reset between tests. Choose whichever is simpler given the existing test architecture.

### Step 5.4: Write the rate-limit unit test

Create `apps/server/api/tests/middleware/rateLimit.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { Hono } from 'hono';
import { Redis } from 'ioredis';
import { rateLimit } from '../../src/middleware/rateLimit.js';
import { errorHandler } from '../../src/middleware/error.js';

const TEST_REDIS_URL = 'redis://localhost:56379';
const redis = new Redis(TEST_REDIS_URL, { maxRetriesPerRequest: null });

describe('rateLimit middleware', () => {
  beforeEach(async () => {
    const keys = await redis.keys('rl:test-bucket:*');
    if (keys.length) await redis.del(...keys);
  });

  afterAll(async () => {
    await redis.quit();
  });

  it('allows up to `limit` requests, then 429s', async () => {
    const app = new Hono();
    app.onError(errorHandler);
    app.use(
      '/limited',
      rateLimit(redis, {
        bucket: 'test-bucket',
        windowSec: 60,
        limit: 3,
        identify: () => 'fixed-ip',
      }),
    );
    app.get('/limited', (c) => c.json({ ok: true }));

    expect((await app.request('/limited')).status).toBe(200);
    expect((await app.request('/limited')).status).toBe(200);
    expect((await app.request('/limited')).status).toBe(200);
    expect((await app.request('/limited')).status).toBe(429);
  });

  it('isolates buckets by identity', async () => {
    const app = new Hono();
    app.onError(errorHandler);
    let id = 'a';
    app.use(
      '/limited',
      rateLimit(redis, {
        bucket: 'test-bucket',
        windowSec: 60,
        limit: 1,
        identify: () => id,
      }),
    );
    app.get('/limited', (c) => c.json({ ok: true }));

    expect((await app.request('/limited')).status).toBe(200);
    expect((await app.request('/limited')).status).toBe(429);
    id = 'b';
    expect((await app.request('/limited')).status).toBe(200);
  });
});
```

### Step 5.5: Update testApp.ts to provide Redis

Modify `apps/server/api/tests/helpers/testApp.ts` to include a real Redis client (not the fake) since this is integration territory:

```ts
import { Redis } from 'ioredis';
const redis = new Redis('redis://localhost:56379', { maxRetriesPerRequest: null });

const app = createApp({
  // ... existing fields
  redis,
});
```

Add cleanup in `teardown` to `redis.quit()` and clear any rl: keys.

### Step 5.6: Verify gates

```bash
pnpm --filter @flipturn/api typecheck
pnpm --filter @flipturn/api test
```

The auth.routes.test.ts existing tests should still pass — they fire single requests under the rate limit. Add explicit "exceeds limit" tests as part of this task if desired.

### Step 5.7: Commit + PR

```bash
git checkout -b feat/rate-limit
git add apps/server/api
git commit -m "feat(api): redis-backed rate limit on magic-link request (5/hour/IP)"
git push -u origin feat/rate-limit
gh pr create --title "Plan 6 #5 — Rate-limit magic-link endpoint"
```

---

## Task 6: Graceful shutdown

**File:** `apps/server/api/src/index.ts`

### Step 6.1: Replace the shutdown handler

Read the current shutdown logic. Replace with a version that awaits in-flight requests:

```ts
const shutdown = async (signal: string) => {
  log.info({ signal }, 'shutting down');
  // Stop accepting new connections; await in-flight requests up to 10s.
  await new Promise<void>((resolve) => {
    server.close((err) => {
      if (err) log.warn({ err }, 'server.close error');
      resolve();
    });
    // Force-close idle keep-alive sockets so the close callback can fire.
    if (
      typeof (server as { closeIdleConnections?: () => void }).closeIdleConnections === 'function'
    ) {
      (server as { closeIdleConnections: () => void }).closeIdleConnections();
    }
    // Hard timeout in case connections are stuck
    setTimeout(() => {
      log.warn('shutdown timeout exceeded; forcing exit');
      resolve();
    }, 10_000).unref();
  });
  await prisma.$disconnect();
  process.exit(0);
};
```

`unref()` on the timeout means the timer doesn't keep the event loop alive on its own.

### Step 6.2: Manual smoke

```bash
pnpm api:dev &
API_PID=$!
sleep 3

# Open a slow request (simulate via curl with --max-time)
curl -m 30 http://localhost:3000/v1/health &

# Send SIGTERM mid-flight
kill -TERM $API_PID
```

The shutdown should wait for the in-flight request to complete (or timeout after 10s).

### Step 6.3: Commit + PR

```bash
git checkout -b feat/graceful-shutdown
git add apps/server/api/src/index.ts
git commit -m "feat(api): graceful shutdown awaits in-flight requests"
git push -u origin feat/graceful-shutdown
gh pr create --title "Plan 6 #6 — Graceful shutdown"
```

---

## Task 7: Real Redis health check

**File:** `apps/server/api/src/routes/ops.ts`

### Step 7.1: Replace the hardcoded `redis: 'ok'` with a real ping

```ts
import { getRedis } from '../redis.js';

export function healthRoute(deps: AppDeps): Hono {
  const r = new Hono();
  r.onError(errorHandler);
  r.get('/', async (c) => {
    let dbStatus: 'ok' | 'fail' = 'ok';
    try {
      await deps.prisma.$queryRaw`SELECT 1`;
    } catch {
      dbStatus = 'fail';
    }

    let redisStatus: 'ok' | 'fail' = 'ok';
    try {
      const redis = deps.redis ?? getRedis();
      const reply = await Promise.race([
        redis.ping(),
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000)),
      ]);
      if (reply !== 'PONG') redisStatus = 'fail';
    } catch {
      redisStatus = 'fail';
    }

    return c.json({ db: dbStatus, redis: redisStatus });
  });
  return r;
}
```

### Step 7.2: Update tests

Modify `apps/server/api/tests/ops.test.ts`'s `/v1/health` test to assert `redis: 'ok'` (the test harness now provides Redis). If the test harness doesn't include Redis, mock `getRedis` to return a fake.

### Step 7.3: Commit + PR

```bash
git checkout -b feat/redis-health-check
git add apps/server/api
git commit -m "feat(api): /v1/health actually pings Redis with 1s timeout"
git push -u origin feat/redis-health-check
gh pr create --title "Plan 6 #7 — Real Redis health check"
```

---

## Task 8: pm2 ecosystem config

**Files:**

- Create: `infra/pm2/ecosystem.config.cjs`
- Create: `infra/README.md`

### Step 8.1: Create `infra/pm2/ecosystem.config.cjs`

```js
/**
 * pm2 ecosystem config for the Mac Mini production deploy.
 *
 * Run from the repo root:
 *   pm2 start infra/pm2/ecosystem.config.cjs
 *   pm2 save
 *   pm2 startup    # follow the printed instruction to enable auto-start at boot
 *
 * Logs land in ~/.pm2/logs/. Aggregate them with:
 *   pm2 logs flipturn-api flipturn-workers
 */

module.exports = {
  apps: [
    {
      name: 'flipturn-api',
      cwd: __dirname + '/../..',
      script: 'pnpm',
      args: 'api:start',
      env: {
        NODE_ENV: 'production',
        // Real values come from /Users/<user>/.config/flipturn/secrets.env
        // Loaded via pm2's `env_file` (see below).
      },
      env_file: '/Users/darrell/.config/flipturn/secrets.env',
      autorestart: true,
      max_memory_restart: '512M',
      time: true,
    },
    {
      name: 'flipturn-workers',
      cwd: __dirname + '/../..',
      script: 'pnpm',
      args: 'workers:start',
      env: { NODE_ENV: 'production' },
      env_file: '/Users/darrell/.config/flipturn/secrets.env',
      autorestart: true,
      max_memory_restart: '512M',
      time: true,
    },
    {
      name: 'flipturn-tunnel',
      cwd: __dirname + '/cloudflared',
      script: 'cloudflared',
      args: 'tunnel --config /Users/darrell/.config/cloudflared/config.yml run',
      autorestart: true,
      time: true,
    },
  ],
};
```

The `env_file` paths assume the user's home is `/Users/darrell`. Generalize via a comment if the deployer is a different user.

### Step 8.2: Document the secrets file

Create `infra/README.md`:

```markdown
# Flip Turn — production deployment runbook

This directory holds production-deploy configs for the Mac Mini host.
Plan 6 introduced these; nothing here is referenced from the application
code at runtime — they're operational scaffolding.

## Files

- `pm2/ecosystem.config.cjs` — pm2 process definitions for `flipturn-api`,
  `flipturn-workers`, and `flipturn-tunnel` (cloudflared)
- `cloudflared/config.yml` — tunnel routing config

## Secrets file (`~/.config/flipturn/secrets.env`)

pm2 loads production env vars from this file. Create it manually on the
Mac Mini (NEVER commit it). Required keys:

\`\`\`bash
DATABASE_URL="postgresql://flipturn:<password>@localhost:55432/flipturn?schema=public"
REDIS_URL="redis://localhost:56379"

# Sentry — get the DSN from sentry.io (free tier, one project per service is fine)

SENTRY_DSN=""

# Resend — get from resend.com after verifying flipturn.ca

RESEND*API_KEY="re*..."
EMAIL_FROM="Flip Turn <noreply@flipturn.ca>"

# API tuning

PORT=3000
BASE_URL="https://api.flipturn.ca"
MOBILE_DEEP_LINK_BASE="https://flipturn.ca/auth" # Universal Links once enabled (Task 12)
LOG_LEVEL="info"

# Worker politeness

SCRAPE_USER_AGENT="FlipTurnBot/0.1 (+https://flipturn.ca/bot; contact@flipturn.ca)"
SCRAPE_RATE_LIMIT_MS=5000
SCRAPE_DAILY_HOST_BUDGET=500
ARCHIVE_DIR="/Users/darrell/flipturn-data/raw"
\`\`\`

Permissions: \`chmod 600 ~/.config/flipturn/secrets.env\` so only the
deploying user can read it.

## First deploy

1. Install pm2 globally: \`npm install -g pm2\`.
2. \`pnpm install && pnpm db:migrate && pnpm db:seed-fixture\` (the last
   one is optional but seeds Cochrane for smoke testing).
3. Verify \`docker compose -f compose.dev.yaml up -d\` is running (Postgres + Redis).
4. Create \`~/.config/flipturn/secrets.env\` per above.
5. \`cloudflared tunnel login\` then \`cloudflared tunnel create flipturn-prod\`
   and place the tunnel's \`<UUID>.json\` credentials at the path referenced
   in \`infra/cloudflared/config.yml\`.
6. \`pm2 start infra/pm2/ecosystem.config.cjs\`.
7. \`pm2 save\` then run the printed \`pm2 startup\` command (sudo).

## Routine ops

\`\`\`bash
pm2 status # all three processes Online
pm2 logs flipturn-api --lines 100 # last 100 API log lines
pm2 logs flipturn-workers --lines 100
pm2 reload flipturn-api # zero-downtime reload after a deploy
pm2 reload flipturn-workers
\`\`\`

## Updating

\`\`\`bash
cd ~/flipturn
git pull
pnpm install
pnpm db:migrate
pm2 reload flipturn-api flipturn-workers
\`\`\`

## Tearing down

\`\`\`bash
pm2 stop flipturn-api flipturn-workers flipturn-tunnel
pm2 delete flipturn-api flipturn-workers flipturn-tunnel
\`\`\`
```

### Step 8.3: Commit + PR

```bash
git checkout -b feat/pm2-config
git add infra
git commit -m "feat(infra): pm2 ecosystem config + deployment runbook"
git push -u origin feat/pm2-config
gh pr create --title "Plan 6 #8 — pm2 ecosystem config"
```

---

## Task 9: Cloudflare Tunnel setup

**Files:**

- Create: `infra/cloudflared/config.yml`
- Update: `infra/README.md` (cross-reference)

### Step 9.1: Write the tunnel config template

Create `infra/cloudflared/config.yml`:

```yaml
# Cloudflare Tunnel config for the Flip Turn API.
#
# Setup steps (one-time, on the Mac Mini):
#   1. brew install cloudflared
#   2. cloudflared tunnel login              # opens browser, OAuth to Cloudflare
#   3. cloudflared tunnel create flipturn-prod
#   4. Place the printed credentials JSON at the path below
#   5. Add a CNAME record in the Cloudflare DNS panel:
#         api.flipturn.ca  →  <TUNNEL_UUID>.cfargotunnel.com
#      (or: cloudflared tunnel route dns flipturn-prod api.flipturn.ca)
#   6. Test: cloudflared tunnel run flipturn-prod
#      Then curl https://api.flipturn.ca/v1/health → {"db":"ok","redis":"ok"}
#   7. Wire into pm2: see infra/pm2/ecosystem.config.cjs

# Replace <TUNNEL_UUID> with the tunnel's UUID printed by `tunnel create`.
tunnel: <TUNNEL_UUID>
credentials-file: /Users/darrell/.cloudflared/<TUNNEL_UUID>.json

ingress:
  - hostname: api.flipturn.ca
    service: http://localhost:3000

  # Catch-all (required by cloudflared)
  - service: http_status:404
```

### Step 9.2: Document smoke test

Add to `infra/README.md`'s "First deploy" section:

```markdown
### Verify Cloudflare Tunnel

After `pm2 start`, the tunnel process should connect within ~10s. From a
laptop or phone NOT on the home network:

\`\`\`bash
curl -i https://api.flipturn.ca/v1/health
\`\`\`

Expected: HTTP 200, body `{"db":"ok","redis":"ok"}`. Cloudflare will
also show the tunnel as "Healthy" in the Zero Trust dashboard.
```

### Step 9.3: Document the user steps the implementer can't automate

The implementer flags this task as DONE_WITH_CONCERNS — the agent can write the config files, but the user must:

- Sign in to Cloudflare and ensure `flipturn.ca` is in their account
- Run `cloudflared tunnel login` (browser auth)
- Run `cloudflared tunnel create flipturn-prod` (records UUID + credentials JSON)
- Substitute the real UUID into `infra/cloudflared/config.yml`
- Add the DNS CNAME

### Step 9.4: Commit + PR

```bash
git checkout -b feat/cloudflare-tunnel-config
git add infra
git commit -m "feat(infra): cloudflared tunnel config template + runbook"
git push -u origin feat/cloudflare-tunnel-config
gh pr create --title "Plan 6 #9 — Cloudflare Tunnel config"
```

---

## Task 10: Resend domain verification

**Files:** none — this is operational work + documentation.

### Step 10.1: Document the steps

Add a "Resend setup" section to `infra/README.md`:

```markdown
## Resend setup

The API sends magic-link emails through Resend. The free tier is sufficient
for closed beta (up to 3,000 emails/month, 100/day).

### One-time: register the sending domain

1. Sign in to https://resend.com (free signup).
2. Add `flipturn.ca` as a sending domain.
3. Resend prints SPF, DKIM, and DMARC DNS records. Add them on
   the Cloudflare DNS panel (or wherever flipturn.ca is hosted):
   - **SPF** — TXT record on `flipturn.ca`:
     `v=spf1 include:_spf.resend.com ~all`
   - **DKIM** — Three CNAME records on subdomains like
     `resend._domainkey.flipturn.ca` (Resend prints exact names + values).
   - **DMARC** — TXT on `_dmarc.flipturn.ca`:
     `v=DMARC1; p=quarantine; rua=mailto:<your-monitoring-mailbox>`

4. Click "Verify" in the Resend dashboard. Verification takes 5–60 minutes
   depending on DNS propagation.
5. Generate a Resend API key (production scope) and put it in
   `~/.config/flipturn/secrets.env` as `RESEND_API_KEY=re_...`.

### Smoke test

After `pm2 start`, request a magic link:

\`\`\`bash
curl -X POST https://api.flipturn.ca/v1/auth/magic-link/request \\
-H 'content-type: application/json' \\
-d '{"email":"<your-actual-inbox>@gmail.com"}'
\`\`\`

The email should arrive in 5-30 seconds. Check that:

- It comes from `noreply@flipturn.ca` (matches `EMAIL_FROM`)
- It's not in the spam folder
- The deep link opens the app on the phone (Universal Links — see Task 12)
```

### Step 10.2: Commit + PR

```bash
git checkout -b docs/resend-setup
git add infra/README.md
git commit -m "docs(infra): resend domain verification + smoke test"
git push -u origin docs/resend-setup
gh pr create --title "Plan 6 #10 — Resend setup runbook"
```

---

## Task 11: EAS Build profiles

**Files:**

- Create: `apps/client/mobile/eas.json`
- Modify: `apps/client/mobile/app.json` (real `eas.projectId`)

### Step 11.1: Write `apps/client/mobile/eas.json`

```json
{
  "cli": { "version": ">= 12.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "channel": "development",
      "env": {
        "EXPO_PUBLIC_API_BASE_URL": "https://api.flipturn.ca"
      },
      "ios": {
        "simulator": false
      }
    },
    "preview": {
      "distribution": "internal",
      "channel": "preview",
      "env": {
        "EXPO_PUBLIC_API_BASE_URL": "https://api.flipturn.ca"
      }
    },
    "production": {
      "channel": "production",
      "env": {
        "EXPO_PUBLIC_API_BASE_URL": "https://api.flipturn.ca"
      },
      "ios": {
        "autoIncrement": true
      },
      "android": {
        "autoIncrement": true
      }
    }
  },
  "submit": {
    "production": {}
  }
}
```

### Step 11.2: Initialize EAS

Document the user steps:

```bash
cd apps/client/mobile
npx eas-cli login                  # browser auth to Expo account
npx eas-cli project:init           # creates project on expo.dev, writes projectId into app.json
```

After `project:init`, `app.json`'s `extra.eas.projectId` is updated with the real UUID. Commit that change.

### Step 11.3: First development build

```bash
cd apps/client/mobile
npx eas-cli build --profile development --platform ios
npx eas-cli build --profile development --platform android
```

Each takes 10–30 min in EAS's cloud. iOS produces an `.ipa` for TestFlight; Android produces an `.apk` for direct install.

### Step 11.4: Distribute internal builds

After builds complete, `eas-cli` prints internal-share URLs. For iOS:

- Upload `.ipa` to TestFlight via App Store Connect (manual step, requires Apple Developer account)
- Or distribute via EAS Update preview link

For Android:

- Upload `.apk` to a download host or share via EAS internal links
- Or use Google Play Internal Testing track (requires Google Play Developer account)

### Step 11.5: Test the build on a real device

Install the dev build on the founder's iPhone. Verify:

- App icon shows the wordmark placeholder (Task 3)
- Email entry → magic-link request → email arrives at the founder's inbox
- Tap the link in the email → opens directly into the app (Universal Links — see Task 12)
- Onboard `4030816` → home screen populates with Cochrane's PBs

### Step 11.6: Commit + PR

```bash
git checkout -b feat/eas-build-profiles
git add apps/client/mobile/eas.json apps/client/mobile/app.json
git commit -m "feat(mobile): EAS build profiles (development/preview/production)"
git push -u origin feat/eas-build-profiles
gh pr create --title "Plan 6 #11 — EAS Build profiles"
```

The implementer flags this task as DONE_WITH_CONCERNS — the user must run `eas-cli login` and the first build manually.

---

## Task 12: Universal Links (iOS) + App Links (Android)

**Why:** Once we send real magic-link emails, the email client may refuse `flipturn://` schemes (especially Gmail/Apple Mail with stricter URL handling), and SMS-shared links definitely won't open the app. Universal Links + App Links use real `https://` URLs that the OS routes to the installed app.

**Files:**

- Modify: `apps/client/mobile/app.json` (`ios.associatedDomains`, `android.intentFilters`)
- Modify: `apps/server/api/src/env.ts` (allow `MOBILE_DEEP_LINK_BASE` to be an HTTPS URL)
- Create: `apps/server/api/src/routes/well-known.ts` (serves `apple-app-site-association` + `assetlinks.json`)

### Step 12.1: Update `app.json`

Add to the `ios` block:

```json
"ios": {
  "supportsTablet": false,
  "bundleIdentifier": "app.flipturn.mobile",
  "associatedDomains": ["applinks:flipturn.ca"]
}
```

Add to the `android` block:

```json
"android": {
  "package": "app.flipturn.mobile",
  "intentFilters": [
    {
      "action": "VIEW",
      "data": [{ "scheme": "https", "host": "flipturn.ca", "pathPrefix": "/auth" }],
      "category": ["BROWSABLE", "DEFAULT"],
      "autoVerify": true
    }
  ]
}
```

### Step 12.2: Serve the verification files from the API

Create `apps/server/api/src/routes/well-known.ts`:

```ts
import { Hono } from 'hono';

const APP_BUNDLE_ID = 'app.flipturn.mobile';
const APP_TEAM_ID_PLACEHOLDER = 'TEAMID'; // replace with the Apple Team ID after EAS build

export function wellKnownRoutes(): Hono {
  const r = new Hono();

  // Apple Universal Links
  r.get('/apple-app-site-association', (c) =>
    c.json({
      applinks: {
        apps: [],
        details: [
          {
            appID: `${APP_TEAM_ID_PLACEHOLDER}.${APP_BUNDLE_ID}`,
            paths: ['/auth*'],
          },
        ],
      },
    }),
  );

  // Android App Links
  r.get('/assetlinks.json', (c) =>
    c.json([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: APP_BUNDLE_ID,
          sha256_cert_fingerprints: ['<sha256-from-eas-build>'],
        },
      },
    ]),
  );

  return r;
}
```

Mount in `apps/server/api/src/app.ts`:

```ts
import { wellKnownRoutes } from './routes/well-known.js';
// ...
app.route('/.well-known', wellKnownRoutes());
```

### Step 12.3: Update `MOBILE_DEEP_LINK_BASE`

In production env (`~/.config/flipturn/secrets.env`):

```
MOBILE_DEEP_LINK_BASE="https://flipturn.ca/auth"
```

The magic-link email body now contains `https://flipturn.ca/auth?token=…` instead of `flipturn://auth?token=…`. iOS and Android route the URL to the installed app (or open in the browser if the app isn't installed — graceful fallback).

### Step 12.4: Test

After EAS build (Task 11) is installed on a device:

1. Get the Apple Team ID from `eas-cli` output or App Store Connect; substitute in `well-known.ts`.
2. Get the Android SHA-256 cert fingerprint from EAS build output; substitute in `assetlinks.json`.
3. Deploy the API.
4. Verify the verification files are served:
   ```bash
   curl https://flipturn.ca/.well-known/apple-app-site-association
   curl https://flipturn.ca/.well-known/assetlinks.json
   ```
5. From the phone, request a magic link. Tap the URL in the received email → should open the app directly without the "Open in Safari?" prompt.

### Step 12.5: Commit + PR

```bash
git checkout -b feat/universal-links
git add apps/client/mobile/app.json apps/server/api
git commit -m "feat: Universal Links + App Links for magic-link deep links"
git push -u origin feat/universal-links
gh pr create --title "Plan 6 #12 — Universal Links + App Links"
```

---

## Task 13: Cloudflare 403 reproduction from the Mac Mini

**Files:** none — this is operational verification + documentation.

### Step 13.1: Test scrape from the Mac Mini's residential IP

SSH to the Mac Mini (or use the Mac itself if it's the same machine). Manually exercise the scrape:

```bash
cd ~/flipturn
set -a && source ~/.config/flipturn/secrets.env && set +a

curl -A "FlipTurnBot/0.1 (+https://flipturn.ca/bot; contact@flipturn.ca)" \
  -i https://www.swimming.ca/swimmer/4030816/ | head -5
```

Expected: HTTP 200 (or 301 redirect that resolves to 200). If 403, the residential IP is also blocked.

### Step 13.2: If it works — verify end-to-end in the running system

```bash
# Enqueue a scrape via the API (requires a session)
curl -X POST https://api.flipturn.ca/v1/auth/magic-link/request \
  -H 'content-type: application/json' \
  -d '{"email":"<test inbox>"}'
# Get the token from the email
curl -X POST https://api.flipturn.ca/v1/auth/magic-link/consume \
  -H 'content-type: application/json' \
  -d '{"token":"<token>"}'
# Capture the sessionToken, then onboard:
curl -X POST https://api.flipturn.ca/v1/athletes/onboard \
  -H "authorization: Bearer <sessionToken>" \
  -H 'content-type: application/json' \
  -d '{"sncId":"4030816"}'

# Wait 60s and check
curl https://api.flipturn.ca/v1/athletes \
  -H "authorization: Bearer <sessionToken>" | jq
```

The athlete's `primaryName` should become "Ryan Cochrane" and the `lastScrapedAt` non-null within 60s.

### Step 13.3: If 403 persists

Document the fallback:

```markdown
### Cloudflare 403 fallback

If `www.swimming.ca` returns 403 to the Mac Mini's residential IP, the
options in priority order are:

1. **Wait it out** — Cloudflare's WAF rules can be temporary. Try again
   in 24h.
2. **Slow the rate further** — set `SCRAPE_RATE_LIMIT_MS=15000` and
   `SCRAPE_DAILY_HOST_BUDGET=200`. Smaller, slower footprint may avoid
   the WAF heuristics.
3. **Use a residential proxy** — services like BrightData / IPRoyal
   offer rotating residential IPs. Adds ~$50/month; only worth it if
   the closed beta proves the wedge.
4. **Manual import** — at MVP scale (10–20 parents), the founder can
   manually fetch each athlete's page from a personal browser, save
   the HTML, and run `pnpm db:seed-fixture` (extended to take a path
   argument). Tedious but unblocks the beta.
5. **Reach out to SNC** — the spec's strategic plan eventually moves
   to a licensed data partnership. A 403 from public scraping
   accelerates that conversation.

Add to `infra/README.md` and to the Plan 6 final report.
```

### Step 13.4: Commit + PR

```bash
git checkout -b docs/cloudflare-403-runbook
git add infra/README.md
git commit -m "docs(infra): cloudflare 403 fallback options"
git push -u origin docs/cloudflare-403-runbook
gh pr create --title "Plan 6 #13 — Cloudflare 403 runbook"
```

---

## Task 14: Privacy / Terms / Takedown pages

**Files:**

- Create: `docs/legal/privacy-policy.md`
- Create: `docs/legal/terms-of-service.md`
- Create: `docs/legal/takedown.md`
- Modify: `apps/client/mobile/app/(app)/home.tsx` (settings affordance with links)

### Step 14.1: Draft the privacy policy

Create `docs/legal/privacy-policy.md`. The text should cover:

- What data is collected (email, athlete SNC ID, swim history scraped from public sources, app usage)
- What is NOT collected (no payment info, no precise location, no contacts)
- How data is stored (Postgres on Mac Mini, encrypted at rest by macOS FileVault)
- How data is transmitted (TLS via Cloudflare Tunnel)
- Who it's shared with (no third parties; Resend for email delivery; Sentry for error reporting)
- User rights (PIPEDA): access, correct, delete (DELETE /v1/me + email request)
- Contact: `privacy@flipturn.ca`
- Last updated date
- Children's data note: app is intended for parents of minors; the parent operates the account, not the child

The text should be plain-language, not boilerplate. The brief mentions:

> A one-hour consult with a Toronto SaaS/data lawyer is required before charging users.

For a free closed beta, a clearly-written self-drafted policy is acceptable. Flag in the document that legal review is mandatory before charging.

### Step 14.2: Draft the terms of service

Create `docs/legal/terms-of-service.md`. Cover:

- Eligibility (must be 18+, parent/guardian of the swimmer)
- Acceptable use (no scraping, no API abuse, no impersonation)
- Account termination (we may disable accounts at our discretion; you may delete via DELETE /me)
- No warranty (data is from third-party sources, may have errors)
- Liability cap (closed beta — generally cap at fees paid, which is $0)
- Governing law (Ontario, Canada)
- Changes (we may update terms; continued use = acceptance)

### Step 14.3: Draft the takedown page

Create `docs/legal/takedown.md`. Cover:

- "If you are an athlete, parent, or coach who wants their data removed from
  Flip Turn, email `takedown@flipturn.ca` with the SNC athlete ID(s)."
- "We will remove the data within 7 days and reply to confirm."
- "Note that the source data on `results.swimming.ca` is operated by
  Swimming Canada, not us. Removing data from Flip Turn does not affect
  the public SNC archive — for that, contact SNC directly."

### Step 14.4: Mobile-side: add a Settings/About link

In `apps/client/mobile/app/(app)/home.tsx`, add a tiny "About" link at the bottom near the Sign Out button:

```tsx
import { Linking } from 'react-native';

// Below the Sign Out button:
<Pressable onPress={() => Linking.openURL('https://flipturn.ca/legal/privacy-policy')}>
  <Text style={{ color: colors.textMuted, marginTop: spacing.md, textAlign: 'center' }}>
    Privacy · Terms · Contact
  </Text>
</Pressable>;
```

The text routes the user to the GitHub-published markdown for now (or a static page on `flipturn.ca` once the marketing site exists).

### Step 14.5: Publish the markdown files

Two options:

**A. GitHub Pages.** Add `docs/_config.yml` enabling Pages on the `docs/` directory; the legal markdown becomes available at `https://darrellbechtel.github.io/flipturn/legal/privacy-policy.html`.

**B. A small `flipturn.ca/legal/*` route on the API.** Serve the markdown rendered to HTML via a tiny `/legal/:slug` route in the API. More work but better domain alignment.

For MVP, Option A is faster. Pin a Plan 7 follow-up to migrate to Option B when the marketing site is built.

### Step 14.6: Commit + PR

```bash
git checkout -b docs/legal-pages
git add docs/legal apps/client/mobile/app/\(app\)/home.tsx
git commit -m "docs(legal): privacy, TOS, takedown + mobile About link"
git push -u origin docs/legal-pages
gh pr create --title "Plan 6 #14 — Legal pages + About link"
```

---

## Task 15: Beta-tester recruitment + onboarding

**Files:** none — operational checklist.

### Step 15.1: Compose the recruitment message

Draft the outreach the founder sends to ~30 swim parents (over-recruit; expect 2/3 to actually install):

```
Hi <name>,

I'm building a small app for swim parents called Flip Turn. It pulls your
kid's results from results.swimming.ca and shows their PBs and progression
in one place — no more squinting at PDFs.

I'd love your help testing it for a month before I open it up. It's free
during the beta. Two minutes to install:

  1. Tap this TestFlight link from your iPhone: <link>
     (Android: <link>)
  2. Open Flip Turn, enter your email, tap the link in the email I send.
  3. Enter your kid's SNC athlete ID (find it on their swimming.ca profile).

The app will fetch their swim history within a minute. Tell me what you
think — what's missing, what's confusing, what made you smile.

— Darrell
```

### Step 15.2: Track sign-ups

For the closed beta, a simple spreadsheet tracks:

- Name, email, kid's SNC ID, date invited, install date, last-active date
- Issues reported (free-form notes)

After 4 weeks (per spec §1's success criterion), evaluate: did 10–20 parents install AND open it weekly for 4 weeks?

### Step 15.3: Post-beta retrospective

Schedule a week-out checkpoint:

- What features did parents use most? (Home? Event detail? Both equally?)
- What did they ask for? (Time-standard tracking? Notifications? Multi-athlete?)
- What broke?

Document findings in `docs/beta-retro.md` (post-MVP plan input).

### Step 15.4: Commit (just the recruitment template)

```bash
git checkout -b docs/beta-recruit
git add docs/beta-recruit-template.md   # the message above
git commit -m "docs(beta): recruitment message template + sign-up tracking notes"
git push -u origin docs/beta-recruit
gh pr create --title "Plan 6 #15 — Beta-tester recruitment"
```

---

## Task 16: ADR 0006 + final integration check

**Files:**

- Create: `docs/adr/0006-production-deployment.md`

### Step 16.1: Write ADR 0006

Capture the production-deployment decisions in one place:

```markdown
# ADR 0006 — Production deployment: pm2 on Mac Mini + Cloudflare Tunnel + Resend

**Status:** Accepted
**Date:** 2026-05-05
**Deciders:** Darrell Bechtel
**Builds on:** [ADR 0001](./0001-mvp-hosting.md), [ADR 0004](./0004-auth-design.md)

## Context

Plan 6 takes the locally-functional MVP (Plans 1-5) and produces a
closed-beta-shippable system. The hosting strategy was set in ADR 0001
(Mac Mini + Cloudflare Tunnel) but the operational details were deferred.
This ADR captures them.

## Decisions

### 1. Process supervision: pm2

Three processes run on the Mac Mini supervised by pm2:

- `flipturn-api` — Hono HTTP server on port 3000
- `flipturn-workers` — BullMQ worker process
- `flipturn-tunnel` — cloudflared running the named tunnel

pm2 handles crash-restart, log rotation, and `pm2 startup` for boot
auto-start. Memory limits prevent runaway processes (`max_memory_restart: 512M`).

Alternative: launchd (native macOS) would also work but pm2 is more
familiar across teams and produces nicer logs.

### 2. Public ingress: Cloudflare Tunnel (named)

`api.flipturn.ca` resolves to a Cloudflare Tunnel pointing at
`localhost:3000` on the Mac Mini. Benefits:

- No port forwarding on the home router
- TLS terminated at Cloudflare (free wildcard cert)
- DDoS protection at the edge
- Stable URL even if the Mac Mini's residential IP rotates

Alternative: Tailscale Funnel — works but ties beta users to a Tailscale-
hosted ingress. Cloudflare is more standard.

### 3. Email delivery: Resend on a verified domain

`flipturn.ca` is verified with Resend (SPF + DKIM + DMARC aligned).
Magic-link emails come from `noreply@flipturn.ca`. Free tier (3000/mo)
covers closed beta well.

Alternative: Postmark (more pricey but better delivery rep) — defer until
delivery becomes a problem.

### 4. Universal Links / App Links

The magic-link email body uses `https://flipturn.ca/auth?token=…` rather
than the custom `flipturn://` scheme. iOS Universal Links and Android App
Links route the URL to the installed app; if the app isn't installed, the
URL opens in the browser (graceful fallback).

`apple-app-site-association` and `assetlinks.json` are served by the API
at `/.well-known/`.

### 5. Distribution: TestFlight (iOS) + EAS internal links (Android)

Closed-beta testers install via:

- iOS: TestFlight (requires Apple Developer Program — $99/yr)
- Android: EAS internal-link APK download (no Play Store fee)

Public store submission is post-MVP.

### 6. Observability

- **Sentry** captures unhandled errors in API + workers
- **pino** structured logs flow to `~/.pm2/logs/`
- **Worker heartbeat** in Redis (90s TTL) — staleness should alert; for
  MVP, manual `redis-cli GET workers:heartbeat` check is acceptable

## Alternatives considered

- **Cloud-hosted backend (Fly.io / Railway / AWS):** would simplify scaling
  but costs ~$30-60/mo and the MVP doesn't need it. Mac Mini is free given
  it's already always-on. Migration path is clean (the architecture doesn't
  depend on the host).
- **Push notifications via Expo Push Service:** out of scope for MVP. Plan 7
  feature.

## Consequences

- The Mac Mini is a single point of failure. If it powers off or loses WiFi,
  the closed beta is offline. Acceptable for 10–20 testers; address at scale.
- The `~/.config/flipturn/secrets.env` file is the production config. It must
  be backed up (encrypted) separately from the repo. The repo never holds
  production secrets.
- Cloudflare account dependency: if the user's Cloudflare account is
  suspended, ingress breaks. Mitigation: keep the account healthy + low-risk
  (no abusive content; standard usage).
- Resend free-tier rate limit (3000/mo) is fine for closed beta but a future
  onboarding spike would hit it. Plan 7 monitors and upgrades or migrates.

## Risks

- **Cloudflare 403 on `www.swimming.ca`** — checked from the Mac Mini's
  residential IP in Task 13. Fallback runbook documented in `infra/README.md`.
- **Apple Developer enrollment** is one-time and may take 1-2 days for
  identity verification. Schedule before the beta launch date.
- **DNS propagation** for SPF/DKIM/DMARC can take up to 48 hours. Verify
  via `dig` or `mxtoolbox` before launching.
```

### Step 16.2: Final integration: walk the full beta flow

Manual end-to-end smoke from a real device:

1. Founder opens TestFlight link on iPhone, installs the dev build
2. Email entry → enter founder's real email
3. Email arrives in inbox (not spam) within ~30s
4. Tap email link → app opens (Universal Links work)
5. Auto-signs in, lands on home (empty)
6. Tap "Add swimmer" → enter founder's kid's SNC ID → submit
7. Wait ~60s. Home populates with kid's PBs.
8. Tap a PB → progression chart + swim history visible
9. Sign out → returns to email entry

If all 9 steps succeed, the beta is ready. If any step fails, fix and re-run.

### Step 16.3: Run all gates one last time

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm lint
pnpm format:check
```

All exit 0. Test count: 143 (or whatever the prior plans + Plan 6's added rate-limit tests + Sentry tests bring it to).

### Step 16.4: Commit + PR

```bash
git checkout -b docs/adr-0006
git add docs/adr/0006-production-deployment.md
git commit -m "docs(adr): 0006 production deployment"
git push -u origin docs/adr-0006
gh pr create --title "Plan 6 #16 — ADR 0006 + final integration"
```

---

## Acceptance criteria for Plan 6

This plan — and the MVP — is complete when:

- [ ] Expo SDK 54 upgrade landed; the App Store version of Expo Go works
- [ ] Onboarding has a Cancel button (no longer stuck)
- [ ] Brand-derived placeholder icons in place (designer mark deferred)
- [ ] Sentry captures unhandled errors in API + workers (verified by a temp test crash)
- [ ] Magic-link endpoint is rate-limited (5/hr/IP, with tests)
- [ ] API has graceful shutdown (10s in-flight wait + idle-connection close)
- [ ] `/v1/health` actually pings Redis (1s timeout)
- [ ] pm2 ecosystem.config.cjs deploys all 3 processes from the Mac Mini
- [ ] Cloudflare Tunnel routes `api.flipturn.ca` → `localhost:3000`
- [ ] `flipturn.ca` is verified with Resend; SPF/DKIM/DMARC aligned
- [ ] EAS build profiles produce installable iOS + Android dev builds
- [ ] Universal Links + App Links route the magic-link URL to the app
- [ ] Cloudflare 403 status on `www.swimming.ca` from the Mac Mini is documented (works or fallback chosen)
- [ ] Privacy / TOS / takedown pages exist and are reachable from the app
- [ ] Recruitment template + tracking spreadsheet exist
- [ ] ADR 0006 captures the production-deployment decisions
- [ ] End-to-end on-device smoke test passes (9-step walkthrough in Task 16.2)
- [ ] All gates green; 143+ tests pass

When all of the above are checked, the closed beta is ready to launch. The
final manual step is **send the recruitment message to 30 swim parents** —
that's the user's outreach, not the agent's.

## Plan 6 stretch / Plan 7 candidates

These weren't critical for closed-beta launch but are worth tracking:

- Cloudflare 429-aware retry-with-backoff on the worker fetch (Plan 3 review I-3)
- Daily-budget refund on 429 (Plan 3 review I-3)
- `extractSwimRows` header-driven column mapping (Plan 3 review I-4)
- Real designer mark to replace the wordmark icons
- Push notifications (PB alert)
- Time-standard tracking
- Multi-meet split analysis
- Family dashboard view (multi-athlete side-by-side)
- App Store / Play Store public submission
- Stripe paywall (per spec §1's monetization criterion: 50 paying parents at CA$8/mo within 6 months)
- Web admin tool for the founder to inspect scrape failures and re-enqueue
