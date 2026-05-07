import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  // Optional. If unset or empty, Sentry is a no-op.
  SENTRY_DSN: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined))
    .pipe(z.string().url().optional()),
  // Optional. Defaults to "info"; lower (debug/trace) in dev.
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  // Politeness defaults — overridable for testing.
  SCRAPE_USER_AGENT: z
    .string()
    .default('FlipTurnBot/0.1 (+https://flipturn.ca/bot; contact@flipturn.ca)'),
  SCRAPE_RATE_LIMIT_MS: z.coerce.number().int().positive().default(5000),
  SCRAPE_DAILY_HOST_BUDGET: z.coerce.number().int().positive().default(500),
  // Path under repo root for raw artifact archive.
  ARCHIVE_DIR: z.string().default('./data/raw'),
});

export type WorkerEnv = z.infer<typeof EnvSchema>;

let _env: WorkerEnv | undefined;

export function getEnv(): WorkerEnv {
  if (!_env) {
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
      console.error('Invalid worker env:', parsed.error.flatten().fieldErrors);
      process.exit(1);
    }
    _env = parsed.data;
  }
  return _env;
}
