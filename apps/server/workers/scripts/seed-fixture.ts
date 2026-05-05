/**
 * Demo-mode seeder.
 *
 * Reads the captured Ryan Cochrane fixture, runs it through the real parser
 * + reconciler + PB recompute, then ensures a demo user exists and is linked
 * to the resulting athlete. Prints a one-shot magic-link URL for instant
 * sign-in (skips the email round-trip entirely).
 *
 * Idempotent: safe to re-run. Each run mints a fresh magic-link token so
 * old tokens don't accumulate (the workers scheduler also cleans up
 * expired tokens daily).
 *
 * Usage from repo root:
 *   pnpm db:seed-fixture
 */

import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { getPrisma, disconnectPrisma } from '@flipturn/db';
import { parseAthletePage } from '../src/parser/athletePage.js';
import { reconcile } from '../src/reconcile.js';
import { recomputePersonalBests } from '../src/personalBest.js';

const DEMO_EMAIL = 'demo@flipturn.local';
const COCHRANE_SNC_ID = '4030816';
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_HTML = join(__dirname, '..', 'fixtures', 'snc-athlete-sample.html');

async function main(): Promise<void> {
  const html = await readFile(FIXTURE_HTML, 'utf8');
  const prisma = getPrisma();

  console.log(`📥 Parsing ${FIXTURE_HTML}`);
  const snapshot = parseAthletePage(html, { sncId: COCHRANE_SNC_ID });
  console.log(`   ${snapshot.swims.length} swims parsed for ${snapshot.primaryName}`);

  console.log('💾 Reconciling to DB');
  const { athleteId, swimsTouched } = await reconcile(prisma, snapshot);
  console.log(`   athleteId=${athleteId} swimsTouched=${swimsTouched}`);

  console.log('🏆 Recomputing personal bests');
  const pbResult = await recomputePersonalBests(prisma, athleteId);
  console.log(`   created/updated=${pbResult.created} deleted=${pbResult.deleted}`);

  console.log('👤 Ensuring demo user');
  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: { email: DEMO_EMAIL },
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
  console.log('✅ Demo mode ready.');
  console.log('');
  console.log(`   Demo email: ${DEMO_EMAIL}`);
  console.log(`   Athlete:    ${snapshot.primaryName} (sncId ${COCHRANE_SNC_ID})`);
  console.log(`   Swims:      ${swimsTouched}`);
  console.log(`   PBs:        ${pbResult.created}`);
  const lanIp = firstLanIPv4();
  const expoSimUrl = `exp://localhost:8081/--/auth?token=${tokenPlain}`;
  const expoLanUrl = lanIp
    ? `exp://${lanIp}:8081/--/auth?token=${tokenPlain}`
    : null;

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
