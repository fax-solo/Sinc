import { useCallback, useEffect } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { CompositeNavigationProp } from '@react-navigation/native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { CanonicalTrack } from '@sinc/shared';
import type { DailyMix, HomeSection } from '../../api/music';
import { AppButton } from '../../components/AppButton';
import { AppText } from '../../components/AppText';
import { SectionHeader } from '../../components/SectionHeader';
import { SearchBar } from '../../components/SearchBar';
import { TrackCard } from '../../components/TrackCard';
import { AlbumCard } from '../../components/AlbumCard';
import { ArtistCard } from '../../components/ArtistCard';
import { PlaylistCard } from '../../components/PlaylistCard';
import { useTheme } from '../../theme';
import { playerService } from '../../services/player/PlayerService';
import type { MainTabParamList, RootStackParamList } from '../../app/navigation/types';
import { useHomeFeed } from './useHomeFeed';
import { prefetchArtworks } from '../../api/artwork';

type HomeNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Home'>,
  NativeStackNavigationProp<RootStackParamList>
>;

const GREETINGS = [
  { start: 5, end: 12, label: 'Good morning' },
  { start: 12, end: 17, label: 'Good afternoon' },
  { start: 17, end: 22, label: 'Good evening' },
];

function greeting(): string {
  const hour = new Date().getHours();
  return GREETINGS.find((g) => hour >= g.start && hour < g.end)?.label ?? 'Good evening';
}

function SkeletonCard() {
  const { colors, radii } = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surfaceElevated, borderRadius: radii.md, width: 150 },
      ]}
    >
      <View style={[styles.skeletonArtwork, { borderRadius: radii.md }]} />
    </View>
  );
}

function SkeletonRow() {
  const { spacing } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
    </View>
  );
}

function MixCard({ mix, onPress }: { mix: DailyMix; onPress: () => void }) {
  const { colors, radii, spacing } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.mixCard, pressed && styles.pressed]}
    >
      <View
        style={[
          styles.mixArtwork,
          { backgroundColor: colors.surfaceElevated, borderRadius: radii.md },
        ]}
      >
        {mix.artworkUrl ? (
          <Image
            source={{ uri: mix.artworkUrl }}
            style={[styles.mixImage, { borderRadius: radii.md }]}
          />
        ) : (
          <View style={[styles.mixImage, styles.mixPlaceholder, { borderRadius: radii.md }]}>
            <AppText variant="title" color="textSecondary">
              {mix.genre.slice(0, 2).toUpperCase()}
            </AppText>
          </View>
        )}
      </View>
      <AppText variant="body" numberOfLines={1} style={{ marginTop: spacing.xs }}>
        {mix.name}
      </AppText>
      <AppText variant="small" color="textMuted" numberOfLines={1}>
        {mix.description ?? mix.genre}
      </AppText>
    </Pressable>
  );
}

interface SectionProps {
  title: string;
  explanation?: string;
  children: React.ReactNode;
}

function Section({ title, explanation, children }: SectionProps) {
  const { spacing } = useTheme();
  return (
    <View>
      <SectionHeader title={title} />
      {explanation ? (
        <AppText variant="small" color="textMuted" style={{ marginTop: spacing.xxs }}>
          {explanation}
        </AppText>
      ) : null}
      <View style={{ marginTop: spacing.md }}>{children}</View>
    </View>
  );
}

function SectionRail<T>({
  items,
  keyOf,
  renderItem,
}: {
  items: T[];
  keyOf: (item: T) => string;
  renderItem: (item: T, index: number) => React.ReactElement;
}) {
  const { spacing } = useTheme();
  return (
    <FlatList
      data={items}
      keyExtractor={keyOf}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: spacing.sm }}
      renderItem={({ item, index }) => renderItem(item, index)}
    />
  );
}

