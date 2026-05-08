import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Side-effect-on-import: read `~/.config/flipturn/secrets.env` (or
 * `SECRETS_ENV_FILE` if set) and merge missing keys into `process.env`.
 *
 * Mirror of apps/server/api/src/loadSecrets.ts — see that file for the
 * full rationale (TL;DR: pm2's env_file is silently ignored; explicit
 * in-code loading is robust regardless of launcher).
 */
export function loadSecretsFromFile(path?: string): void {
  const target = path ?? process.env.SECRETS_ENV_FILE ?? defaultPath();
  let content: string;
  try {
    content = readFileSync(target, 'utf8');
  } catch {
    return;
  }
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1);
    const trimmed = value.trim();
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      value = trimmed.slice(1, -1);
    } else {
      const hash = value.indexOf('#');
      if (hash >= 0) value = value.slice(0, hash);
      value = value.trim();
    }
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = value;
    }
  }
}

function defaultPath(): string {
  return join(homedir(), '.config', 'flipturn', 'secrets.env');
}

loadSecretsFromFile();
