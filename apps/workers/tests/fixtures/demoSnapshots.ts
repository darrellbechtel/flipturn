import type { AthleteSnapshot, SwimRecord } from '../../src/parser/types.js';

/**
 * Inline demo-sarah snapshot used by reconcile/PB DB integration tests.
 * Previously sourced from parser/stub.ts's FIXTURES table; that table
 * was removed in Plan 3 Task 5. The snapshot here matches the original
 * shape so the existing integration tests keep passing.
 */
export const DEMO_SARAH: AthleteSnapshot = {
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
