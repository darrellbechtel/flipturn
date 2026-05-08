import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, type TestApp } from './helpers/testApp.js';

let h: TestApp;

describe('test harness smoke', () => {
  beforeAll(async () => {
    h = await createTestApp();
  });

  afterAll(async () => {
    await h.teardown();
  });

  it('boots the app and responds to /v1/health', async () => {
    const res = await h.app.request('/v1/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { db: string };
    expect(body.db).toBe('ok');
  });

  it('serves the apex /auth landing page', async () => {
    // Same HTML as the older /v1/auth/magic-link/consume GET; this is the
    // canonical user-facing path once `MOBILE_DEEP_LINK_BASE` flips to
    // `https://flipturn.ca/auth`.
    const res = await h.app.request('/auth?token=irrelevant-for-render');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toMatch(/<!doctype html>/i);
    expect(html).toContain('/v1/auth/magic-link/consume');
  });

  // Universal Links (iOS) — Apple downloads this from the apex on first
  // link click. JSON shape per
  // https://developer.apple.com/documentation/xcode/supporting-associated-domains
  it('serves apple-app-site-association as JSON', async () => {
    const res = await h.app.request('/.well-known/apple-app-site-association');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toMatch(/application\/json/);
    const body = (await res.json()) as { applinks: { details: unknown[] } };
    expect(body).toHaveProperty('applinks.details');
    expect(Array.isArray(body.applinks.details)).toBe(true);
    // In tests `IOS_TEAM_ID` is unset → empty details (valid empty manifest).
    expect(body.applinks.details).toHaveLength(0);
  });

  // App Links (Android) — Android verifies the app's signature against
  // these fingerprints before treating the URL as a verified app link.
  it('serves assetlinks.json as a JSON array', async () => {
    const res = await h.app.request('/.well-known/assetlinks.json');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toMatch(/application\/json/);
    const body = (await res.json()) as unknown[];
    expect(Array.isArray(body)).toBe(true);
    // Empty array when ANDROID_CERT_SHA256 is unset.
    expect(body).toHaveLength(0);
  });
});
