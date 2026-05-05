import type { AthleteSnapshot, SwimRecord } from './types.js';

export interface StubParseInput {
  readonly fixtureName?: string | undefined;
  readonly sncId: string;
  readonly body: string;
}

const DEMO_SARAH: AthleteSnapshot = {
  sncId: 'DEMO-SARAH-001',
  primaryName: 'Sarah Demo',
  gender: 'F',
  homeClub: 'Waterloo Region Aquatics',
  dataSource: 'stub',
  swims: [
    {
      meetExternalId: 'DEMO-MEET-001',
      meetName: 'Demo Spring Open 2026',
      meetStartDate: new Date('2026-04-01'),
      meetEndDate: new Date('2026-04-03'),
      course: 'LCM',
      distanceM: 100,
      stroke: 'FR',
      round: 'TIMED_FINAL',
      gender: 'F',
      ageBand: '13-14',
      timeCentiseconds: 5732,
      splits: [3120, 2612],
      place: 3,
      status: 'OFFICIAL',
      swamAt: new Date('2026-04-01T10:00:00Z'),
    },
    {
      meetExternalId: 'DEMO-MEET-001',
      meetName: 'Demo Spring Open 2026',
      meetStartDate: new Date('2026-04-01'),
      meetEndDate: new Date('2026-04-03'),
      course: 'LCM',
      distanceM: 200,
      stroke: 'FR',
      round: 'TIMED_FINAL',
      gender: 'F',
      ageBand: '13-14',
      timeCentiseconds: 12345,
      splits: [3010, 3120, 3110, 3105],
      place: 4,
      status: 'OFFICIAL',
      swamAt: new Date('2026-04-02T10:00:00Z'),
    },
  ] satisfies SwimRecord[],
};

const DEMO_BENJI: AthleteSnapshot = {
  sncId: 'DEMO-BENJI-002',
  primaryName: 'Benji Demo',
  gender: 'M',
  homeClub: 'Waterloo Region Aquatics',
  dataSource: 'stub',
  swims: [
    {
      meetExternalId: 'DEMO-MEET-001',
      meetName: 'Demo Spring Open 2026',
      meetStartDate: new Date('2026-04-01'),
      meetEndDate: new Date('2026-04-03'),
      course: 'LCM',
      distanceM: 50,
      stroke: 'FR',
      round: 'TIMED_FINAL',
      gender: 'M',
      ageBand: '11-12',
      timeCentiseconds: 3145,
      splits: [],
      place: 2,
      status: 'OFFICIAL',
      swamAt: new Date('2026-04-01T11:00:00Z'),
    },
  ] satisfies SwimRecord[],
};

const FIXTURES: Record<string, AthleteSnapshot> = {
  'demo-sarah': DEMO_SARAH,
  'demo-benji': DEMO_BENJI,
};

export function parseStub(input: StubParseInput): AthleteSnapshot {
  if (input.fixtureName) {
    const snap = FIXTURES[input.fixtureName];
    if (!snap) {
      throw new Error(`parseStub: unknown fixture "${input.fixtureName}"`);
    }
    return snap;
  }
  // No fixture: synthesize an empty snapshot using the provided sncId.
  return {
    sncId: input.sncId,
    primaryName: 'Unknown',
    gender: null,
    homeClub: null,
    dataSource: 'stub',
    swims: [],
  };
}
