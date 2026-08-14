import React, { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { usersApi } from '../api/users';

export interface ToggleRow {
  key: string;
  label: string;
  value?: boolean;
}

interface SettingsSectionProps {
  section: string;
  title: string;
  rows: ToggleRow[];
  onChanged?: (section: string, patch: Record<string, unknown>) => void;
}

/**
 * Renders a settings section as a list of switches, loading the current
 * values from the API and persisting changes as they are toggled. Falls
 * back to local state when the network is unavailable.
 */
export default function SettingsSection({
  section,
  title,
  rows,
  onChanged,
}: SettingsSectionProps): React.JSX.Element {
  const { tokens } = useTheme();
  const [values, setValues] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const row of rows) {
      initial[row.key] = row.value ?? false;
    }
    return initial;
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void usersApi
      .getSettings()
      .then(({ settings }: { settings: Record<string, Record<string, unknown>> }) => {
        if (cancelled) return;
        const sectionValues = settings[section] as Record<string, unknown> | undefined;
        if (!sectionValues) return;
        const next: Record<string, boolean> = { ...values };
        for (const row of rows) {
          const v = sectionValues[row.key];
          if (typeof v === 'boolean') next[row.key] = v;
        }
        setValues(next);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  const toggle = async (key: string, value: boolean) => {
    const next = { ...values, [key]: value };
    setValues(next);
    onChanged?.(section, { [key]: value });
    try {
      await usersApi.updateSettings({ [section]: { [key]: value } });
    } catch {
      // Keep local state; the change will be re-synced later.
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: tokens.colors.background }]}>
      <Text style={[tokens.typography.title1, { color: tokens.colors.onBackground }]}>{title}</Text>
      {rows.map((row) => (
        <View
          key={row.key}
          style={[styles.row, { backgroundColor: tokens.colors.surfaceContainer }]}
        >
          <Text style={[tokens.typography.body, { color: tokens.colors.onSurface }]}>
            {row.label}
          </Text>
          <Switch
            value={values[row.key] ?? false}
            onValueChange={(v) => void toggle(row.key, v)}
            disabled={!loaded}
            trackColor={{ true: tokens.colors.primary, false: tokens.colors.outlineVariant }}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    padding: 20,
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
});
