import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Side-effect-on-import: read `~/.config/flipturn/secrets.env` (or
 * `SECRETS_ENV_FILE` if set) and merge missing keys into `process.env`.
 *
 * Why this exists: pm2's `env_file` ecosystem directive is **not** a real
 * pm2 feature — pm2 silently ignores it, leaving production env vars
 * unset and the API quietly falling back to InMemoryEmailSender (so
 * magic-link emails go nowhere). Node 22's `--env-file` flag works but
 * isn't reliably forwarded by tsx-as-interpreter. Loading the file
 * explicitly in app code is robust regardless of launcher.
 *
 * Behavior:
 *   - File path defaults to `~/.config/flipturn/secrets.env`; override
 *     with `SECRETS_ENV_FILE` (useful for tests / alternate hosts).
 *   - Already-set values in `process.env` win — shell overrides + CI
 *     injection still take precedence.
 *   - Missing file is silently tolerated; dev defaults from a repo
 *     `.env` (loaded separately by tests/setup.ts) continue to work.
 *   - Quoted values have their wrapping `"`/`'` stripped; unquoted
 *     values trim trailing `# comment` segments.
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
