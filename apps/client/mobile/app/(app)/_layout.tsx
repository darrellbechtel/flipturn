import { Stack, Redirect } from 'expo-router';
import { useAuth } from '../../auth/AuthProvider.js';
import { Loading } from '../../components/Loading.js';

export default function AppLayout() {
  const { status } = useAuth();
  if (status === 'loading') return <Loading message="Loading…" />;
  if (status === 'unauthenticated') return <Redirect href="/(auth)/email-entry" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
