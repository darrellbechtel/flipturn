import { SafeAreaView, ScrollView, StyleSheet, View, type ViewProps } from 'react-native';
import { colors, spacing } from '../theme/index.js';

interface ScreenProps extends ViewProps {
  readonly scroll?: boolean;
}

export function Screen({ scroll, style, children, ...rest }: ScreenProps) {
  const Container = scroll ? ScrollView : View;
  return (
    <SafeAreaView style={styles.safe}>
      <Container style={[styles.container, style]} {...rest}>
        {children}
      </Container>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, padding: spacing.lg },
});
