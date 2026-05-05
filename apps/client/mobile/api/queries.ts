import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider.js';
import {
  listAthletes,
  onboardAthlete,
  unlinkAthlete,
  getSwims,
  getPersonalBests,
  getProgression,
} from './athletes.js';
import { getMe } from './auth.js';

function tokenOrThrow(token: string | null | undefined): string {
  if (!token) throw new Error('not authenticated');
  return token;
}

export function useMe() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['me'],
    queryFn: () => getMe(tokenOrThrow(session?.token)),
    enabled: !!session?.token,
  });
}

export function useAthletes() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['athletes'],
    queryFn: () => listAthletes(tokenOrThrow(session?.token)),
    enabled: !!session?.token,
  });
}

export function useOnboardAthlete() {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      sncId: string;
      relationship?: 'PARENT' | 'GUARDIAN' | 'SELF' | 'OTHER';
    }) => onboardAthlete(tokenOrThrow(session?.token), input.sncId, input.relationship),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['athletes'] });
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export function useUnlinkAthlete() {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (athleteId: string) => unlinkAthlete(tokenOrThrow(session?.token), athleteId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['athletes'] });
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export function useSwims(athleteId: string | undefined, eventKey?: string) {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['swims', athleteId, eventKey],
    queryFn: () => getSwims(tokenOrThrow(session?.token), athleteId!, eventKey ? { eventKey } : {}),
    enabled: !!session?.token && !!athleteId,
  });
}

export function usePersonalBests(athleteId: string | undefined) {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['personal-bests', athleteId],
    queryFn: () => getPersonalBests(tokenOrThrow(session?.token), athleteId!),
    enabled: !!session?.token && !!athleteId,
  });
}

export function useProgression(athleteId: string | undefined, eventKey: string | undefined) {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['progression', athleteId, eventKey],
    queryFn: () => getProgression(tokenOrThrow(session?.token), athleteId!, eventKey!),
    enabled: !!session?.token && !!athleteId && !!eventKey,
  });
}
