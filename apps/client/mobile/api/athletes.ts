import { apiClient } from './client.js';

export interface AthleteDto {
  readonly id: string;
  readonly sncId: string;
  readonly primaryName: string;
  readonly gender: 'M' | 'F' | 'X' | null;
  readonly homeClub: string | null;
  readonly lastScrapedAt: string | null;
}

export interface OnboardResponse {
  readonly athlete: AthleteDto;
}

export async function onboardAthlete(
  sessionToken: string,
  sncId: string,
  relationship?: 'PARENT' | 'GUARDIAN' | 'SELF' | 'OTHER',
): Promise<OnboardResponse> {
  return apiClient<OnboardResponse>('/v1/athletes/onboard', {
    method: 'POST',
    body: relationship ? { sncId, relationship } : { sncId },
    sessionToken,
  });
}

export async function listAthletes(sessionToken: string): Promise<{ athletes: AthleteDto[] }> {
  return apiClient<{ athletes: AthleteDto[] }>('/v1/athletes', { sessionToken });
}

export async function unlinkAthlete(sessionToken: string, athleteId: string): Promise<void> {
  await apiClient<void>(`/v1/user-athletes/${athleteId}`, {
    method: 'DELETE',
    sessionToken,
  });
}

export interface SwimDto {
  readonly id: string;
  readonly eventKey: string;
  readonly timeCentiseconds: number;
  readonly splits: number[];
  readonly place: number | null;
  readonly status: 'OFFICIAL' | 'DQ' | 'NS' | 'DNF' | 'WITHDRAWN';
  readonly meetName: string;
  readonly swamAt: string;
}

export interface SwimsPage {
  readonly swims: SwimDto[];
  readonly nextCursor: string | null;
}

export async function getSwims(
  sessionToken: string,
  athleteId: string,
  options: { eventKey?: string; cursor?: string; limit?: number } = {},
): Promise<SwimsPage> {
  return apiClient<SwimsPage>(`/v1/athletes/${athleteId}/swims`, {
    sessionToken,
    query: {
      eventKey: options.eventKey,
      cursor: options.cursor,
      limit: options.limit,
    },
  });
}

export interface PersonalBestDto {
  readonly eventKey: string;
  readonly timeCentiseconds: number;
  readonly achievedAt: string;
  readonly swimId: string;
}

export async function getPersonalBests(
  sessionToken: string,
  athleteId: string,
): Promise<{ personalBests: PersonalBestDto[] }> {
  return apiClient<{ personalBests: PersonalBestDto[] }>(
    `/v1/athletes/${athleteId}/personal-bests`,
    { sessionToken },
  );
}

export interface ProgressionPoint {
  readonly date: string;
  readonly timeCentiseconds: number;
  readonly meetName: string;
}

export async function getProgression(
  sessionToken: string,
  athleteId: string,
  eventKey: string,
): Promise<{ points: ProgressionPoint[] }> {
  return apiClient<{ points: ProgressionPoint[] }>(`/v1/athletes/${athleteId}/progression`, {
    sessionToken,
    query: { eventKey },
  });
}
