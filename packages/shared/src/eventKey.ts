import { STROKES, COURSES, type Stroke, type Course } from './enums.js';

export interface EventKeyParts {
  readonly distanceM: number;
  readonly stroke: Stroke;
  readonly course: Course;
}

export function buildEventKey(parts: EventKeyParts): string {
  if (!Number.isInteger(parts.distanceM) || parts.distanceM <= 0) {
    throw new Error(`buildEventKey: distanceM must be a positive integer, got ${parts.distanceM}`);
  }
  if (!STROKES.includes(parts.stroke)) {
    throw new Error(`buildEventKey: unknown stroke ${parts.stroke}`);
  }
  if (!COURSES.includes(parts.course)) {
    throw new Error(`buildEventKey: unknown course ${parts.course}`);
  }
  return `${parts.distanceM}_${parts.stroke}_${parts.course}`;
}

export function parseEventKey(key: string): EventKeyParts {
  const parts = key.split('_');
  if (parts.length !== 3) {
    throw new Error(`parseEventKey: expected DISTANCE_STROKE_COURSE, got ${JSON.stringify(key)}`);
  }
  const [distanceStr, strokeStr, courseStr] = parts as [string, string, string];

  const distanceM = parseInt(distanceStr, 10);
  if (!Number.isInteger(distanceM) || distanceM <= 0 || `${distanceM}` !== distanceStr) {
    throw new Error(`parseEventKey: invalid distance ${distanceStr}`);
  }
  if (!STROKES.includes(strokeStr as Stroke)) {
    throw new Error(`parseEventKey: unknown stroke ${strokeStr}`);
  }
  if (!COURSES.includes(courseStr as Course)) {
    throw new Error(`parseEventKey: unknown course ${courseStr}`);
  }

  return {
    distanceM,
    stroke: strokeStr as Stroke,
    course: courseStr as Course,
  };
}
