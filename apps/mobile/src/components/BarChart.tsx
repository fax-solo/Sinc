import { View, StyleSheet } from 'react-native';
import { AppText } from './AppText';
import { useTheme } from '../theme';

export function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(value);
}

export interface BarChartDatum {
  label: string;
  value: number;
}

interface BarChartProps {
  data: BarChartDatum[];
  height?: number;
  color?: string;
}

/**
 * Dependency-free bar chart (plain Views) for the admin analytics page.
 * Bars are scaled to the max value; each bar shows its compact value when
 * non-zero and the day label below (every Nth label to avoid crowding).
 */
export function BarChart({ data, height = 140, color }: BarChartProps) {
  const { colors, spacing } = useTheme();
  const max = Math.max(...data.map((d) => d.value), 1);
  const barColor = color ?? colors.accent;
  const labelStep = Math.max(1, Math.ceil(data.length / 8));

  return (
    <View style={styles.container}>
      <View style={[styles.plot, { height }]}>
        {data.map((d, i) => {
          const ratio = d.value === 0 ? 0.02 : Math.max(d.value / max, 0.04);
          return (
            <View key={i} style={[styles.barColumn, { gap: spacing.xxs }]}>
              <AppText variant="caption" color={d.value === 0 ? 'textMuted' : 'textSecondary'}>
                {d.value === 0 ? '' : formatCompact(d.value)}
              </AppText>
              <View
                style={[
                  styles.bar,
                  {
                    height: Math.round(height * 0.72 * ratio),
                    backgroundColor: d.value === 0 ? colors.surfaceElevated : barColor,
                    borderRadius: 4,
                  },
                ]}
              />
            </View>
          );
        })}
      </View>
      <View style={[styles.labels, { gap: spacing.xxs }]}>
        {data.map((d, i) => (
          <AppText
            key={i}
            variant="caption"
            color="textSecondary"
            numberOfLines={1}
            style={[styles.label, ...(i % labelStep !== 0 ? [{ color: 'transparent' }] : [])]}
          >
            {d.label}
          </AppText>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  plot: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    height: '100%',
  },
  bar: {
    width: '100%',
    maxWidth: 22,
  },
  labels: {
    flexDirection: 'row',
    marginTop: 4,
  },
  label: {
    flex: 1,
    textAlign: 'center',
  },
});
