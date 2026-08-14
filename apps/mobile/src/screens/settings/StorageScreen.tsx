import React from 'react';
import { useTranslation } from 'react-i18next';
import PlaceholderScreen from '../../components/PlaceholderScreen';

export default function StorageScreen(): React.JSX.Element {
  const { t } = useTranslation();
  return <PlaceholderScreen title={t('profile.storage')} subtitle={t('common.empty')} />;
}
