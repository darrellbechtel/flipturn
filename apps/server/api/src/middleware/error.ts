import type { Context, Next } from 'hono';
import { ZodError } from 'zod';
import { getLogger } from '../logger.js';
import { Sentry } from '../sentry.js';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Hono `onError` handler — Hono's compose intercepts thrown errors before
 *  any try/catch middleware can see them, so error handling must be wired
 *  via `app.onError()` (and on each sub-app mounted via `app.route()`). */
export function errorHandler(err: Error, c: Context): Response {
  const log = getLogger();
  if (err instanceof ApiError) {
    log.warn({ err, status: err.status, code: err.code }, 'api error');
    // 5xx ApiErrors are unexpected server failures dressed in our error type;
    // capture them. 4xx are client-induced (bad input, auth) and not bugs.
    if (err.status >= 500) {
      Sentry.captureException(err);
    }
    return c.json(
      { error: { code: err.code ?? 'api_error', message: err.message } },
      err.status as 400 | 401 | 403 | 404 | 409,
    );
  }
  if (err instanceof ZodError) {
    log.warn({ err: err.flatten() }, 'validation error');
    return c.json({ error: { code: 'validation_error', issues: err.flatten() } }, 400);
  }
  log.error({ err }, 'unhandled error');
  Sentry.captureException(err);
  return c.json({ error: { code: 'internal_error', message: 'Internal Server Error' } }, 500);
}

/** Back-compat middleware wrapper. Prefer wiring `errorHandler` via
 *  `app.onError(errorHandler)` — Hono's compose intercepts errors before
 *  this middleware's catch can see them. */
export async function errorMiddleware(c: Context, next: Next): Promise<Response | void> {
  try {
    await next();
  } catch (err) {
    if (err instanceof Error) {
      return errorHandler(err, c);
    }
    throw err;
  }
}
