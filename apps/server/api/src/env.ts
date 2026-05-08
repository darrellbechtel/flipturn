import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  SENTRY_DSN: z
    .string()
    .transform((v) => (v === '' ? undefined : v))
    .pipe(z.string().url().optional()),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  PORT: z.coerce.number().int().positive().default(3000),
  BASE_URL: z.string().url().default('http://localhost:3000'),
  RESEND_API_KEY: z
    .string()
    .transform((v) => (v === '' ? undefined : v))
    .pipe(z.string().min(1).optional()),
  EMAIL_FROM: z.string().default('Flip Turn <noreply@flipturn.ca>'),
  MOBILE_DEEP_LINK_BASE: z.string().default('flipturn://auth'),
  // Universal Links / App Links — populated after the first EAS build prints
  // the Apple Team ID and the Android signing-cert SHA-256. When unset, the
  // /.well-known routes return 404 (no association published).
  // Uses preprocess so a missing var is treated the same as `KEY=""`.
  IOS_APP_TEAM_ID: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(1).optional(),
  ),
  ANDROID_APP_SHA256: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(1).optional(),
  ),
});

export type ApiEnv = z.infer<typeof EnvSchema>;

let _env: ApiEnv | undefined;

export function getEnv(): ApiEnv {
  if (!_env) {
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
      console.error('Invalid api env:', parsed.error.flatten().fieldErrors);
      process.exit(1);
    }
    _env = parsed.data;
  }
  return _env;
}
