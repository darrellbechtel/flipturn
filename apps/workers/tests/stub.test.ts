import { describe, it, expect } from 'vitest';
import { parseStub } from '../src/parser/stub.js';

describe('parseStub (transitional)', () => {
  it('returns an empty snapshot keyed on sncId', () => {
    const snap = parseStub({ sncId: 'CUSTOM-1', body: '<html/>' });
    expect(snap.sncId).toBe('CUSTOM-1');
    expect(snap.swims).toHaveLength(0);
    expect(snap.dataSource).toBe('stub');
  });
});
