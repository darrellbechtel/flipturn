/**
 * Swim time canonical unit: centiseconds (1/100 second).
 * 5732 = 57.32 seconds = a 100m freestyle.
 */

export function formatSwimTime(centiseconds: number): string {
  if (!Number.isInteger(centiseconds)) {
    throw new Error(`formatSwimTime: expected integer, got ${centiseconds}`);
  }
  if (centiseconds < 0) {
    throw new Error(`formatSwimTime: expected non-negative, got ${centiseconds}`);
  }

  const totalSeconds = Math.floor(centiseconds / 100);
  const cs = centiseconds % 100;
  const csStr = cs.toString().padStart(2, '0');

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    const mm = minutes.toString().padStart(2, '0');
    const ss = seconds.toString().padStart(2, '0');
    return `${hours}:${mm}:${ss}.${csStr}`;
  }

  if (minutes > 0) {
    const ss = seconds.toString().padStart(2, '0');
    // M:SS.cc — leading minute is not zero-padded for readability
    return `${minutes}:${ss}.${csStr}`;
  }

  return `${seconds}.${csStr}`;
}

const TIME_REGEX =
  /^(?:(?<h>\d+):(?<m1>\d{2}):(?<s1>\d{2})|(?<min>\d+):(?<s2>\d{2})|(?<s3>\d+))\.(?<cs>\d{2})$/;

export function parseSwimTime(input: string): number {
  const match = TIME_REGEX.exec(input);
  if (!match || !match.groups) {
    throw new Error(`parseSwimTime: malformed input: ${JSON.stringify(input)}`);
  }
  const g = match.groups;
  const cs = parseInt(g.cs!, 10);

  if (g.h !== undefined) {
    const h = parseInt(g.h, 10);
    const m = parseInt(g.m1!, 10);
    const s = parseInt(g.s1!, 10);
    return h * 360_000 + m * 6000 + s * 100 + cs;
  }
  if (g.min !== undefined) {
    const m = parseInt(g.min, 10);
    const s = parseInt(g.s2!, 10);
    return m * 6000 + s * 100 + cs;
  }
  const s = parseInt(g.s3!, 10);
  return s * 100 + cs;
}
