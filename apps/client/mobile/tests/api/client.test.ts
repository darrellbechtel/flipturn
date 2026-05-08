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

// `body` lets a test simulate an empty 2xx response (e.g. 202 / 204 with
// `content-length: 0`). When omitted it defaults to an empty JSON object.
function mockFetch(
  response: Partial<Response> & {
    json?: () => Promise<unknown>;
    body?: string | null;
  },
) {
  const explicitBody = 'body' in response;
  const bodyText = explicitBody
    ? (response.body ?? '')
    : JSON.stringify(response.json ? '__placeholder__' : {});
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: response.status ? response.status < 400 : true,
    status: response.status ?? 200,
    statusText: response.statusText ?? 'OK',
    headers: new Headers(response.headers ?? { 'content-type': 'application/json' }),
    json: response.json ?? (async () => ({})),
    text: async () => {
      if (explicitBody) return bodyText;
      const j = response.json ? await response.json() : {};
      return JSON.stringify(j);
    },
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
    mockFetch({ status: 204, body: '' });
    const result = await apiClient<void>('/v1/me', { method: 'DELETE', sessionToken: 'tok' });
    expect(result).toBeUndefined();
  });

  // Regression for "JSON parse error: Unexpected end of input" surfacing
  // on the magic-link sign-in flow: the API returns 202 with
  // `content-length: 0`, but the client used to call `response.json()`
  // for any non-204 success.
  it('returns void for 2xx responses with empty bodies (e.g. 202 from /magic-link/request)', async () => {
    mockFetch({ status: 202, body: '' });
    const result = await apiClient<void>('/v1/auth/magic-link/request', {
      method: 'POST',
      body: { email: 'a@b.com' },
    });
    expect(result).toBeUndefined();
  });
});
