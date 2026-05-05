import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createTestApp, type TestApp } from './helpers/testApp.js';
import { parseAthletePage } from '@flipturn/workers/parser/athletePage';
import { reconcile } from '@flipturn/workers/reconcile';
import { recomputePersonalBests } from '@flipturn/workers/personalBest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '..', '..', 'workers', 'fixtures', 'snc-athlete-sample.html');

let h: TestApp;
let html: string;

describe('end-to-end happy path', () => {
  beforeAll(async () => {
    h = await createTestApp();
    html = await readFile(FIXTURE, 'utf8');
  });
  afterAll(async () => {
    await h.teardown();
  });

  it('parent signs in, onboards, and reads athlete data', async () => {
    // 1. request magic link
    const req = await h.app.request('/v1/auth/magic-link/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'darrell@example.com' }),
    });
    expect(req.status).toBe(202);
    const sent = h.email.latestTo('darrell@example.com');
    const m = /token=([^&"\s)]+)/.exec(sent!.htmlBody);
    const token = decodeURIComponent(m![1]!);

    // 2. consume
    const consume = await h.app.request('/v1/auth/magic-link/consume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const { sessionToken } = (await consume.json()) as { sessionToken: string };
    const auth = `Bearer ${sessionToken}`;

    // 3. onboard
    const onboard = await h.app.request('/v1/athletes/onboard', {
      method: 'POST',
      headers: { authorization: auth, 'content-type': 'application/json' },
      body: JSON.stringify({ sncId: '4030816' }),
    });
    expect(onboard.status).toBe(200);
    const { athlete } = (await onboard.json()) as { athlete: { id: string; sncId: string } };
    expect(athlete.sncId).toBe('4030816');
    expect(h.enqueued).toHaveLength(1);

    // 4. directly run the worker pipeline against the fixture
    const snap = parseAthletePage(html, { sncId: '4030816' });
    const reconciled = await reconcile(h.prisma, snap);
    await recomputePersonalBests(h.prisma, reconciled.athleteId);

    // The onboard endpoint created an Athlete row keyed by sncId='4030816'.
    // reconcile's upsert on the same sncId updates that same row, so the
    // athlete id from /onboard matches the id returned by reconcile.
    expect(reconciled.athleteId).toBe(athlete.id);

    // 5. swims
    const swimsRes = await h.app.request(`/v1/athletes/${reconciled.athleteId}/swims?limit=200`, {
      headers: { authorization: auth },
    });
    expect(swimsRes.status).toBe(200);
    const { swims } = (await swimsRes.json()) as { swims: unknown[] };
    expect(swims.length).toBeGreaterThan(0);

    // 6. PBs
    const pbsRes = await h.app.request(`/v1/athletes/${reconciled.athleteId}/personal-bests`, {
      headers: { authorization: auth },
    });
    const { personalBests } = (await pbsRes.json()) as { personalBests: unknown[] };
    expect(personalBests.length).toBeGreaterThan(0);

    // 7. progression on a known Cochrane event
    const progRes = await h.app.request(
      `/v1/athletes/${reconciled.athleteId}/progression?eventKey=400_FR_LCM`,
      { headers: { authorization: auth } },
    );
    expect(progRes.status).toBe(200);
    const { points } = (await progRes.json()) as { points: unknown[] };
    expect(points.length).toBeGreaterThan(0);
  });
});
