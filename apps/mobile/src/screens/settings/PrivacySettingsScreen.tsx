import React from 'react';
import { useTranslation } from 'react-i18next';
import SettingsSection from '../../components/SettingsSection';

export default function PrivacySettingsScreen(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <SettingsSection
      section="privacy"
      title={t('profile.privacy')}
      rows={[
        { key: 'analytics', label: t('settings.privacyAnalytics') },
        { key: 'history', label: t('settings.privacyHistory') },
        { key: 'personalizedRecommendations', label: t('settings.privacyRecommendations') },
      ]}
    />
  );
}
