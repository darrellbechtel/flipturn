import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { loadSession, saveSession, clearSession, type PersistedSession } from './session.js';

interface AuthState {
  readonly status: 'loading' | 'unauthenticated' | 'authenticated';
  readonly session: PersistedSession | null;
}

interface AuthContextValue extends AuthState {
  signIn(session: PersistedSession): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', session: null });
  const qc = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const persisted = await loadSession();
      if (cancelled) return;
      setState(
        persisted
          ? { status: 'authenticated', session: persisted }
          : { status: 'unauthenticated', session: null },
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const value: AuthContextValue = {
    ...state,
    signIn: async (session) => {
      await saveSession(session);
      setState({ status: 'authenticated', session });
    },
    signOut: async () => {
      await clearSession();
      qc.clear(); // wipe all cached queries on sign-out
      setState({ status: 'unauthenticated', session: null });
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
