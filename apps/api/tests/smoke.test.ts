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
});
