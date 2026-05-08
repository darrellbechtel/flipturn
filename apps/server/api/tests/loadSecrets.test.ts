import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSecretsFromFile } from '../src/loadSecrets.js';

const SENTINEL_KEYS = [
  '__LOAD_SECRETS_TEST_NEW_KEY__',
  '__LOAD_SECRETS_TEST_PRESET_KEY__',
  '__LOAD_SECRETS_TEST_QUOTED_KEY__',
  '__LOAD_SECRETS_TEST_COMMENT_KEY__',
] as const;

describe('loadSecretsFromFile', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'flipturn-load-secrets-'));
    for (const k of SENTINEL_KEYS) delete process.env[k];
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    for (const k of SENTINEL_KEYS) delete process.env[k];
  });

  it('populates missing process.env keys from the file', () => {
    const path = join(tmp, 'secrets.env');
    writeFileSync(path, '__LOAD_SECRETS_TEST_NEW_KEY__=hello-world\n');
    loadSecretsFromFile(path);
    expect(process.env.__LOAD_SECRETS_TEST_NEW_KEY__).toBe('hello-world');
  });

  it('does not overwrite already-set process.env values', () => {
    process.env.__LOAD_SECRETS_TEST_PRESET_KEY__ = 'shell-wins';
    const path = join(tmp, 'secrets.env');
    writeFileSync(path, '__LOAD_SECRETS_TEST_PRESET_KEY__=file-loses\n');
    loadSecretsFromFile(path);
    expect(process.env.__LOAD_SECRETS_TEST_PRESET_KEY__).toBe('shell-wins');
  });

  it('strips wrapping quotes', () => {
    const path = join(tmp, 'secrets.env');
    writeFileSync(path, '__LOAD_SECRETS_TEST_QUOTED_KEY__="quoted value"\n');
    loadSecretsFromFile(path);
    expect(process.env.__LOAD_SECRETS_TEST_QUOTED_KEY__).toBe('quoted value');
  });

  it('strips trailing # comments from unquoted values', () => {
    const path = join(tmp, 'secrets.env');
    writeFileSync(path, '__LOAD_SECRETS_TEST_COMMENT_KEY__=actual    # trailing comment\n');
    loadSecretsFromFile(path);
    expect(process.env.__LOAD_SECRETS_TEST_COMMENT_KEY__).toBe('actual');
  });

  it('silently tolerates a missing file', () => {
    const missing = join(tmp, 'does-not-exist.env');
    expect(() => loadSecretsFromFile(missing)).not.toThrow();
  });
});
