import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestApp, type TestApp } from './helpers/testApp.js';
import { hashToken } from '../src/auth.js';

let h: TestApp;

describe('POST /v1/auth/magic-link/request', () => {
  beforeAll(async () => {
    h = await createTestApp();
  });
  afterAll(async () => {
    await h.teardown();
  });
  beforeEach(async () => {
    await h.prisma.magicLinkToken.deleteMany();
    await h.prisma.session.deleteMany();
    await h.prisma.user.deleteMany();
    h.email.clear();
  });

  it('creates a user, a token row, and sends an email', async () => {
    const res = await h.app.request('/v1/auth/magic-link/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'darrell@example.com' }),
    });
    expect(res.status).toBe(202);

    const user = await h.prisma.user.findUnique({ where: { email: 'darrell@example.com' } });
    expect(user).not.toBeNull();

    const tokens = await h.prisma.magicLinkToken.findMany({ where: { userId: user!.id } });
    expect(tokens).toHaveLength(1);

    const sent = h.email.latestTo('darrell@example.com');
    expect(sent).toBeDefined();
    expect(sent?.subject).toContain('Flip Turn');
    expect(sent?.htmlBody).toContain('flipturn://auth?token=');
  });

  it('lowercases the email', async () => {
    const res = await h.app.request('/v1/auth/magic-link/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: '  Darrell@Example.COM  ' }),
    });
    expect(res.status).toBe(202);
    const user = await h.prisma.user.findUnique({ where: { email: 'darrell@example.com' } });
    expect(user).not.toBeNull();
  });

  it('rejects malformed email', async () => {
    const res = await h.app.request('/v1/auth/magic-link/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    expect(res.status).toBe(400);
  });

  it('reuses the User row on subsequent requests', async () => {
    await h.app.request('/v1/auth/magic-link/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com' }),
    });
    await h.app.request('/v1/auth/magic-link/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com' }),
    });
    const users = await h.prisma.user.findMany();
    expect(users).toHaveLength(1);
    const tokens = await h.prisma.magicLinkToken.findMany();
    expect(tokens).toHaveLength(2);
  });
});

describe('POST /v1/auth/magic-link/consume', () => {
  beforeAll(async () => {
    h = await createTestApp();
  });
  afterAll(async () => {
    await h.teardown();
  });
  beforeEach(async () => {
    await h.prisma.magicLinkToken.deleteMany();
    await h.prisma.session.deleteMany();
    await h.prisma.user.deleteMany();
    h.email.clear();
  });

  async function requestAndExtractToken(email: string): Promise<string> {
    await h.app.request('/v1/auth/magic-link/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const sent = h.email.latestTo(email);
    if (!sent) throw new Error('no email sent');
    const m = /token=([^&"\s)]+)/.exec(sent.htmlBody);
    if (!m?.[1]) throw new Error('no token in email');
    return decodeURIComponent(m[1]);
  }

  it('issues a session token and marks the magic-link consumed', async () => {
    const token = await requestAndExtractToken('a@example.com');
    const res = await h.app.request('/v1/auth/magic-link/consume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessionToken: string };
    expect(body.sessionToken).toMatch(/^[0-9a-f]{64}$/);

    const tokenRow = await h.prisma.magicLinkToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    expect(tokenRow?.consumedAt).not.toBeNull();
  });

  it('rejects an unknown token', async () => {
    const res = await h.app.request('/v1/auth/magic-link/consume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'no-such-token' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a token that was already consumed', async () => {
    const token = await requestAndExtractToken('a@example.com');
    const first = await h.app.request('/v1/auth/magic-link/consume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    expect(first.status).toBe(200);
    const second = await h.app.request('/v1/auth/magic-link/consume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    expect(second.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const token = await requestAndExtractToken('a@example.com');
    await h.prisma.magicLinkToken.updateMany({
      where: { tokenHash: hashToken(token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await h.app.request('/v1/auth/magic-link/consume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    expect(res.status).toBe(401);
  });
});

describe('GET /v1/auth/magic-link/consume (browser fallback page)', () => {
  beforeAll(async () => {
    h = await createTestApp();
  });
  afterAll(async () => {
    await h.teardown();
  });

  it('serves an HTML page that does not auto-consume the token', async () => {
    // First, mint a real magic-link token so we can prove the GET didn't burn it.
    await h.app.request('/v1/auth/magic-link/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'browser@example.com' }),
    });
    const sent = h.email.latestTo('browser@example.com');
    // textBody contains a "<base>?token=<hex>" URL; pluck the hex regardless
    // of scheme (test envs use flipturn://, prod uses https://).
    const token = sent!.textBody.match(/[?&]token=([a-f0-9]+)/)![1];

    const getRes = await h.app.request(`/v1/auth/magic-link/consume?token=${token}`);
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('content-type') ?? '').toMatch(/text\/html/);
    const html = await getRes.text();
    // Sanity: page is HTML and POSTs to the consume endpoint
    expect(html).toMatch(/<!doctype html>/i);
    expect(html).toContain('/v1/auth/magic-link/consume');

    // Critically: the GET MUST NOT have consumed the token. POSTing it now
    // should still succeed.
    const postRes = await h.app.request('/v1/auth/magic-link/consume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    expect(postRes.status).toBe(200);
    const body = (await postRes.json()) as { sessionToken: string };
    expect(body.sessionToken).toMatch(/^[a-f0-9]+$/);
  });
});

describe('GET /v1/auth/me', () => {
  beforeAll(async () => {
    h = await createTestApp();
  });
  afterAll(async () => {
    await h.teardown();
  });
  beforeEach(async () => {
    await h.prisma.session.deleteMany();
    await h.prisma.user.deleteMany();
    h.email.clear();
  });

  async function signIn(): Promise<string> {
    const email = 'me@example.com';
    await h.app.request('/v1/auth/magic-link/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const sent = h.email.latestTo(email);
    if (!sent) throw new Error('no email');
    const m = /token=([^&"\s)]+)/.exec(sent.htmlBody);
    const token = decodeURIComponent(m![1]!);
    const res = await h.app.request('/v1/auth/magic-link/consume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    return ((await res.json()) as { sessionToken: string }).sessionToken;
  }

  it('returns the authenticated user', async () => {
    const sessionToken = await signIn();
    const res = await h.app.request('/v1/auth/me', {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { email: string }; athletes: unknown[] };
    expect(body.user.email).toBe('me@example.com');
    expect(body.athletes).toEqual([]);
  });

  it('returns 401 without a bearer token', async () => {
    const res = await h.app.request('/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 with an invalid bearer token', async () => {
    const res = await h.app.request('/v1/auth/me', {
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    expect(res.status).toBe(401);
  });
});
