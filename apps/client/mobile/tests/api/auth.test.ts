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
