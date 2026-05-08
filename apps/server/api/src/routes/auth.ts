import { Hono, type MiddlewareHandler } from 'hono';
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
import { rateLimit } from '../middleware/rateLimit.js';
import { SIGN_IN_PAGE_HTML } from './signInPage.js';

// No-op middleware: used when deps.redis is undefined (test harnesses) so the
// route shape stays identical and rate-limit logic is the only thing skipped.
const passThrough: MiddlewareHandler = async (_c, next) => {
  await next();
};

export function authRoutes(deps: AppDeps): Hono {
  const r = new Hono();
  r.onError(errorHandler);

  // Rate limit: 5 magic-link requests per IP per hour.
  // Closed beta has ~10-20 users; this is generous enough for legitimate users
  // and tight enough to slow down email-bomb / token-spam attempts. We apply
  // the limit BEFORE zValidator so malformed-JSON spam still counts toward
  // the bucket (prevents validation-error amplification attacks).
  const magicLinkRequestLimiter: MiddlewareHandler = deps.redis
    ? rateLimit(deps.redis, {
        bucket: 'magic-link-request',
        windowSec: 3600,
        limit: 5,
        ...(deps.rateLimitIdentify ? { identify: deps.rateLimitIdentify } : {}),
      })
    : passThrough;

  r.post(
    '/magic-link/request',
    magicLinkRequestLimiter,
    zValidator('json', MagicLinkRequestSchema),
    async (c) => {
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
    },
  );

  // Browser-friendly fallback: emails clicked from a desktop browser (or any
  // device without the mobile app installed) land here. We render an HTML
  // page that reads `?token=` client-side and only POSTs to `/consume` when
  // the user clicks "Sign in" — never auto-consume on GET, since email
  // scanners / link previewers prefetch URLs and would burn the token.
  r.get('/magic-link/consume', (c) => {
    return c.html(SIGN_IN_PAGE_HTML);
  });

  r.post('/magic-link/consume', zValidator('json', MagicLinkConsumeSchema), async (c) => {
    const { token } = c.req.valid('json');
    const tokenHash = hashToken(token);
    const row = await deps.prisma.magicLinkToken.findUnique({ where: { tokenHash } });
    if (!row) {
      throw new ApiError(401, 'Invalid or expired token', 'invalid_token');
    }
    if (row.consumedAt) {
      throw new ApiError(401, 'Invalid or expired token', 'invalid_token');
    }
    if (row.expiresAt.getTime() < Date.now()) {
      throw new ApiError(401, 'Invalid or expired token', 'invalid_token');
    }

    const sessionTokenPlain = generateSessionToken();
    const sessionTokenHash = hashToken(sessionTokenPlain);

    // Atomically mark consumed only if it's still unconsumed. Closes the
    // TOCTOU race where two concurrent /consume calls both pass the
    // pre-transaction check and both issue sessions.
    const updateResult = await deps.prisma.magicLinkToken.updateMany({
      where: { id: row.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (updateResult.count === 0) {
      // Lost the race — another consume call already marked it.
      throw new ApiError(401, 'Invalid or expired token', 'invalid_token');
    }

    await deps.prisma.session.create({
      data: { userId: row.userId, tokenHash: sessionTokenHash },
    });

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
