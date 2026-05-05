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
  // Prisma columns are nullable, so the API returns `null` (not omitted)
  // for unset values. Accept both null and undefined to match wire shape.
  gender: z.enum(GENDERS).nullable().optional(),
  homeClub: z.string().nullable().optional(),
  lastScrapedAt: z.coerce.date().nullable().optional(),
});
export type AthleteDto = z.infer<typeof AthleteDtoSchema>;

// ─── Swims & PBs ────────────────────────────────────────────────────────

export const SwimDtoSchema = z.object({
  id: z.string(),
  eventKey: z.string(),
  timeCentiseconds: z.number().int().nonnegative(),
  splits: z.array(z.number().int().nonnegative()),
  // place is `Int?` in Prisma, so the API can return `null`.
  place: z.number().int().positive().nullable().optional(),
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
