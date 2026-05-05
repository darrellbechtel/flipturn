import { Redirect } from 'expo-router';
import { useAuth } from '../auth/AuthProvider.js';
import { Loading } from '../components/Loading.js';

export default function AuthGate() {
  const { status } = useAuth();
  if (status === 'loading') return <Loading message="Loading…" />;
  if (status === 'authenticated') return <Redirect href="/(app)/home" />;
  return <Redirect href="/(auth)/email-entry" />;
}
