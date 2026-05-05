import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Load repo-root `.env` into process.env for tests.
 *
 * vitest does not auto-load `.env`, and the worker env schema is required (it
 * calls process.exit(1) on missing fields). This setup file fills that gap
 * without adding a dotenv dependency.
 *
 * Existing process.env values win over the .env file (so CI / shell overrides
 * still work).
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../../../../.env');
try {
  const content = readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1);
    // strip trailing inline comment (only when value isn't quoted)
    const trimmed = value.trim();
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      value = trimmed.slice(1, -1);
    } else {
      // unquoted: a `#` starts a comment
      const hash = value.indexOf('#');
      if (hash >= 0) value = value.slice(0, hash);
      value = value.trim();
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
} catch {
  // .env is optional — CI may inject env vars directly.
}
