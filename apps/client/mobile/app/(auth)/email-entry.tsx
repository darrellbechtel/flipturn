import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { Screen } from '../../components/Screen.js';
import { Button } from '../../components/Button.js';
import { TextField } from '../../components/TextField.js';
import { ErrorMessage } from '../../components/ErrorMessage.js';
import { colors, spacing, typography } from '../../theme/index.js';
import { requestMagicLink } from '../../api/auth.js';

export default function EmailEntry() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const mutation = useMutation({
    mutationFn: (e: string) => requestMagicLink(e),
    onSuccess: () => setSubmitted(true),
  });

  if (submitted) {
    return (
      <Screen>
        <Text style={styles.title}>Check your email</Text>
        <Text style={styles.body}>
          We sent a sign-in link to {email}. Tap the link to open the app.
        </Text>
        <Button
          label="Send another"
          variant="secondary"
          onPress={() => {
            setSubmitted(false);
            mutation.reset();
          }}
          style={{ marginTop: spacing.lg }}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={styles.title}>Sign in to Flip Turn</Text>
      <Text style={styles.subtitle}>We'll email you a link. No password needed.</Text>
      <TextField
        label="Email"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        placeholder="parent@example.com"
        value={email}
        onChangeText={setEmail}
      />
      {mutation.error ? (
        <ErrorMessage message={(mutation.error as Error).message ?? 'Something went wrong.'} />
      ) : null}
      <Button
        label="Send sign-in link"
        loading={mutation.isPending}
        disabled={!email.trim()}
        onPress={() => mutation.mutate(email.trim())}
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
  body: { ...typography.body, color: colors.text },
});
