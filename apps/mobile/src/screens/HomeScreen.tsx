import React from 'react';
import { useTranslation } from 'react-i18next';
import PlaceholderScreen from '../components/PlaceholderScreen';

export default function HomeScreen(): React.JSX.Element {
  const { t } = useTranslation();
  return <PlaceholderScreen title={t('tabs.home')} subtitle={t('home.forYou')} />;
}
