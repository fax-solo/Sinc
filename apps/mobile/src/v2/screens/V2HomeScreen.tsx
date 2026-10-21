import { useCallback, useEffect } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { CompositeNavigationProp } from '@react-navigation/native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { CanonicalTrack } from '@sinc/shared';
import type { DailyMix, HomeSection } from '../../api/music';
import { v2Spacing } from '../theme';
import { V2Text } from '../components/V2Text';
import { V2Screen } from '../components/V2Screen';
import { V2Section, V2Rail } from '../components/V2Section';
import {
  V2TrackCard,
  V2AlbumCard,
  V2ArtistCard,
  V2PlaylistCard,
  V2MixCard,
} from '../components/V2Cards';
import { V2Artwork } from '../components/V2Artwork';
import { V2Error, V2SkeletonRail } from '../components/V2State';
import { V2SearchField } from '../components/V2Fields';
import { playerService } from '../../services/player/PlayerService';
import type { MainTabParamList, RootStackParamList } from '../../app/navigation/types';
import { useHomeFeed } from '../../features/home/useHomeFeed';
import { prefetchArtworks } from '../../api/artwork';

type HomeNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Home'>,
  NativeStackNavigationProp<RootStackParamList>
>;

function greeting(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  return 'Good evening';
}

interface SectionCallbacks {
  onPlayTracks: (tracks: CanonicalTrack[], index: number) => void;
  onOpenRecent: (tracks: CanonicalTrack[], index: number) => void;
  onPlayMix: (mix: DailyMix) => void;
  onOpenAlbum: (id: string, title?: string) => void;
  onOpenPlaylist: (id: string, name?: string) => void;
  onOpenArtist: (id: string, name?: string) => void;
}

function SectionBody({ section, cb }: { section: HomeSection; cb: SectionCallbacks }) {
  switch (section.kind) {
    case 'quick-access':
      return (
        <V2Section title={section.title}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: v2Spacing.sm }}>
            {section.playlists.slice(0, 6).map((p) => (
              <Pressable
                key={p.id}
                onPress={() => cb.onOpenPlaylist(p.id, p.name)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: v2Spacing.sm,
                  width: '48%',
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <V2Artwork uri={p.artworkUrl} size={48} />
                <V2Text variant="small" style={{ fontWeight: '700', flex: 1 }} numberOfLines={2}>
                  {p.name}
                </V2Text>
              </Pressable>
            ))}
          </View>
        </V2Section>
      );
    case 'recently-played':
      return (
        <V2Section title={section.title} subtitle="Jump back in">
          <V2Rail
            items={section.tracks}
            keyOf={(t) => t.id}
            renderItem={(t, i) => (
              <V2TrackCard track={t} onPress={() => cb.onOpenRecent(section.tracks, i)} />
            )}
          />
        </V2Section>
      );
    case 'mixes':
      return (
        <V2Section title={section.title} subtitle="Made for you">
          <V2Rail
            items={section.mixes}
            keyOf={(m) => m.id}
            renderItem={(m) => <V2MixCard mix={m} onPress={() => cb.onPlayMix(m)} />}
          />
        </V2Section>
      );
    case 'tracks':
      return (
        <V2Section title={section.title} subtitle={section.explanation}>
          <V2Rail
            items={section.tracks}
            keyOf={(t) => t.id}
            renderItem={(t, i) => (
              <V2TrackCard track={t} onPress={() => cb.onPlayTracks(section.tracks, i)} />
            )}
          />
        </V2Section>
      );
    case 'albums':
      return (
        <V2Section title={section.title} subtitle={section.explanation}>
          <V2Rail
            items={section.albums}
            keyOf={(a) => a.id}
            renderItem={(a) => (
              <V2AlbumCard album={a} onPress={() => cb.onOpenAlbum(a.id, a.title)} />
            )}
          />
        </V2Section>
      );
    case 'artists':
      return (
        <V2Section title={section.title} subtitle={section.explanation}>
          <V2Rail
            items={section.artists}
            keyOf={(a) => a.id}
            renderItem={(a) => (
              <V2ArtistCard artist={a} onPress={() => cb.onOpenArtist(a.id, a.name)} />
            )}
          />
        </V2Section>
      );
    case 'playlists':
      return (
        <V2Section title={section.title} subtitle={section.explanation}>
          <V2Rail
            items={section.playlists}
            keyOf={(p) => p.id}
            renderItem={(p) => (
              <V2PlaylistCard playlist={p} onPress={() => cb.onOpenPlaylist(p.id, p.name)} />
            )}
          />
        </V2Section>
      );
  }
}

