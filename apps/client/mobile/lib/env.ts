/**
 * EXPO_PUBLIC_* env vars are bundled into the JS bundle at build time
 * by the Expo bundler. At runtime (both in the bundle and in Node tests)
 * they're accessible via process.env.
 *
 * Don't put secrets in EXPO_PUBLIC_* vars — they're shipped to the client.
 */
export function apiBaseUrl(): string {
  const url = process.env['EXPO_PUBLIC_API_BASE_URL'];
  if (!url) {
    throw new Error(
      'EXPO_PUBLIC_API_BASE_URL is not set. ' +
        'Copy .env.example to .env (or .env.local) and rebuild.',
    );
  }
  return url.replace(/\/$/, ''); // strip trailing slash
}
