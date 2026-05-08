import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FetchFn } from '@flipturn/workers/jobs/priorityWarmer';
import { searchRemoteAndPersistStubs } from '../../src/services/searchProxy.js';
import { createTestApp, type TestApp } from '../helpers/testApp.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const searchHtml = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    '..',
    'workers',
    'tests',
    'parser',
    '__fixtures__',
    'search-results.html',
  ),
  'utf8',
);

let h: TestApp;

describe('searchRemoteAndPersistStubs', () => {
  beforeAll(async () => {
    h = await createTestApp();
  });
  afterAll(async () => {
    await h.teardown();
  });
  beforeEach(async () => {
    await h.prisma.userAthlete.deleteMany();
    await h.prisma.athlete.deleteMany();
  });

  it('creates stub rows for new sncIds returned by remote search', async () => {
    const fetch: FetchFn = vi.fn(async () => ({ status: 200, body: searchHtml }));

    const result = await searchRemoteAndPersistStubs({
      prisma: h.prisma,
      fetch,
      q: 'Felix Bechtel',
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith({
      url: 'https://www.swimming.ca/?s=Felix%20Bechtel',
    });
    expect(result.sncIds.length).toBeGreaterThan(0);
    expect(result.stubsCreated).toBe(result.sncIds.length);

    const persisted = await h.prisma.athlete.findMany();
    expect(persisted).toHaveLength(result.stubsCreated);
    for (const a of persisted) {
      expect(a.source).toBe('CRAWLED');
      expect(a.alternateNames).toEqual([]);
    }
  });

  it('skips sncIds that already exist (idempotent)', async () => {
    const fetch: FetchFn = vi.fn(async () => ({ status: 200, body: searchHtml }));

    // Pre-create Felix
    await h.prisma.athlete.create({
      data: { sncId: '5567334', primaryName: 'Felix Bechtel (existing)' },
    });

    const result = await searchRemoteAndPersistStubs({
      prisma: h.prisma,
      fetch,
      q: 'Felix Bechtel',
    });

    // Result still includes Felix in sncIds (the parser found him), but he
    // was not re-created.
    expect(result.sncIds).toContain('5567334');
    expect(result.stubsCreated).toBe(result.sncIds.length - 1);

    const felix = await h.prisma.athlete.findUnique({ where: { sncId: '5567334' } });
    expect(felix?.primaryName).toBe('Felix Bechtel (existing)'); // not overwritten
  });

  it('returns empty result on non-200 response (degrades gracefully)', async () => {
    const fetch: FetchFn = vi.fn(async () => ({ status: 503, body: '' }));

    const result = await searchRemoteAndPersistStubs({
      prisma: h.prisma,
      fetch,
      q: 'Nobody',
    });

    expect(result).toEqual({ stubsCreated: 0, sncIds: [] });
    const persisted = await h.prisma.athlete.findMany();
    expect(persisted).toHaveLength(0);
  });

  it('returns empty result when fetch throws (degrades gracefully)', async () => {
    const fetch: FetchFn = vi.fn(async () => {
      throw new Error('network down');
    });

    const result = await searchRemoteAndPersistStubs({
      prisma: h.prisma,
      fetch,
      q: 'Nobody',
    });

    expect(result).toEqual({ stubsCreated: 0, sncIds: [] });
  });

  it('URL-encodes the query parameter', async () => {
    const fetch: FetchFn = vi.fn(async () => ({ status: 200, body: '' }));

    await searchRemoteAndPersistStubs({
      prisma: h.prisma,
      fetch,
      q: 'foo & bar',
    });

    expect(fetch).toHaveBeenCalledWith({
      url: 'https://www.swimming.ca/?s=foo%20%26%20bar',
    });
  });
});
