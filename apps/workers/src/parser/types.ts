import type { Stroke, Course, Gender, Round, SwimStatus } from '@flipturn/shared';

export interface SwimRecord {
  readonly meetExternalId: string;
  readonly meetName: string;
  readonly meetStartDate: Date;
  readonly meetEndDate: Date;
  readonly course: Course;
  readonly distanceM: number;
  readonly stroke: Stroke;
  readonly round: Round;
  readonly gender: Gender;
  readonly ageBand: string | null;
  readonly timeCentiseconds: number;
  readonly splits: readonly number[];
  readonly place: number | null;
  readonly status: SwimStatus;
  readonly swamAt: Date;
}

export interface AthleteSnapshot {
  readonly sncId: string;
  readonly primaryName: string;
  readonly gender: Gender | null;
  readonly homeClub: string | null;
  readonly swims: readonly SwimRecord[];
}
