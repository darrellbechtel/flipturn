import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archiveResponse, listArchivedFor } from '../src/archive.js';

let tmp: string;

describe('archiveResponse', () => {
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'flipturn-archive-'));
  });

  afterAll(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it('writes the body under <baseDir>/<host>/<sncId>/<ISO>.<ext>', async () => {
    const path = await archiveResponse({
      baseDir: tmp,
      host: 'results.swimming.ca',
      sncId: 'SNC-1',
      body: '<html>hello</html>',
      contentType: 'text/html',
    });

    expect(path.startsWith(tmp)).toBe(true);
    expect(path).toContain('results.swimming.ca');
    expect(path).toContain('SNC-1');
    expect(path).toMatch(/\.html$/);

    const contents = await readFile(path, 'utf8');
    expect(contents).toBe('<html>hello</html>');
  });

  it('chooses the extension from content-type', async () => {
    const html = await archiveResponse({
      baseDir: tmp,
      host: 'h',
      sncId: 's1',
      body: '<x/>',
      contentType: 'text/html; charset=utf-8',
    });
    const json = await archiveResponse({
      baseDir: tmp,
      host: 'h',
      sncId: 's2',
      body: '{}',
      contentType: 'application/json',
    });
    const fallback = await archiveResponse({
      baseDir: tmp,
      host: 'h',
      sncId: 's3',
      body: 'plain',
      contentType: 'application/x-unknown',
    });
    expect(html).toMatch(/\.html$/);
    expect(json).toMatch(/\.json$/);
    expect(fallback).toMatch(/\.bin$/);
  });

  it('listArchivedFor returns archived files for an athlete', async () => {
    await archiveResponse({
      baseDir: tmp,
      host: 'h',
      sncId: 'S-listed',
      body: 'a',
      contentType: 'text/html',
    });
    await new Promise((r) => setTimeout(r, 5));
    await archiveResponse({
      baseDir: tmp,
      host: 'h',
      sncId: 'S-listed',
      body: 'b',
      contentType: 'text/html',
    });
    const files = await listArchivedFor(tmp, 'h', 'S-listed');
    expect(files).toHaveLength(2);
    expect(files[0]).toMatch(/\.html$/);
  });

  it('does not write to a path outside baseDir', async () => {
    await expect(
      archiveResponse({
        baseDir: tmp,
        host: '../escape',
        sncId: 'x',
        body: 'a',
        contentType: 'text/html',
      }),
    ).rejects.toThrow();
  });
});
