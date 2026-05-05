/**
 * Session persistence wrapper around expo-secure-store.
 *
 * In tests we don't import the real expo-secure-store (it requires the
 * Expo runtime). __setSecureStoreFakeForTests injects a Map-backed
 * implementation. In production (Expo bundle), the real module is used.
 */

export interface PersistedSession {
  readonly token: string;
  readonly userEmail: string;
}

interface SecureStoreLike {
  setItemAsync(key: string, value: string): Promise<void>;
  getItemAsync(key: string): Promise<string | null>;
  deleteItemAsync(key: string): Promise<void>;
}

const SESSION_KEY = 'flipturn.session';

let _store: SecureStoreLike | undefined;

async function getStore(): Promise<SecureStoreLike> {
  if (_store) return _store;
  // Lazy import so tests can override before the first call.
  const real = (await import('expo-secure-store')) as unknown as SecureStoreLike;
  _store = real;
  return _store;
}

/** Test-only: inject a fake SecureStore for unit tests. */
export function __setSecureStoreFakeForTests(fake: SecureStoreLike): void {
  _store = fake;
}

export async function saveSession(s: PersistedSession): Promise<void> {
  const store = await getStore();
  await store.setItemAsync(SESSION_KEY, JSON.stringify(s));
}

export async function loadSession(): Promise<PersistedSession | null> {
  const store = await getStore();
  const raw = await store.getItemAsync(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersistedSession;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  const store = await getStore();
  await store.deleteItemAsync(SESSION_KEY);
}
