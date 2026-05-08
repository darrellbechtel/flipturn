import { z } from 'zod';

export const AthleteSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(80),
  clubId: z.string().trim().min(1).max(80).optional(),
  province: z
    .string()
    .trim()
    .length(2)
    .transform((s) => s.toUpperCase())
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type AthleteSearchQuery = z.infer<typeof AthleteSearchQuerySchema>;

export const AthleteSearchResultSchema = z.object({
  sncId: z.string(),
  displayName: z.string(),
  alternateNames: z.array(z.string()),
  dobYear: z.number().int().nullable(),
  gender: z.enum(['M', 'F', 'X']).nullable(),
  club: z
    .object({
      id: z.string(),
      name: z.string(),
      province: z.string().nullable(),
    })
    .nullable(),
  hasFlipturnProfile: z.boolean(),
  alreadyLinkedToMe: z.boolean(),
});
export type AthleteSearchResult = z.infer<typeof AthleteSearchResultSchema>;

export const AthleteSearchResponseSchema = z.object({
  results: z.array(AthleteSearchResultSchema),
  total: z.number().int().nonnegative(),
});
export type AthleteSearchResponse = z.infer<typeof AthleteSearchResponseSchema>;
