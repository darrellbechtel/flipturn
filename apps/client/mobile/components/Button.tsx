import { ActivityIndicator, Pressable, StyleSheet, Text, type PressableProps } from 'react-native';
import { colors, spacing, typography } from '../theme/index.js';

interface ButtonProps extends Omit<PressableProps, 'children'> {
  readonly label: string;
  readonly variant?: 'primary' | 'secondary' | 'danger';
  readonly loading?: boolean;
}

export function Button({
  label,
  variant = 'primary',
  loading = false,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const variantStyles = STYLES_BY_VARIANT[variant];
  const isDisabled = disabled || loading;
  return (
    <Pressable
      {...rest}
      disabled={isDisabled}
      style={(state) => [
        styles.base,
        variantStyles.container,
        isDisabled ? styles.disabled : null,
        state.pressed ? styles.pressed : null,
        typeof style === 'function' ? style(state) : style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variantStyles.text.color as string} />
      ) : (
        <Text style={[styles.text, variantStyles.text]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  text: { ...typography.label },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
});

const STYLES_BY_VARIANT = {
  primary: StyleSheet.create({
    container: { backgroundColor: colors.primary },
    text: { color: colors.primaryText },
  }),
  secondary: StyleSheet.create({
    container: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    text: { color: colors.text },
  }),
  danger: StyleSheet.create({
    container: { backgroundColor: colors.danger },
    text: { color: colors.primaryText },
  }),
};