export function V2HomeScreen() {
  const navigation = useNavigation<HomeNavigation>();
  const { home, personalized, sections } = useHomeFeed();
  const isLoading =
    (home.isLoading || (personalized.isEnabled && personalized.isLoading)) && sections.length === 0;
  const isError =
    sections.length === 0 &&
    !isLoading &&
    home.isError &&
    (!personalized.isEnabled || personalized.isError);
  const refreshing = home.isRefetching || personalized.isRefetching;

  useEffect(() => {
    if (sections.length === 0) return;
    const urls: Array<string | null | undefined> = [];
    for (const section of sections) {
      if (section.kind === 'mixes') {
        for (const mix of section.mixes) {
          urls.push(mix.artworkUrl, ...mix.tracks.slice(0, 2).map((t) => t.artworkUrl));
        }
      } else if (section.kind === 'tracks' || section.kind === 'recently-played') {
        urls.push(...section.tracks.map((t) => t.artworkUrl));
      } else if (section.kind === 'albums') {
        urls.push(...section.albums.map((a) => a.artworkUrl));
      } else if (section.kind === 'artists') {
        urls.push(...section.artists.map((a) => a.artworkUrl));
      } else {
        urls.push(...section.playlists.map((p) => p.artworkUrl));
      }
    }
    prefetchArtworks(urls);
  }, [sections]);

  const refresh = useCallback(() => {
    void home.refetch();
    void personalized.refetch();
  }, [home, personalized]);

  const playSection = useCallback(
    (tracks: CanonicalTrack[], startIndex: number) => {
      void playerService.playQueue(tracks, startIndex);
      navigation.navigate('Player');
    },
    [navigation]
  );

  const openRecent = useCallback(
    (tracks: CanonicalTrack[], index: number) => {
      const track = tracks[index];
      if (!track) return;
      if (track.id.startsWith('mix:')) {
        const mixes = personalized.data?.sections.find((s) => s.kind === 'mixes')?.mixes ?? [];
        const mix = mixes.find((m) => m.id === track.id);
        // MixScreen resolves a bare mixId via cache/network when needed.
        navigation.navigate('Mix', mix ? { mix } : { mixId: track.id });
        return;
      }
      if (track.id.startsWith('album:')) {
        navigation.navigate('Album', { id: track.id.slice(6), title: track.title });
        return;
      }
      if (track.id.startsWith('playlist:')) {
        navigation.navigate('Playlist', { id: track.id.slice(9), name: track.title });
        return;
      }
      const real = tracks.filter(
        (t) =>
          !t.id.startsWith('mix:') && !t.id.startsWith('album:') && !t.id.startsWith('playlist:')
      );
      const realIndex = real.findIndex((t) => t.id === track.id);
      if (realIndex >= 0) playSection(real, realIndex);
    },
    [navigation, personalized, playSection]
  );

  const cb: SectionCallbacks = {
    onPlayTracks: playSection,
    onOpenRecent: openRecent,
    onPlayMix: useCallback((mix: DailyMix) => navigation.navigate('Mix', { mix }), [navigation]),
    onOpenAlbum: useCallback(
      (id: string, title?: string) => navigation.navigate('Album', { id, title }),
      [navigation]
    ),
    onOpenPlaylist: useCallback(
      (id: string, name?: string) => navigation.navigate('Playlist', { id, name }),
      [navigation]
    ),
    onOpenArtist: useCallback(
      (id: string, name?: string) => navigation.navigate('Artist', { id, name }),
      [navigation]
    ),
  };

  return (
    <V2Screen padded={false} topInset>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: v2Spacing.md, paddingBottom: v2Spacing.xxxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        showsVerticalScrollIndicator={false}
      >
        <V2Text variant="display">{greeting()}</V2Text>
        <Pressable
          onPress={() => navigation.navigate('Search')}
          style={{ marginTop: v2Spacing.md, marginBottom: v2Spacing.sm }}
        >
          <View pointerEvents="none">
            <V2SearchField placeholder="Search songs, albums & artists" editable={false} />
          </View>
        </Pressable>

        {isLoading ? (
          <View style={{ marginTop: v2Spacing.xl, gap: v2Spacing.xl }}>
            <V2SkeletonRail />
            <V2SkeletonRail />
          </View>
        ) : null}

        {isError ? <V2Error message="Couldn't load your home feed." onRetry={refresh} /> : null}

        {!isLoading && !isError ? (
          <View style={{ marginTop: v2Spacing.xl, gap: v2Spacing.xxl }}>
            {sections.map((section) => (
              <SectionBody key={`${section.kind}:${section.title}`} section={section} cb={cb} />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </V2Screen>
  );
}
