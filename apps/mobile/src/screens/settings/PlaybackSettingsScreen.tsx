import React from 'react';
import { useTranslation } from 'react-i18next';
import SettingsSection from '../../components/SettingsSection';

export default function PlaybackSettingsScreen(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <SettingsSection
      section="playback"
      title={t('profile.playback')}
      rows={[
        { key: 'autoplay', label: t('settings.autoplay') },
        { key: 'shuffle', label: t('settings.shuffle') },
        { key: 'volumeNormalization', label: t('settings.volumeNormalization') },
        { key: 'rememberPosition', label: t('settings.rememberPosition') },
      ]}
    />
  );
}
