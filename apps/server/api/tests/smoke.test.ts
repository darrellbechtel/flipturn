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
});
