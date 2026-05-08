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
  // Universal Links (iOS) — Apple Developer Team ID, 10 chars. Combined
  // with the bundle id `app.flipturn.mobile` it forms the AASA appID
  // `<TEAM>.app.flipturn.mobile`. Empty -> AASA serves an empty applinks
  // manifest (valid JSON, just no app-association declared).
  IOS_TEAM_ID: z.string().default(''),
  // App Links (Android) — comma-separated SHA-256 fingerprints of the
  // signing cert(s) for the installed app. Multiple values supported so
  // debug + release can coexist. Format per fingerprint: `AA:BB:CC:...`
  // (uppercase hex, colon-separated). Empty -> assetlinks.json returns
  // an empty array.
  ANDROID_CERT_SHA256: z.string().default(''),
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
