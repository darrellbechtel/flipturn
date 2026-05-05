import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadSession,
  saveSession,
  clearSession,
  __setSecureStoreFakeForTests,
} from '../../auth/session.js';

const fakeStore = new Map<string, string>();

beforeEach(() => {
  fakeStore.clear();
  __setSecureStoreFakeForTests({
    setItemAsync: async (key, value) => {
      fakeStore.set(key, value);
    },
    getItemAsync: async (key) => fakeStore.get(key) ?? null,
    deleteItemAsync: async (key) => {
      fakeStore.delete(key);
    },
  });
});

describe('session storage', () => {
  it('returns null when no session is saved', async () => {
    expect(await loadSession()).toBeNull();
  });

  it('persists and loads a session', async () => {
    await saveSession({ token: 'abc-123', userEmail: 'a@b.com' });
    const loaded = await loadSession();
    expect(loaded).toEqual({ token: 'abc-123', userEmail: 'a@b.com' });
  });

  it('clears the session', async () => {
    await saveSession({ token: 'abc-123', userEmail: 'a@b.com' });
    await clearSession();
    expect(await loadSession()).toBeNull();
  });
});
