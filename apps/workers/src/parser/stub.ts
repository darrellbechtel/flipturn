import type { AthleteSnapshot } from './types.js';

export interface StubParseInput {
  readonly sncId: string;
  readonly body: string;
}

export function parseStub(input: StubParseInput): AthleteSnapshot {
  // Plan 3 transitional state: stub.ts will be deleted in Task 7.
  // It now always returns an empty snapshot for the given sncId.
  return {
    sncId: input.sncId,
    primaryName: 'Unknown',
    gender: null,
    homeClub: null,
    dataSource: 'stub',
    swims: [],
  };
}
