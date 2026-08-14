import React from 'react';
import { useTranslation } from 'react-i18next';
import SettingsSection from '../../components/SettingsSection';

export default function LyricsSettingsScreen(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <SettingsSection
      section="lyrics"
      title={t('profile.lyrics')}
      rows={[
        { key: 'showSynced', label: t('settings.showSyncedLyrics') },
        { key: 'autoScroll', label: t('settings.lyricsAutoScroll') },
        { key: 'keepScreenOn', label: t('settings.keepScreenOn') },
      ]}
    />
  );
}