interface HomeSectionRendererProps {
  section: HomeSection;
  onPlayTracks: (tracks: CanonicalTrack[], index: number) => void;
  onOpenRecent: (tracks: CanonicalTrack[], index: number) => void;
  onPlayMix: (mix: DailyMix) => void;
  onOpenAlbum: (id: string, title?: string) => void;
  onOpenPlaylist: (id: string, name?: string) => void;
  onOpenArtist: (id: string, name?: string) => void;
}

function HomeSectionView({
  section,
  onPlayTracks,
  onOpenRecent,
  onPlayMix,
  onOpenAlbum,
  onOpenPlaylist,
  onOpenArtist,
}: HomeSectionRendererProps) {
  switch (section.kind) {
    case 'quick-access':
      return (
        <Section title={section.title}>
          <SectionRail
            items={section.playlists}
            keyOf={(p) => p.id}
            renderItem={(p) => (
              <PlaylistCard playlist={p} onPress={() => onOpenPlaylist(p.id, p.name)} />
            )}
          />
        </Section>
      );
    case 'recently-played':
      return (
        <Section title={section.title}>
          <SectionRail
            items={section.tracks}
            keyOf={(t) => t.id}
            renderItem={(t, i) => (
              <TrackCard track={t} onPress={() => onOpenRecent(section.tracks, i)} />
            )}
          />
        </Section>
      );
    case 'mixes':
      return (
        <Section title={section.title}>
          <SectionRail
            items={section.mixes}
            keyOf={(m) => m.id}
            renderItem={(m) => <MixCard mix={m} onPress={() => onPlayMix(m)} />}
          />
        </Section>
      );
    case 'tracks':
      return (
        <Section title={section.title} explanation={section.explanation}>
          <SectionRail
            items={section.tracks}
            keyOf={(t) => t.id}
            renderItem={(t, i) => (
              <TrackCard track={t} onPress={() => onPlayTracks(section.tracks, i)} />
            )}
          />
        </Section>
      );
    case 'albums':
      return (
        <Section title={section.title} explanation={section.explanation}>
          <SectionRail
            items={section.albums}
            keyOf={(a) => a.id}
            renderItem={(a) => <AlbumCard album={a} onPress={() => onOpenAlbum(a.id, a.title)} />}
          />
        </Section>
      );
    case 'artists':
      return (
        <Section title={section.title} explanation={section.explanation}>
          <SectionRail
            items={section.artists}
            keyOf={(a) => a.id}
            renderItem={(a) => <ArtistCard artist={a} onPress={() => onOpenArtist(a.id, a.name)} />}
          />
        </Section>
      );
    case 'playlists':
      return (
        <Section title={section.title} explanation={section.explanation}>
          <SectionRail
            items={section.playlists}
            keyOf={(p) => p.id}
            renderItem={(p) => (
              <PlaylistCard playlist={p} onPress={() => onOpenPlaylist(p.id, p.name)} />
            )}
          />
        </Section>
      );
  }
}

