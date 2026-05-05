import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { colors, spacing, typography } from '../theme/index.js';
import { formatSwimTime, parseEventKey } from '../lib/format.js';

interface PBListItemProps {
  readonly athleteId: string;
  readonly eventKey: string;
  readonly timeCentiseconds: number;
  readonly achievedAt: string;
}

const STROKE_LABELS: Record<string, string> = {
  FR: 'Freestyle',
  BK: 'Backstroke',
  BR: 'Breaststroke',
  FL: 'Butterfly',
  IM: 'IM',
};

export function PBListItem({ athleteId, eventKey, timeCentiseconds, achievedAt }: PBListItemProps) {
  const parts = parseEventKey(eventKey);
  const label = `${parts.distanceM}m ${STROKE_LABELS[parts.stroke] ?? parts.stroke} (${parts.course})`;
  const date = new Date(achievedAt).toLocaleDateString();
  return (
    <Pressable
      onPress={() =>
        router.push({ pathname: '/(app)/event/[eventKey]', params: { eventKey, athleteId } })
      }
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
    >
      <View style={styles.left}>
        <Text style={styles.event}>{label}</Text>
        <Text style={styles.date}>{date}</Text>
      </View>
      <Text style={styles.time}>{formatSwimTime(timeCentiseconds)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  pressed: { opacity: 0.7 },
  left: { flex: 1, gap: spacing.xs },
  event: { ...typography.heading, color: colors.text },
  date: { ...typography.caption, color: colors.textMuted },
  time: { ...typography.title, color: colors.primary },
});
