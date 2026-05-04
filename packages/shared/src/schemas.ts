import { z } from 'zod';
import { GENDERS, RELATIONSHIPS, SWIM_STATUSES } from './enums.js';

// ─── Auth ────────────────────────────────────────────────────────────────

export const MagicLinkRequestSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.string().email()),
});
export type MagicLinkRequest = z.infer<typeof MagicLinkRequestSchema>;

export const MagicLinkConsumeSchema = z.object({
  token: z.string().min(1),
});
export type MagicLinkConsume = z.infer<typeof MagicLinkConsumeSchema>;

// ─── Athletes ───────────────────────────────────────────────────────────

export const OnboardAthleteSchema = z.object({
  sncId: z.string().min(1),
  relationship: z.enum(RELATIONSHIPS).default('PARENT'),
});
export type OnboardAthleteRequest = z.infer<typeof OnboardAthleteSchema>;

export const AthleteDtoSchema = z.object({
  id: z.string(),
  sncId: z.string(),
  primaryName: z.string(),
  gender: z.enum(GENDERS).optional(),
  homeClub: z.string().optional(),
  lastScrapedAt: z.coerce.date().optional(),
});
export type AthleteDto = z.infer<typeof AthleteDtoSchema>;

// ─── Swims & PBs ────────────────────────────────────────────────────────

export const SwimDtoSchema = z.object({
  id: z.string(),
  eventKey: z.string(),
  timeCentiseconds: z.number().int().nonnegative(),
  splits: z.array(z.number().int().nonnegative()),
  place: z.number().int().positive().optional(),
  status: z.enum(SWIM_STATUSES),
  meetName: z.string(),
  swamAt: z.coerce.date(),
});
export type SwimDto = z.infer<typeof SwimDtoSchema>;

export const PersonalBestDtoSchema = z.object({
  eventKey: z.string(),
  timeCentiseconds: z.number().int().nonnegative(),
  achievedAt: z.coerce.date(),
  swimId: z.string(),
});
export type PersonalBestDto = z.infer<typeof PersonalBestDtoSchema>;

export const ProgressionPointSchema = z.object({
  date: z.coerce.date(),
  timeCentiseconds: z.number().int().nonnegative(),
  meetName: z.string(),
});
export type ProgressionPoint = z.infer<typeof ProgressionPointSchema>;
