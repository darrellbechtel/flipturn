import { describe, it, expect } from 'vitest';
import {
  generateMagicLinkToken,
  hashToken,
  buildMagicLinkUrl,
  parseBearerHeader,
} from '../src/auth.js';

describe('generateMagicLinkToken', () => {
  it('returns a 64-char hex string', () => {
    const t = generateMagicLinkToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is unique across calls', () => {
    const a = generateMagicLinkToken();
    const b = generateMagicLinkToken();
    expect(a).not.toBe(b);
  });
});

describe('hashToken', () => {
  it('produces a stable sha256 hex digest', () => {
    const h = hashToken('abc123');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken('abc123')).toBe(h);
    expect(hashToken('abc124')).not.toBe(h);
  });
});

describe('buildMagicLinkUrl', () => {
  it('appends token to the deep-link base', () => {
    expect(buildMagicLinkUrl('flipturn://auth', 'tok-1')).toBe('flipturn://auth?token=tok-1');
  });

  it('URL-encodes the token', () => {
    expect(buildMagicLinkUrl('flipturn://auth', 'a b/c')).toBe('flipturn://auth?token=a%20b%2Fc');
  });

  it('uses & separator if base already has a query string', () => {
    expect(buildMagicLinkUrl('https://example.com/?ref=abc', 'tok-1')).toBe(
      'https://example.com/?ref=abc&token=tok-1',
    );
  });
});

describe('parseBearerHeader', () => {
  it('extracts token from "Bearer <token>"', () => {
    expect(parseBearerHeader('Bearer abc')).toBe('abc');
    expect(parseBearerHeader('bearer abc')).toBe('abc');
  });

  it('returns null on missing or malformed header', () => {
    expect(parseBearerHeader(null)).toBeNull();
    expect(parseBearerHeader('')).toBeNull();
    expect(parseBearerHeader('Basic abc')).toBeNull();
    expect(parseBearerHeader('Bearer ')).toBeNull();
  });
});
