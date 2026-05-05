import type { Context, Next } from 'hono';
import { ZodError } from 'zod';
import { getLogger } from '../logger.js';

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

export async function errorMiddleware(c: Context, next: Next): Promise<Response | void> {
  try {
    await next();
  } catch (err) {
    const log = getLogger();
    if (err instanceof ApiError) {
      log.warn({ err, status: err.status, code: err.code }, 'api error');
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
    return c.json({ error: { code: 'internal_error', message: 'Internal Server Error' } }, 500);
  }
}
