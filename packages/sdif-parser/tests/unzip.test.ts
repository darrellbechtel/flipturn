import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AdmZip from 'adm-zip';
import { extractHy3 } from '../src/unzip.js';

describe('extractHy3', () => {
  it('returns .hy3 contents from a meet results zip', () => {
    const buf = readFileSync(resolve(__dirname, '__fixtures__/mssac-hicken-2026.zip'));
    const text = extractHy3(buf);
    expect(text.length).toBeGreaterThan(1_000_000); // real .hy3 is ~2 MB
    expect(text.startsWith('A1')).toBe(true); // first record is the file header
  });

  it('throws if no .hy3 found in zip', () => {
    const z = new AdmZip();
    z.addFile('notes.txt', Buffer.from('hello'));
    expect(() => extractHy3(z.toBuffer())).toThrow(/no \.hy3/i);
  });
});
