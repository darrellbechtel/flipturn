import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';
import { colors, spacing, typography } from '../theme/index.js';
import { formatSwimTime } from '../lib/format.js';

interface Point {
  readonly date: string;
  readonly timeCentiseconds: number;
}

interface ProgressionChartProps {
  readonly points: readonly Point[];
  readonly height?: number;
}

export function ProgressionChart({ points, height = 200 }: ProgressionChartProps) {
  if (points.length === 0) {
    return null;
  }

  // Layout
  const padding = { top: 12, right: 16, bottom: 28, left: 56 };
  const width = 320; // SVG viewport; scaled by SafeAreaView container
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  // Domains: x = time, y = swim time (ascending = slower; faster on top)
  const xs = points.map((p) => new Date(p.date).getTime());
  const ys = points.map((p) => p.timeCentiseconds);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  // Pad y-domain a bit so dots aren't on the axes.
  const yPad = (yMax - yMin) * 0.1 || yMin * 0.05;
  const yLo = yMin - yPad;
  const yHi = yMax + yPad;

  function xPx(t: number): number {
    if (xMax === xMin) return padding.left + innerW / 2;
    return padding.left + ((t - xMin) / (xMax - xMin)) * innerW;
  }
  function yPx(v: number): number {
    if (yHi === yLo) return padding.top + innerH / 2;
    // Faster (smaller) at the top.
    return padding.top + ((v - yLo) / (yHi - yLo)) * innerH;
  }

  const polylinePts = points
    .slice()
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .map((p) => `${xPx(new Date(p.date).getTime())},${yPx(p.timeCentiseconds)}`)
    .join(' ');

  const fastest = Math.min(...ys);
  const slowest = Math.max(...ys);

  return (
    <View style={styles.container}>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        {/* y-axis labels (fastest on top, slowest on bottom) */}
        <SvgText
          x={padding.left - 8}
          y={padding.top + 8}
          fontSize={10}
          fill={colors.textMuted}
          textAnchor="end"
        >
          {formatSwimTime(fastest)}
        </SvgText>
        <SvgText
          x={padding.left - 8}
          y={padding.top + innerH}
          fontSize={10}
          fill={colors.textMuted}
          textAnchor="end"
        >
          {formatSwimTime(slowest)}
        </SvgText>

        {/* x-axis baseline */}
        <Line
          x1={padding.left}
          x2={padding.left + innerW}
          y1={padding.top + innerH}
          y2={padding.top + innerH}
          stroke={colors.border}
          strokeWidth={1}
        />

        {/* connecting line */}
        <Polyline points={polylinePts} stroke={colors.primary} strokeWidth={2} fill="none" />

        {/* points */}
        {points.map((p, i) => (
          <Circle
            key={i}
            cx={xPx(new Date(p.date).getTime())}
            cy={yPx(p.timeCentiseconds)}
            r={4}
            fill={colors.primary}
            stroke={colors.surface}
            strokeWidth={1.5}
          />
        ))}

        {/* x-axis labels */}
        <SvgText
          x={padding.left}
          y={padding.top + innerH + 16}
          fontSize={10}
          fill={colors.textMuted}
          textAnchor="start"
        >
          {new Date(xMin).toLocaleDateString()}
        </SvgText>
        <SvgText
          x={padding.left + innerW}
          y={padding.top + innerH + 16}
          fontSize={10}
          fill={colors.textMuted}
          textAnchor="end"
        >
          {new Date(xMax).toLocaleDateString()}
        </SvgText>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    marginBottom: spacing.lg,
  },
});

// Suppress unused warning for typography; kept for potential future axis labels.
void typography;
