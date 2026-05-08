/**
 * Fixture seeder — demo + manual-import modes.
 *
 * Two ways to run this:
 *
 * 1. **Demo mode** (no args). Uses the bundled Ryan Cochrane fixture and the
 *    `demo@flipturn.local` user. Smoke-test path; safe to re-run.
 *
 *      pnpm db:seed-fixture
 *
 * 2. **Manual-import mode** (all three args required). Imports an HTML page
 *    captured manually for a real beta tester whose athlete cannot be scraped
 *    automatically because `www.swimming.ca` returns 403 to non-allowlisted
 *    bots (see ADR 0006 and `infra/README.md` 403 fallback).
 *
 *      pnpm db:seed-fixture \
 *        --html /path/to/saved/athlete-page.html \
 *        --sncId 1234567 \
 *        --email parent@example.com
 *
 *    The script links the athlete to the parent's user record (creating the
 *    user if missing) and mints a magic-link so the parent can sign in.
 *
 * Either mode runs the captured HTML through the real parser → reconciler →
 * PB recompute and prints sign-in deep links at the end.
 */

import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createHash, randomBytes } from 'node:crypto';
import { getPrisma, disconnectPrisma } from '@flipturn/db';
import { parseAthletePage } from '../src/parser/athletePage.js';
import { reconcile } from '../src/reconcile.js';
import { recomputePersonalBests } from '../src/personalBest.js';

const DEMO_EMAIL = 'demo@flipturn.local';
const COCHRANE_SNC_ID = '4030816';
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEMO_FIXTURE_HTML = join(__dirname, '..', 'fixtures', 'snc-athlete-sample.html');

interface RunConfig {
  readonly htmlPath: string;
  readonly sncId: string;
  readonly email: string;
  readonly mode: 'demo' | 'manual';
}

function parseRunConfig(): RunConfig {
  const { values } = parseArgs({
    options: {
      html: { type: 'string' },
      sncId: { type: 'string' },
      email: { type: 'string' },
    },
    allowPositionals: false,
  });

  const provided = [values.html, values.sncId, values.email].filter((v) => v !== undefined);
  if (provided.length === 0) {
    return {
      htmlPath: DEMO_FIXTURE_HTML,
      sncId: COCHRANE_SNC_ID,
      email: DEMO_EMAIL,
      mode: 'demo',
    };
  }
  if (provided.length !== 3) {
    throw new Error(
      'Manual-import mode requires --html, --sncId, AND --email (all three). ' +
        'Pass none for demo mode (Cochrane fixture + demo@flipturn.local).',
    );
  }
  const htmlPath = isAbsolute(values.html!) ? values.html! : resolve(process.cwd(), values.html!);
  return { htmlPath, sncId: values.sncId!, email: values.email!, mode: 'manual' };
}

async function main(): Promise<void> {
  const cfg = parseRunConfig();
  console.log(`▶️  Mode: ${cfg.mode === 'demo' ? 'DEMO (Cochrane fixture)' : 'MANUAL IMPORT'}`);

  const html = await readFile(cfg.htmlPath, 'utf8');
  const prisma = getPrisma();

  console.log(`📥 Parsing ${cfg.htmlPath}`);
  const snapshot = parseAthletePage(html, { sncId: cfg.sncId });
  console.log(`   ${snapshot.swims.length} swims parsed for ${snapshot.primaryName}`);

  console.log('💾 Reconciling to DB');
  const { athleteId, swimsTouched } = await reconcile(prisma, snapshot);
  console.log(`   athleteId=${athleteId} swimsTouched=${swimsTouched}`);

  console.log('🏆 Recomputing personal bests');
  const pbResult = await recomputePersonalBests(prisma, athleteId);
  console.log(`   created/updated=${pbResult.created} deleted=${pbResult.deleted}`);

  console.log(`👤 Ensuring user ${cfg.email}`);
  const user = await prisma.user.upsert({
    where: { email: cfg.email },
    update: {},
    create: { email: cfg.email },
  });

  console.log(`🔗 Linking ${user.email} to ${snapshot.primaryName}`);
  await prisma.userAthlete.upsert({
    where: { userId_athleteId: { userId: user.id, athleteId } },
    update: {},
    create: { userId: user.id, athleteId, relationship: 'PARENT' },
  });

  // Mint a fresh magic-link token for instant sign-in.
  const tokenPlain = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(tokenPlain).digest('hex');
  await prisma.magicLinkToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS),
    },
  });

  const deepLink = `flipturn://auth?token=${tokenPlain}`;

  console.log('');
  console.log(`✅ ${cfg.mode === 'demo' ? 'Demo' : 'Manual import'} ready.`);
  console.log('');
  console.log(`   User email: ${cfg.email}`);
  console.log(`   Athlete:    ${snapshot.primaryName} (sncId ${cfg.sncId})`);
  console.log(`   Swims:      ${swimsTouched}`);
  console.log(`   PBs:        ${pbResult.created}`);
  const lanIp = firstLanIPv4();
  const expoSimUrl = `exp://localhost:8081/--/auth?token=${tokenPlain}`;
  const expoLanUrl = lanIp ? `exp://${lanIp}:8081/--/auth?token=${tokenPlain}` : null;

  console.log('');
  console.log('🔗 One-shot sign-in deep link (15 min, single-use):');
  console.log('');
  console.log('   ── If you are running Expo Go (default `pnpm mobile:dev`) ──');
  console.log('');
  console.log('   iOS Simulator on this Mac:');
  console.log(`     xcrun simctl openurl booted "${expoSimUrl}"`);
  if (expoLanUrl) {
    console.log('');
    console.log('   Physical iPhone or Android device with Expo Go (same WiFi):');
    console.log(`     ${expoLanUrl}`);
    console.log('     (paste into Notes/Messages on the device, tap to open in Expo Go)');
  }
  console.log('');
  console.log('   ── If you are running a custom dev build or release build ──');
  console.log('');
  console.log(`   ${deepLink}`);
  console.log('');
  console.log(`     iOS Simulator:  xcrun simctl openurl booted "${deepLink}"`);
  console.log(
    `     Android:        adb shell am start -W -a android.intent.action.VIEW -d "${deepLink}"`,
  );
  console.log('');

  await disconnectPrisma();
}

/** Return the first non-internal IPv4 address, or null if none. */
function firstLanIPv4(): string | null {
  const ifaces = networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const info of list ?? []) {
      if (info.family === 'IPv4' && !info.internal) {
        return info.address;
      }
    }
  }
  return null;
}

main().catch((err) => {
  console.error('❌ seed-fixture failed:', err);
  process.exit(1);
});
