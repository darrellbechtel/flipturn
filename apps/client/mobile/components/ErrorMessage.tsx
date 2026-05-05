import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '../theme/index.js';

export function ErrorMessage({ message }: { message: string }) {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FEE2E2',
    borderRadius: 8,
    padding: spacing.md,
    marginVertical: spacing.sm,
  },
  text: { ...typography.body, color: colors.danger },
});
