import React from 'react';
import HistoryScreen from './HistoryScreen';

/** "Recently played" entry point — top of play history. */
export default function RecentlyPlayedScreen(): React.JSX.Element {
  return <HistoryScreen limit={20} />;
}
