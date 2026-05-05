import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// Hoist the mock functions so they're available before vi.mock factories run.
const sentryMock = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
}));

// vi.mock is hoisted to the top of the file; ensure the @sentry/node specifier
// (used by ../src/sentry.ts) returns our spies. This applies only to this
// test file — other tests are unaffected.
vi.mock('@sentry/node', () => sentryMock);

// Import AFTER vi.mock so errorHandler picks up the mocked Sentry.
const { errorHandler, ApiError } = await import('../../src/middleware/error.js');

function appWithRoute(handler: () => never): Hono {
  const app = new Hono();
  app.onError(errorHandler);
  app.get('/boom', handler);
  return app;
}

describe('errorHandler Sentry capture', () => {
  beforeEach(() => {
    sentryMock.captureException.mockClear();
  });

  it('captures generic unhandled errors (500 / internal_error)', async () => {
    const app = appWithRoute(() => {
      throw new Error('boom');
    });
    const res = await app.request('/boom');
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('internal_error');
    expect(sentryMock.captureException).toHaveBeenCalledTimes(1);
    expect(sentryMock.captureException.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });

  it('captures 5xx ApiError', async () => {
    const app = appWithRoute(() => {
      throw new ApiError(503, 'upstream down', 'upstream_error');
    });
    const res = await app.request('/boom');
    expect(res.status).toBe(503);
    expect(sentryMock.captureException).toHaveBeenCalledTimes(1);
  });

  it('does NOT capture 4xx ApiError', async () => {
    const app = appWithRoute(() => {
      throw new ApiError(404, 'not found', 'not_found');
    });
    const res = await app.request('/boom');
    expect(res.status).toBe(404);
    expect(sentryMock.captureException).not.toHaveBeenCalled();
  });

  it('does NOT capture ZodError (validation, not a bug)', async () => {
    const { z } = await import('zod');
    const schema = z.object({ x: z.string() });
    const app = appWithRoute(() => {
      schema.parse({ x: 123 });
      throw new Error('unreachable');
    });
    const res = await app.request('/boom');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('validation_error');
    expect(sentryMock.captureException).not.toHaveBeenCalled();
  });
});
