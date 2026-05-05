import type { Context, Next } from 'hono';
import type { PrismaClient, Session, User } from '@flipturn/db';
import { ApiError } from './error.js';
import { hashToken, parseBearerHeader } from '../auth.js';

export interface SessionContext {
  readonly user: User;
  readonly session: Session;
}

declare module 'hono' {
  interface ContextVariableMap {
    auth: SessionContext;
  }
}

export function sessionMiddleware(prisma: PrismaClient) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const header = c.req.header('authorization');
    const token = parseBearerHeader(header);
    if (!token) {
      throw new ApiError(401, 'Missing or malformed Authorization header', 'unauthenticated');
    }
    const tokenHash = hashToken(token);
    const session = await prisma.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!session || session.revokedAt) {
      throw new ApiError(401, 'Invalid session', 'unauthenticated');
    }
    void prisma.session.update({
      where: { id: session.id },
      data: { lastUsedAt: new Date() },
    });
    c.set('auth', { user: session.user, session });
    await next();
  };
}
