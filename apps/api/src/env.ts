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
  EMAIL_FROM: z.string().default('Flip Turn <noreply@flipturn.app>'),
  MOBILE_DEEP_LINK_BASE: z.string().default('flipturn://auth'),
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
