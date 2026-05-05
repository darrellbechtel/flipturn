import { describe, it, expect } from 'vitest';
import { parseStub } from '../src/parser/stub.js';

describe('parseStub', () => {
  it('returns the demo-sarah snapshot for fixtureName="demo-sarah"', () => {
    const snap = parseStub({ fixtureName: 'demo-sarah', sncId: 'unused', body: '' });
    expect(snap.sncId).toBe('DEMO-SARAH-001');
    expect(snap.primaryName).toBe('Sarah Demo');
    expect(snap.swims.length).toBeGreaterThan(0);
  });

  it('returns the demo-benji snapshot for fixtureName="demo-benji"', () => {
    const snap = parseStub({ fixtureName: 'demo-benji', sncId: 'unused', body: '' });
    expect(snap.sncId).toBe('DEMO-BENJI-002');
  });

  it('throws on unknown fixture', () => {
    expect(() => parseStub({ fixtureName: 'no-such-fixture', sncId: 'x', body: '' })).toThrow();
  });

  it('uses the sncId override if fixtureName not provided', () => {
    const snap = parseStub({ sncId: 'CUSTOM-1', body: '<html/>' });
    expect(snap.sncId).toBe('CUSTOM-1');
    expect(snap.swims).toHaveLength(0);
  });
});
