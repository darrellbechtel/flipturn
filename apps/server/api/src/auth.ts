import { createHash, randomBytes } from 'node:crypto';

export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

export function generateMagicLinkToken(): string {
  return randomBytes(32).toString('hex');
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function buildMagicLinkUrl(base: string, token: string): string {
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}token=${encodeURIComponent(token)}`;
}

export function parseBearerHeader(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match?.[1] ?? null;
}
