const ATHLETE_HOST = 'www.swimming.ca';
const MEET_HOST = 'results.swimming.ca';

export type SourceKind = 'athlete' | 'meet' | 'unknown';

export function buildAthleteUrl(sncId: string): string {
  const trimmed = sncId.trim();
  if (!trimmed) {
    throw new Error('buildAthleteUrl: sncId must be non-empty');
  }
  return `https://${ATHLETE_HOST}/swimmer/${encodeURIComponent(trimmed)}/`;
}

export function buildMeetUrl(slug: string): string {
  const trimmed = slug.trim();
  if (!trimmed) {
    throw new Error('buildMeetUrl: slug must be non-empty');
  }
  return `https://${MEET_HOST}/${encodeURIComponent(trimmed)}/`;
}

export function classifyUrl(fullUrl: string): SourceKind {
  let url: URL;
  try {
    url = new URL(fullUrl);
  } catch {
    return 'unknown';
  }
  if (url.host === ATHLETE_HOST && url.pathname.startsWith('/swimmer/')) {
    return 'athlete';
  }
  if (url.host === MEET_HOST) {
    return 'meet';
  }
  return 'unknown';
}
