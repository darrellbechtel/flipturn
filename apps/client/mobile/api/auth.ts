import { apiClient } from './client.js';

export async function requestMagicLink(email: string): Promise<void> {
  await apiClient<void>('/v1/auth/magic-link/request', {
    method: 'POST',
    body: { email },
  });
}

export async function consumeMagicLink(token: string): Promise<{ sessionToken: string }> {
  return apiClient<{ sessionToken: string }>('/v1/auth/magic-link/consume', {
    method: 'POST',
    body: { token },
  });
}

export interface MeResponse {
  readonly user: { id: string; email: string; createdAt: string };
  readonly athletes: Array<{
    id: string;
    sncId: string;
    primaryName: string;
    gender: 'M' | 'F' | 'X' | null;
    homeClub: string | null;
    relationship: 'PARENT' | 'GUARDIAN' | 'SELF' | 'OTHER';
  }>;
}

export async function getMe(sessionToken: string): Promise<MeResponse> {
  return apiClient<MeResponse>('/v1/auth/me', { sessionToken });
}

export async function deleteMe(sessionToken: string): Promise<void> {
  await apiClient<void>('/v1/me', { method: 'DELETE', sessionToken });
}
