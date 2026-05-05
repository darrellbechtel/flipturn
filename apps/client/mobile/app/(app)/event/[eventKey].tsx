import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Screen } from '../../../components/Screen.js';
import { Loading } from '../../../components/Loading.js';
import { ErrorMessage } from '../../../components/ErrorMessage.js';
import { Button } from '../../../components/Button.js';
import { ProgressionChart } from '../../../components/ProgressionChart.js';
import { colors, spacing, typography } from '../../../theme/index.js';
import { useSwims, useProgression } from '../../../api/queries.js';
import { formatSwimTime, parseEventKey } from '../../../lib/format.js';

const STROKE_LABELS: Record<string, string> = {
  FR: 'Freestyle',
  BK: 'Backstroke',
  BR: 'Breaststroke',
  FL: 'Butterfly',
  IM: 'IM',
};

export default function EventDetail() {
  const { eventKey, athleteId } = useLocalSearchParams<{
    eventKey: string;
    athleteId: string;
  }>();
  const swims = useSwims(athleteId, eventKey);
  const progression = useProgression(athleteId, eventKey);

  if (!eventKey || !athleteId) {
    return (
      <Screen>
        <ErrorMessage message="Missing event or athlete." />
        <Button label="Back" variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  const parts = parseEventKey(eventKey);
  const title = `${parts.distanceM}m ${STROKE_LABELS[parts.stroke] ?? parts.stroke} (${parts.course})`;

  return (
    <Screen scroll>
      <Text style={styles.h1}>{title}</Text>

      {progression.isLoading ? (
        <Loading />
      ) : progression.error ? (
        <ErrorMessage message={(progression.error as Error).message} />
      ) : progression.data?.points.length ? (
        <ProgressionChart points={progression.data.points} />
      ) : (
        <Text style={styles.muted}>No progression data yet.</Text>
      )}

      <Text style={styles.h2}>Swim history</Text>
      {swims.isLoading ? (
        <Loading />
      ) : swims.error ? (
        <ErrorMessage message={(swims.error as Error).message} />
      ) : (
        <FlatList
          scrollEnabled={false}
          data={swims.data?.swims ?? []}
          keyExtractor={(s) => s.id}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <Text style={styles.meet}>{item.meetName}</Text>
                <Text style={styles.date}>{new Date(item.swamAt).toLocaleDateString()}</Text>
              </View>
              <Text
                style={[styles.time, item.status !== 'OFFICIAL' ? styles.timeNonOfficial : null]}
              >
                {item.status === 'OFFICIAL' ? formatSwimTime(item.timeCentiseconds) : item.status}
              </Text>
            </View>
          )}
          ListEmptyComponent={<Text style={styles.muted}>No swims for this event yet.</Text>}
        />
      )}

      <Button
        label="Back"
        variant="secondary"
        onPress={() => router.back()}
        style={{ marginTop: spacing.xl }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  h1: { ...typography.display, color: colors.text, marginBottom: spacing.lg },
  h2: { ...typography.title, color: colors.text, marginTop: spacing.md, marginBottom: spacing.sm },
  muted: { ...typography.body, color: colors.textMuted },
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
  rowLeft: { flex: 1, gap: spacing.xs },
  meet: { ...typography.body, color: colors.text },
  date: { ...typography.caption, color: colors.textMuted },
  time: { ...typography.heading, color: colors.primary },
  timeNonOfficial: { color: colors.textMuted },
});
