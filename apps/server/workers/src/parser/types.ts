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
  /** The host the snapshot was scraped from (e.g. "www.swimming.ca"). */
  readonly dataSource: string;
  readonly swims: readonly SwimRecord[];
}

export interface MeetEventRecord {
  readonly distanceM: number;
  readonly stroke: Stroke;
  readonly gender: Gender;
  readonly ageBand: string | null;
  readonly round: Round;
}

export interface MeetSnapshot {
  readonly externalId: string;
  readonly name: string;
  readonly course: Course;
  readonly location: string | null;
  readonly startDate: Date;
  readonly endDate: Date;
  readonly sanctionBody: string | null;
  readonly dataSource: string;
  readonly events: readonly MeetEventRecord[];
}
