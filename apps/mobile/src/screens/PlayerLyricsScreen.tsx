import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';
import { EmptyState } from '../components/ScreenState';

/** Lyrics entry point from the player; real lyrics land in M5.2. */
export default function PlayerLyricsScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  return (
    <View style={[styles.root, { backgroundColor: tokens.colors.background }]}>
      <EmptyState
        title={t('player.lyricsComingSoonTitle')}
        body={t('player.lyricsComingSoonBody')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    padding: 16,
  },
});
