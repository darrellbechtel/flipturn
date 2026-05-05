import { useEffect } from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { Screen } from '../components/Screen.js';
import { Loading } from '../components/Loading.js';
import { ErrorMessage } from '../components/ErrorMessage.js';
import { Button } from '../components/Button.js';
import { consumeMagicLink, getMe } from '../api/auth.js';
import { useAuth } from '../auth/AuthProvider.js';

export default function MagicLinkLanding() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const { signIn } = useAuth();

  const mutation = useMutation({
    mutationFn: async (t: string) => {
      const { sessionToken } = await consumeMagicLink(t);
      const me = await getMe(sessionToken);
      return { sessionToken, email: me.user.email };
    },
    onSuccess: async (data) => {
      await signIn({ token: data.sessionToken, userEmail: data.email });
      router.replace('/(app)/home');
    },
  });

  useEffect(() => {
    if (token && !mutation.isPending && !mutation.isSuccess) {
      mutation.mutate(token);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (!token) {
    return (
      <Screen>
        <ErrorMessage message="Missing token in the sign-in link. Try requesting a new one." />
        <Button
          label="Back to sign in"
          variant="secondary"
          onPress={() => router.replace('/(auth)/email-entry')}
        />
      </Screen>
    );
  }

  if (mutation.error) {
    return (
      <Screen>
        <ErrorMessage
          message={
            (mutation.error as Error).message ??
            'Sign-in link is invalid or expired. Request a new one.'
          }
        />
        <Button
          label="Back to sign in"
          variant="secondary"
          onPress={() => router.replace('/(auth)/email-entry')}
        />
      </Screen>
    );
  }

  return <Loading message="Signing in…" />;
}
