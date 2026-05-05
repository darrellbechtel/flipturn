import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export interface ArchiveRequest {
  readonly baseDir: string;
  readonly host: string;
  readonly sncId: string;
  readonly body: string;
  readonly contentType: string;
}

const EXT_BY_TYPE: Record<string, string> = {
  'text/html': 'html',
  'application/xhtml+xml': 'html',
  'application/json': 'json',
  'text/json': 'json',
  'text/plain': 'txt',
  'application/xml': 'xml',
  'text/xml': 'xml',
};

function extFor(contentType: string): string {
  const base = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return EXT_BY_TYPE[base] ?? 'bin';
}

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

function assertSafeSegment(name: string, label: string): void {
  if (!SAFE_SEGMENT.test(name)) {
    throw new Error(
      `archive: ${label} must match ${SAFE_SEGMENT.source}, got ${JSON.stringify(name)}`,
    );
  }
}

export async function archiveResponse(req: ArchiveRequest): Promise<string> {
  assertSafeSegment(req.host, 'host');
  assertSafeSegment(req.sncId, 'sncId');

  const ext = extFor(req.contentType);
  const dir = resolve(req.baseDir, req.host, req.sncId);
  // Defensive: confirm we didn't escape baseDir via a malicious resolved path.
  if (!dir.startsWith(resolve(req.baseDir))) {
    throw new Error(`archive: refusing to write outside baseDir`);
  }
  await mkdir(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${stamp}.${ext}`;
  const path = join(dir, filename);
  await writeFile(path, req.body, 'utf8');
  return path;
}

export async function listArchivedFor(
  baseDir: string,
  host: string,
  sncId: string,
): Promise<string[]> {
  const dir = resolve(baseDir, host, sncId);
  try {
    const entries = await readdir(dir);
    return entries.sort().map((e) => join(dir, e));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}
