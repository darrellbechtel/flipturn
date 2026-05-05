import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { MagicLinkRequestSchema, MagicLinkConsumeSchema } from '@flipturn/shared';
import type { AppDeps } from '../app.js';
import { ApiError, errorHandler } from '../middleware/error.js';
import {
  buildMagicLinkUrl,
  generateMagicLinkToken,
  generateSessionToken,
  hashToken,
  MAGIC_LINK_TTL_MS,
} from '../auth.js';
import { sessionMiddleware } from '../middleware/session.js';

export function authRoutes(deps: AppDeps): Hono {
  const r = new Hono();
  r.onError(errorHandler);

  r.post('/magic-link/request', zValidator('json', MagicLinkRequestSchema), async (c) => {
    const { email } = c.req.valid('json');
    const user = await deps.prisma.user.upsert({
      where: { email },
      update: {},
      create: { email },
    });
    const tokenPlain = generateMagicLinkToken();
    await deps.prisma.magicLinkToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(tokenPlain),
        expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS),
      },
    });
    const link = buildMagicLinkUrl(deps.mobileDeepLinkBase, tokenPlain);
    await deps.email.send({
      to: email,
      subject: 'Sign in to Flip Turn',
      htmlBody: renderHtmlEmail(link),
      textBody: renderTextEmail(link),
    });
    return c.body(null, 202);
  });

  r.post('/magic-link/consume', zValidator('json', MagicLinkConsumeSchema), async (c) => {
    const { token } = c.req.valid('json');
    const tokenHash = hashToken(token);
    const row = await deps.prisma.magicLinkToken.findUnique({ where: { tokenHash } });
    if (!row) {
      throw new ApiError(401, 'Invalid token', 'invalid_token');
    }
    if (row.consumedAt) {
      throw new ApiError(401, 'Token already used', 'invalid_token');
    }
    if (row.expiresAt.getTime() < Date.now()) {
      throw new ApiError(401, 'Token expired', 'invalid_token');
    }
    const sessionTokenPlain = generateSessionToken();
    await deps.prisma.$transaction([
      deps.prisma.magicLinkToken.update({
        where: { id: row.id },
        data: { consumedAt: new Date() },
      }),
      deps.prisma.session.create({
        data: { userId: row.userId, tokenHash: hashToken(sessionTokenPlain) },
      }),
    ]);
    return c.json({ sessionToken: sessionTokenPlain });
  });

  r.get('/me', sessionMiddleware(deps.prisma), async (c) => {
    const { user } = c.get('auth');
    const userAthletes = await deps.prisma.userAthlete.findMany({
      where: { userId: user.id },
      include: { athlete: true },
      orderBy: { addedAt: 'asc' },
    });
    return c.json({
      user: { id: user.id, email: user.email, createdAt: user.createdAt.toISOString() },
      athletes: userAthletes.map((ua) => ({
        id: ua.athlete.id,
        sncId: ua.athlete.sncId,
        primaryName: ua.athlete.primaryName,
        gender: ua.athlete.gender,
        homeClub: ua.athlete.homeClub,
        relationship: ua.relationship,
      })),
    });
  });

  return r;
}

function renderHtmlEmail(link: string): string {
  return `<!doctype html>
<html><body style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;padding:24px">
  <h2>Sign in to Flip Turn</h2>
  <p>Tap the link below to sign in. The link expires in 15 minutes.</p>
  <p><a href="${link}" style="display:inline-block;padding:12px 16px;background:#1F3D5C;color:#fff;text-decoration:none;border-radius:6px">Open Flip Turn</a></p>
  <p style="color:#888;font-size:12px">If the button doesn't work, copy this link into your browser: ${link}</p>
</body></html>`;
}

function renderTextEmail(link: string): string {
  return `Sign in to Flip Turn\n\nOpen this link to sign in (expires in 15 minutes):\n\n${link}\n`;
}
