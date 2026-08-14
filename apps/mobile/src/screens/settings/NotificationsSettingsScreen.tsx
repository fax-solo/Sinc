import React from 'react';
import { useTranslation } from 'react-i18next';
import SettingsSection from '../../components/SettingsSection';

export default function NotificationsSettingsScreen(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <SettingsSection
      section="notifications"
      title={t('profile.notifications')}
      rows={[
        { key: 'downloads', label: t('settings.notifyDownloads') },
        { key: 'recommendations', label: t('settings.notifyRecommendations') },
        { key: 'account', label: t('settings.notifyAccount') },
        { key: 'updates', label: t('settings.notifyUpdates') },
        { key: 'security', label: t('settings.notifySecurity') },
      ]}
    />
  );
}