export function HomeScreen() {
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<HomeNavigation>();
  const { home, personalized, sections } = useHomeFeed();
  const isLoading = home.isLoading || (personalized.isEnabled && personalized.isLoading);
  const isError = !isLoading && home.isError && (!personalized.isEnabled || personalized.isError);
  const refreshing = home.isRefetching || personalized.isRefetching;

  // Warm the image cache for the first artworks of each section so scrolling
  // into view doesn't pop images in one by one.
  useEffect(() => {
    if (sections.length === 0) return;
    const urls: Array<string | null | undefined> = [];
    for (const section of sections) {
      if (section.kind === 'mixes') {
        for (const mix of section.mixes) {
          urls.push(mix.artworkUrl, ...mix.tracks.slice(0, 2).map((t) => t.artworkUrl));
        }
      } else if (section.kind === 'tracks') {
        urls.push(...section.tracks.map((t) => t.artworkUrl));
      } else if (section.kind === 'albums') {
        urls.push(...section.albums.map((a) => a.artworkUrl));
      } else if (section.kind === 'artists') {
        urls.push(...section.artists.map((a) => a.artworkUrl));
      } else if (section.kind === 'playlists') {
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

  const isCollectionEntry = useCallback(
    (track: CanonicalTrack) =>
      track.id.startsWith('mix:') ||
      track.id.startsWith('album:') ||
      track.id.startsWith('playlist:'),
    []
  );

  const openRecent = useCallback(
    (tracks: CanonicalTrack[], index: number) => {
      const track = tracks[index];
      if (!track) return;

      if (track.id.startsWith('mix:')) {
        const mixId = track.id;
        const mixes = personalized.data?.sections.find((s) => s.kind === 'mixes')?.mixes ?? [];
        const mix = mixes.find((m) => m.id === mixId);
        if (mix) {
          navigation.navigate('Mix', { mix });
          return;
        }
        void personalized.refetch().then(() => {
          const fresh = personalized.data?.sections.find((s) => s.kind === 'mixes')?.mixes ?? [];
          const found = fresh.find((m) => m.id === mixId);
          if (found) navigation.navigate('Mix', { mix: found });
        });
        return;
      }

      if (track.id.startsWith('album:')) {
        navigation.navigate('Album', {
          id: track.id.slice('album:'.length),
          title: track.title,
        });
        return;
      }

      if (track.id.startsWith('playlist:')) {
        navigation.navigate('Playlist', {
          id: track.id.slice('playlist:'.length),
          name: track.title,
        });
        return;
      }

      const real = tracks.filter((t) => !isCollectionEntry(t));
      const realIndex = real.findIndex((t) => t.id === track.id);
      if (realIndex >= 0) playSection(real, realIndex);
    },
    [navigation, personalized, playSection, isCollectionEntry]
  );

  const playMix = useCallback(
    (mix: DailyMix) => {
      navigation.navigate('Mix', { mix });
    },
    [navigation]
  );

  const openAlbum = useCallback(
    (id: string, title?: string) => navigation.navigate('Album', { id, title }),
    [navigation]
  );

  const openPlaylist = useCallback(
    (id: string, name?: string) => navigation.navigate('Playlist', { id, name }),
    [navigation]
  );

  const openArtist = useCallback(
    (id: string, name?: string) => navigation.navigate('Artist', { id, name }),
    [navigation]
  );

  const openSearch = useCallback(() => {
    navigation.navigate('Search');
  }, [navigation]);

  return (
    <ScrollView
      style={{ backgroundColor: colors.background, flex: 1 }}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      <AppText variant="display">{greeting()}</AppText>
      <AppText variant="body" color="textSecondary" style={{ marginTop: spacing.xxs }}>
        Discover music for you
      </AppText>

      <View style={{ marginTop: spacing.lg }}>
        <SearchBar onPress={openSearch} />
      </View>

      {isLoading ? (
        <View style={{ marginTop: spacing.xxl, gap: spacing.xl }}>
          <SkeletonRow />
          <SkeletonRow />
        </View>
      ) : null}

      {isError ? (
        <View style={{ marginTop: spacing.xxl, alignItems: 'center', gap: spacing.md }}>
          <AppText variant="body" color="error" style={{ textAlign: 'center' }}>
            Couldn't load your home feed.
          </AppText>
          <AppButton label="Retry" onPress={refresh} />
        </View>
      ) : null}

      {!isLoading && !isError && sections.length > 0 ? (
        <View style={{ marginTop: spacing.xxl, gap: spacing.xxl }}>
          {sections.map((section) => (
            <HomeSectionView
              key={`${section.kind}:${section.title}`}
              section={section}
              onPlayTracks={playSection}
              onOpenRecent={openRecent}
              onPlayMix={playMix}
              onOpenAlbum={openAlbum}
              onOpenPlaylist={openPlaylist}
              onOpenArtist={openArtist}
            />
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 32,
    paddingHorizontal: 16,
  },
  card: {
    width: 150,
  },
  skeletonArtwork: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#222',
  },
  mixCard: {
    width: 150,
  },
  mixArtwork: {
    width: 150,
    height: 150,
  },
  mixImage: {
    width: '100%',
    height: '100%',
  },
  mixPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});
