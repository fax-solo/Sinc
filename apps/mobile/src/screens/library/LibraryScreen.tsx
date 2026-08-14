import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { getDatabase } from '../../db/database';
import { searchLibrary } from '../../db/repositories';
import { useTheme } from '../../theme/ThemeProvider';
import SearchBar from '../../components/SearchBar';
import SimpleRow from '../../components/SimpleRow';
import SectionHeader from '../../components/SectionHeader';
import { EmptyState } from '../../components/ScreenState';
import TrackRow from '../../components/TrackRow';
import { toCanonicalTrack } from '../../db/adapters';
import type { CanonicalTrack } from '@sinc/shared';
import type { LibraryTabParamList } from '../../navigation/types';

interface SearchResult {
  tracks: CanonicalTrack[];
  artists: Array<{ id: string; providerId: string | null; name: string; title: string }>;
  albums: Array<{ id: string; providerId: string | null; title: string; artist: string }>;
}

/**
 * Library home: entry points into each collection plus a cross-library
 * local search (tracks, artists, albums).
 */
export default function LibraryScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<LibraryTabParamList>>();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<{ q: string; data: SearchResult } | null>(null);
  const searching = query.trim().length > 0;
  const data = result && result.q === query ? result.data : null;

  useEffect(() => {
    if (!searching) return;
    let mounted = true;
    void searchLibrary(getDatabase(), query).then((found) => {
      if (!mounted) return;
      setResult({
        q: query,
        data: {
          tracks: found.tracks.map((track) => toCanonicalTrack(track)),
          artists: found.artists.map((artist) => ({
            id: artist.id,
            providerId: artist.providerId,
            name: artist.name,
            title: artist.name,
          })),
          albums: found.albums.map((album) => ({
            id: album.id,
            providerId: album.providerId,
            title: album.title,
            artist: album.artistId ?? '',
          })),
        },
      });
    });
    return () => {
      mounted = false;
    };
  }, [query, searching]);

  const hasResults =
    (data?.tracks.length ?? 0) > 0 ||
    (data?.artists.length ?? 0) > 0 ||
    (data?.albums.length ?? 0) > 0;

  const sections: Array<{ key: string; label: string; onPress: () => void }> = [
    { key: 'tracks', label: t('library.tracks'), onPress: () => navigation.navigate('Tracks') },
    { key: 'artists', label: t('library.artists'), onPress: () => navigation.navigate('Artists') },
    { key: 'albums', label: t('library.albums'), onPress: () => navigation.navigate('Albums') },
    {
      key: 'playlists',
      label: t('library.playlists'),
      onPress: () => navigation.navigate('Playlists'),
    },
    {
      key: 'favorites',
      label: t('library.favorites'),
      onPress: () => navigation.navigate('Favorites'),
    },
    {
      key: 'recent',
      label: t('library.recent'),
      onPress: () => navigation.navigate('RecentlyPlayed'),
    },
    { key: 'history', label: t('library.history'), onPress: () => navigation.navigate('History') },
    {
      key: 'downloads',
      label: t('library.downloads'),
      onPress: () => navigation.navigate('RecentlyDownloaded'),
    },
  ];

  return (
    <View style={[styles.root, { backgroundColor: tokens.colors.background }]}>
      <SearchBar
        value={query}
        onChangeText={setQuery}
        placeholder={t('library.searchPlaceholder')}
      />
      {searching ? (
        data ? (
          hasResults ? (
            <ScrollView>
              {data.tracks.length > 0 ? <SectionHeader>{t('library.tracks')}</SectionHeader> : null}
              {data.tracks.map((track) => {
                const mbId = track.providerIds.musicbrainz;
                return (
                  <TrackRow
                    key={track.id}
                    track={track}
                    onPress={
                      mbId ? () => navigation.navigate('SongDetails', { trackId: mbId }) : undefined
                    }
                  />
                );
              })}
              {data.artists.length > 0 ? (
                <SectionHeader>{t('library.artists')}</SectionHeader>
              ) : null}
              {data.artists.map((artist) => (
                <SimpleRow
                  key={artist.id}
                  title={artist.name}
                  onPress={
                    artist.providerId
                      ? () => navigation.navigate('ArtistDetails', { artistId: artist.providerId! })
                      : undefined
                  }
                />
              ))}
              {data.albums.length > 0 ? <SectionHeader>{t('library.albums')}</SectionHeader> : null}
              {data.albums.map((album) => (
                <SimpleRow
                  key={album.id}
                  title={album.title}
                  subtitle={album.artist}
                  onPress={
                    album.providerId
                      ? () => navigation.navigate('AlbumDetails', { albumId: album.providerId! })
                      : undefined
                  }
                />
              ))}
            </ScrollView>
          ) : (
            <View style={styles.center}>
              <EmptyState title={t('library.searchNoResults')} />
            </View>
          )
        ) : null
      ) : (
        <ScrollView>
          {sections.map((section) => (
            <SimpleRow
              key={section.key}
              title={section.label}
              monogram={section.label}
              onPress={section.onPress}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    padding: 16,
    gap: 12,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
  },
});
