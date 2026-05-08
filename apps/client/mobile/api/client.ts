import { apiBaseUrl } from '../lib/env.js';

export interface ApiClientOptions {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  readonly body?: unknown;
  readonly sessionToken?: string | undefined;
  readonly query?: Record<string, string | number | undefined>;
  readonly signal?: AbortSignal | undefined;
}

export interface ApiErrorPayload {
  readonly code?: string;
  readonly message?: string;
  readonly issues?: unknown;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly payload: ApiErrorPayload,
    public readonly path: string,
  ) {
    super(payload.message ?? `API error ${status} on ${path}`);
    this.name = 'ApiError';
  }
}

export async function apiClient<T = unknown>(
  path: string,
  options: ApiClientOptions = {},
): Promise<T> {
  const base = apiBaseUrl();
  const queryString = options.query
    ? '?' +
      Object.entries(options.query)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : '';
  const url = `${base}${path}${queryString}`;

  const headers: Record<string, string> = {
    accept: 'application/json',
  };
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (options.sessionToken) {
    headers['authorization'] = `Bearer ${options.sessionToken}`;
  }

  const init: RequestInit = {
    method: options.method ?? 'GET',
    headers,
  };
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }
  if (options.signal) {
    init.signal = options.signal;
  }

  const response = await fetch(url, init);

  if (!response.ok) {
    let payload: ApiErrorPayload = {};
    try {
      const json = (await response.json()) as { error?: ApiErrorPayload };
      payload = json.error ?? {};
    } catch {
      // body wasn't JSON
    }
    throw new ApiError(response.status, payload, path);
  }

  // Some endpoints return 2xx with no body — `/magic-link/request` is 202
  // with `content-length: 0`, `DELETE /me` is 204, etc. Calling
  // `response.json()` on an empty body throws "Unexpected end of input".
  // Read as text first; only parse if there's content.
  const text = await response.text();
  if (text.length === 0) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}
