export const STROKES = ['FR', 'BK', 'BR', 'FL', 'IM'] as const;
export type Stroke = (typeof STROKES)[number];

export const COURSES = ['SCM', 'LCM', 'SCY'] as const;
export type Course = (typeof COURSES)[number];

export const GENDERS = ['M', 'F', 'X'] as const;
export type Gender = (typeof GENDERS)[number];

export const ROUNDS = ['PRELIM', 'SEMI', 'FINAL', 'TIMED_FINAL'] as const;
export type Round = (typeof ROUNDS)[number];

export const SWIM_STATUSES = ['OFFICIAL', 'DQ', 'NS', 'DNF', 'WITHDRAWN'] as const;
export type SwimStatus = (typeof SWIM_STATUSES)[number];

export const RELATIONSHIPS = ['PARENT', 'GUARDIAN', 'SELF', 'OTHER'] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

// Common race distances (meters). Not exhaustive — used for dropdowns / validation hints.
export const COMMON_DISTANCES_M = [25, 50, 100, 200, 400, 800, 1500] as const;
