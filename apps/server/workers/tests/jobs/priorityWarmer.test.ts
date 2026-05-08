import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@flipturn/db';
import {
  runPriorityWarmer,
  type FetchFn,
} from '../../src/jobs/priorityWarmer';

const searchHtml = readFileSync(
  join(__dirname, '..', 'parser', '__fixtures__', 'search-results.html'),
  'utf8',
);
const swimmerHtml = readFileSync(
  join(__dirname, '..', 'parser', '__fixtures__', 'swimmer-5567334.html'),
  'utf8',
);

/**
 * Build a tiny prisma mock with the four call surfaces runPriorityWarmer uses.
 * `existing` lets each test inject the row that findUnique should return for
 * the swimmer; `clubMatch` lets it inject the row that club.findFirst returns.
 *
 * `upserts.create` and `upserts.update` capture the data argument so tests can
 * assert on what would have been written.
 */
function buildPrisma(opts: {
  existing?: Record<string, unknown> | null;
  clubMatch?: { id: string } | null;
} = {}) {
  const created: Array<Record<string, unknown>> = [];
  const updated: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const clubUpdates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];

  const existing = opts.existing ?? null;
  const clubMatch = opts.clubMatch ?? null;

  const prisma = {
    athlete: {
      findUnique: vi.fn(async () => existing),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return args.data;
      }),
      update: vi.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        updated.push(args);
        return args.data;
      }),
    },
    club: {
      findFirst: vi.fn(async () => clubMatch),
      update: vi.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        clubUpdates.push(args);
        return args.data;
      }),
    },
  } as unknown as PrismaClient;

  return { prisma, created, updated, clubUpdates };
}

const okFetcher: FetchFn = async (req) => {
  if (req.url.includes('?s=')) return { status: 200, body: searchHtml };
  if (req.url.includes('/swimmer/')) return { status: 200, body: swimmerHtml };
  throw new Error('unexpected url ' + req.url);
};

describe('runPriorityWarmer', () => {
  it('creates a new athlete with source=CRAWLED when none exists', async () => {
    const { prisma, created } = buildPrisma({ existing: null });

    const result = await runPriorityWarmer({
      prisma,
      fetch: okFetcher,
      clubName: 'Felix Bechtel',
    });

    expect(result.searched).toBe(1);
    expect(result.discovered).toBeGreaterThan(0);
    expect(result.upserted).toBe(created.length);
    expect(created.length).toBeGreaterThan(0);

    const row = created.find((d) => d.sncId === '5567334');
    expect(row).toBeDefined();
    expect(row?.source).toBe('CRAWLED');
    expect(row?.primaryName).toBe('Felix Bechtel');
    expect(row?.lastIndexedAt).toBeInstanceOf(Date);
  });

  it('flips source from USER_ONBOARDED to CRAWLED when names match', async () => {
    const { prisma, updated } = buildPrisma({
      existing: {
        sncId: '5567334',
        primaryName: 'Felix Bechtel',
        source: 'USER_ONBOARDED',
        clubId: null,
        homeClub: null,
        gender: null,
        dobYear: null,
      },
    });

    await runPriorityWarmer({
      prisma,
      fetch: okFetcher,
      clubName: 'Felix Bechtel',
    });

    expect(updated.length).toBeGreaterThan(0);
    const ours = updated.find((u) => (u.where as { sncId?: string }).sncId === '5567334');
    expect(ours).toBeDefined();
    expect(ours?.data.source).toBe('CRAWLED');
  });

  it('does NOT flip source when existing primaryName differs (potential merge conflict)', async () => {
    const { prisma, updated } = buildPrisma({
      existing: {
        sncId: '5567334',
        primaryName: 'Someone Else',
        source: 'USER_ONBOARDED',
        clubId: null,
        homeClub: null,
        gender: null,
        dobYear: null,
      },
    });

    await runPriorityWarmer({
      prisma,
      fetch: okFetcher,
      clubName: 'Felix Bechtel',
    });

    const ours = updated.find((u) => (u.where as { sncId?: string }).sncId === '5567334');
    expect(ours).toBeDefined();
    // USER_ONBOARDED record with different name must be preserved as-is.
    expect(ours?.data.source).toBeUndefined();
  });

  it('does not regress an already-CRAWLED record (no source field on update)', async () => {
    const { prisma, updated } = buildPrisma({
      existing: {
        sncId: '5567334',
        primaryName: 'Felix Bechtel',
        source: 'CRAWLED',
        clubId: null,
        homeClub: null,
        gender: 'M',
        dobYear: 2015,
      },
    });

    await runPriorityWarmer({
      prisma,
      fetch: okFetcher,
      clubName: 'Felix Bechtel',
    });

    const ours = updated.find((u) => (u.where as { sncId?: string }).sncId === '5567334');
    expect(ours).toBeDefined();
    // Already CRAWLED — we don't write `source`, so the field is omitted.
    expect(ours?.data.source).toBeUndefined();
  });

  it('returns {searched:1, discovered:0, upserted:0} when search yields no results', async () => {
    const { prisma, created, updated } = buildPrisma();
    const emptySearchHtml =
      '<html><body><main><p>No results found.</p></main></body></html>';

    const result = await runPriorityWarmer({
      prisma,
      fetch: async (req) => {
        if (req.url.includes('?s=')) return { status: 200, body: emptySearchHtml };
        throw new Error('should not fetch swimmer pages on empty results');
      },
      clubName: 'Nonexistent Club Xyz',
    });

    expect(result).toEqual({ searched: 1, discovered: 0, upserted: 0 });
    expect(created).toHaveLength(0);
    expect(updated).toHaveLength(0);
  });

  it('skips swimmers whose profile fetch returns non-200 (continues with the next)', async () => {
    const { prisma, created } = buildPrisma({ existing: null });

    const result = await runPriorityWarmer({
      prisma,
      fetch: async (req) => {
        if (req.url.includes('?s=')) return { status: 200, body: searchHtml };
        // Force every swimmer page to 503
        if (req.url.includes('/swimmer/')) return { status: 503, body: '' };
        throw new Error('unexpected url ' + req.url);
      },
      clubName: 'Felix Bechtel',
    });

    expect(result.searched).toBe(1);
    expect(result.discovered).toBeGreaterThan(0);
    // No upserts because every profile failed.
    expect(result.upserted).toBe(0);
    expect(created).toHaveLength(0);
  });

  it('updates Club.lastCrawledAt when the input club name ILIKE-matches a Club row', async () => {
    const { prisma, clubUpdates } = buildPrisma({
      existing: null,
      clubMatch: { id: 'CLUB-WARRIOR-XYZ12' },
    });

    await runPriorityWarmer({
      prisma,
      fetch: okFetcher,
      clubName: 'Club Warrior',
    });

    expect(clubUpdates.length).toBeGreaterThan(0);
    const last = clubUpdates[clubUpdates.length - 1]!;
    expect(last.where).toEqual({ id: 'CLUB-WARRIOR-XYZ12' });
    expect(last.data.lastCrawledAt).toBeInstanceOf(Date);
  });
});
