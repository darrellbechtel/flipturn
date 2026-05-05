import { useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../../components/Screen.js';
import { Loading } from '../../components/Loading.js';
import { ErrorMessage } from '../../components/ErrorMessage.js';
import { Button } from '../../components/Button.js';
import { PBListItem } from '../../components/PBListItem.js';
import { colors, spacing, typography } from '../../theme/index.js';
import { useAthletes, usePersonalBests } from '../../api/queries.js';
import { useAuth } from '../../auth/AuthProvider.js';
import { parseEventKey } from '../../lib/format.js';

const STROKE_ORDER = ['FR', 'BK', 'BR', 'FL', 'IM'];

export default function Home() {
  const { signOut } = useAuth();
  const athletes = useAthletes();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Default selection: first athlete with at least one scrape.
  const list = athletes.data?.athletes ?? [];
  const activeId = selectedId ?? list[0]?.id ?? null;
  const active = list.find((a) => a.id === activeId);

  const pbs = usePersonalBests(activeId ?? undefined);

  if (athletes.isLoading) return <Loading message="Loading athletes…" />;
  if (athletes.error)
    return (
      <Screen>
        <ErrorMessage message={(athletes.error as Error).message} />
      </Screen>
    );

  if (list.length === 0) {
    return (
      <Screen>
        <Text style={styles.h1}>No athletes yet</Text>
        <Text style={styles.body}>Add a swimmer to get started.</Text>
        <Button
          label="Add swimmer"
          onPress={() => router.push('/(app)/onboarding')}
          style={{ marginTop: spacing.lg }}
        />
        <Button
          label="Sign out"
          variant="secondary"
          onPress={signOut}
          style={{ marginTop: spacing.md }}
        />
      </Screen>
    );
  }

  const groups = groupPBsByStroke(pbs.data?.personalBests ?? []);

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.h1}>{active?.primaryName ?? 'Athlete'}</Text>
        {list.length > 1 ? (
          <View style={styles.switcher}>
            {list.map((a) => (
              <Button
                key={a.id}
                label={a.primaryName}
                variant={a.id === activeId ? 'primary' : 'secondary'}
                onPress={() => setSelectedId(a.id)}
                style={{ marginRight: spacing.sm }}
              />
            ))}
          </View>
        ) : null}
        <Button
          label="Add swimmer"
          variant="secondary"
          onPress={() => router.push('/(app)/onboarding')}
          style={{ marginTop: spacing.md }}
        />
      </View>

      {active && !active.lastScrapedAt ? (
        <View style={styles.pendingBox}>
          <Text style={styles.pendingTitle}>Fetching swims…</Text>
          <Text style={styles.body}>
            We're pulling {active.primaryName}'s history from results.swimming.ca. This usually
            takes a minute or two.
          </Text>
        </View>
      ) : null}

      {pbs.isLoading ? <Loading /> : null}
      {pbs.error ? <ErrorMessage message={(pbs.error as Error).message} /> : null}

      {groups.map(([stroke, items]) => (
        <View key={stroke} style={styles.group}>
          <Text style={styles.groupTitle}>{stroke}</Text>
          <FlatList
            scrollEnabled={false}
            data={items}
            keyExtractor={(p) => p.eventKey}
            renderItem={({ item }) => (
              <PBListItem
                athleteId={activeId!}
                eventKey={item.eventKey}
                timeCentiseconds={item.timeCentiseconds}
                achievedAt={item.achievedAt}
              />
            )}
          />
        </View>
      ))}

      <Button
        label="Sign out"
        variant="secondary"
        onPress={signOut}
        style={{ marginTop: spacing.xl }}
      />
    </Screen>
  );
}

interface PB {
  readonly eventKey: string;
  readonly timeCentiseconds: number;
  readonly achievedAt: string;
}

function groupPBsByStroke(pbs: readonly PB[]): Array<[string, PB[]]> {
  const map = new Map<string, PB[]>();
  for (const pb of pbs) {
    const stroke = parseEventKey(pb.eventKey).stroke;
    const arr = map.get(stroke) ?? [];
    arr.push(pb);
    map.set(stroke, arr);
  }
  // Sort each group by distance asc.
  for (const arr of map.values()) {
    arr.sort((a, b) => parseEventKey(a.eventKey).distanceM - parseEventKey(b.eventKey).distanceM);
  }
  // Order groups by stroke conventional order.
  return STROKE_ORDER.filter((s) => map.has(s)).map((s) => [s, map.get(s)!]);
}

const styles = StyleSheet.create({
  header: { marginBottom: spacing.lg },
  h1: { ...typography.display, color: colors.text },
  body: { ...typography.body, color: colors.text },
  switcher: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.md },
  pendingBox: {
    backgroundColor: colors.gray100,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  pendingTitle: { ...typography.heading, color: colors.text },
  group: { marginBottom: spacing.lg, gap: spacing.sm },
  groupTitle: { ...typography.heading, color: colors.textMuted },
});
