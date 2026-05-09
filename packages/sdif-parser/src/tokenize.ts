import type { RawRecord } from './types.js';

/**
 * Splits a `.hy3` text body into typed `RawRecord`s.
 *
 * - Splits on `\n` or `\r\n` (the fixture is CRLF; `String.split(/\r?\n/)` handles both).
 * - The first 2 characters become the record code (cols 1-2); columns 3+ are the body.
 * - Original whitespace inside `body` is preserved — column positions matter for the
 *   per-record parsers in Tasks 4-8.
 * - Lines shorter than 2 characters (i.e. blank lines) are skipped.
 * - `lineNumber` is 1-indexed against the original input, so error messages can point
 *   at the source line directly.
 */
export function tokenize(input: string): RawRecord[] {
  const out: RawRecord[] = [];
  const lines = input.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || line.length < 2) continue;
    out.push({
      code: line.slice(0, 2),
      body: line.slice(2),
      lineNumber: i + 1,
    });
  }
  return out;
}
