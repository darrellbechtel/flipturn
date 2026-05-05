import { useState, useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Screen } from '../../components/Screen.js';
import { Button } from '../../components/Button.js';
import { TextField } from '../../components/TextField.js';
import { ErrorMessage } from '../../components/ErrorMessage.js';
import { Loading } from '../../components/Loading.js';
import { colors, spacing, typography } from '../../theme/index.js';
import { useAthletes, useOnboardAthlete } from '../../api/queries.js';

export default function Onboarding() {
  const [sncId, setSncId] = useState('');
  const onboard = useOnboardAthlete();
  const athletes = useAthletes();
  const qc = useQueryClient();
  const [pollingForId, setPollingForId] = useState<string | null>(null);

  // Once a new athlete is onboarded, poll the athletes list every 5s
  // until that athlete's lastScrapedAt becomes non-null OR 60s elapse.
  useEffect(() => {
    if (!pollingForId) return;
    const start = Date.now();
    const interval = setInterval(() => {
      void qc.invalidateQueries({ queryKey: ['athletes'] });
      const found = athletes.data?.athletes.find((a) => a.id === pollingForId);
      if (found?.lastScrapedAt) {
        clearInterval(interval);
        setPollingForId(null);
        router.replace('/(app)/home');
        return;
      }
      if (Date.now() - start > 60_000) {
        clearInterval(interval);
        setPollingForId(null);
        router.replace('/(app)/home'); // home will show "Loading…" status
      }
    }, 5_000);
    return () => clearInterval(interval);
  }, [pollingForId, athletes.data, qc]);

  if (pollingForId) {
    return <Loading message="Fetching swim history…" />;
  }

  return (
    <Screen>
      <Text style={styles.title}>Add your swimmer</Text>
      <Text style={styles.subtitle}>
        Enter your kid's Swimming Canada athlete ID. You can find it in their SNC profile or on
        their meet results.
      </Text>
      <TextField
        label="SNC athlete ID"
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="e.g. 4030816"
        value={sncId}
        onChangeText={setSncId}
      />
      {onboard.error ? (
        <ErrorMessage message={(onboard.error as Error).message ?? 'Could not onboard.'} />
      ) : null}
      <Button
        label="Add swimmer"
        loading={onboard.isPending}
        disabled={!sncId.trim()}
        onPress={() => {
          onboard.mutate(
            { sncId: sncId.trim() },
            {
              onSuccess: (data) => {
                setPollingForId(data.athlete.id);
              },
            },
          );
        }}
        style={{ marginTop: spacing.md }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.display, color: colors.text, marginBottom: spacing.sm },
  subtitle: {
    ...typography.body,
    color: colors.textMuted,
    marginBottom: spacing.xl,
  },
});
