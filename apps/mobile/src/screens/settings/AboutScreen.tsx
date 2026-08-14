import React from 'react';
import { useTranslation } from 'react-i18next';
import PlaceholderScreen from '../../components/PlaceholderScreen';

export default function AboutScreen(): React.JSX.Element {
  const { t } = useTranslation();
  return <PlaceholderScreen title={t('profile.about')} subtitle={t('app.name')} />;
}
