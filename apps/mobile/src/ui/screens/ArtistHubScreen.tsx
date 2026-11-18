import { useMemo, useState } from 'react';
import {
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import Ionicons from '@react-native-vector-icons/ionicons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { CanonicalAlbum } from '@sinc/shared';
import { Text } from '../components/Text';
import { IconButton, PrimaryButton } from '../components/Buttons';
import { FilterChip } from '../components/Fields';
import { SongRow } from '../components/SongRow';
import { MediaCard, ArtistCard, SectionRail } from '../components/Cards';
import { SectionHeader } from '../components/Screen';
import { ErrorState, ListSkeleton } from '../components/State';
import { toast } from '../components/Overlays';
import { colors, radii, spacing } from '../theme';
import { musicApi } from '../../api/music';
import { useLibraryStore } from '../../services/library/libraryStore';
import { useDownloadsStore } from '../../services/library/downloadsStore';
import { queueTracksForDownload } from '../../services/library/downloadQueue';
import { selectCurrentTrack, usePlayerStore } from '../../services/player/playerStore';
import { playerService } from '../../services/player/PlayerService';
import { openSongMenu } from '../songMenu/songMenuStore';
import { shareEntity } from '../../utils/share';
import { shuffled } from '../../services/local/affinity';
import { openSpotifyUrl } from '../../services/providers/spotifyUrl';
import { useTrackSelection } from '../selection/useTrackSelection';
import { TrackSelectionFooter } from '../selection/TrackSelectionFooter';
import type { RootStackParamList } from '../../app/navigation/types';

type DiscographyTab = 'all' | 'albums' | 'singles' | 'compilations';
type DiscographySort = 'newest' | 'oldest' | 'az';

function formatNumber(num?: number): string {
  if (num === undefined || num === null) return '';
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString();
}

export function ArtistHubScreen({
  route,
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'Artist'>) {
  const insets = useSafeAreaInsets();
  const { id } = route.params;

  const query = useQuery({
    queryKey: ['artist-hub-v2', id],
    queryFn: () => musicApi.getArtistDetail(id, route.params.name),
    enabled: Boolean(id),
    staleTime: 5 * 60 * 1000,
  });

  const followedArtists = useLibraryStore((state) => state.followedArtists);
  const toggleFollowArtist = useLibraryStore((state) => state.toggleFollowArtist);
  const downloads = useDownloadsStore((state) => state.downloads);
  const currentTrack = usePlayerStore(selectCurrentTrack);
  const playing = usePlayerStore((state) => state.status === 'playing');

  const [downloadBusy, setDownloadBusy] = useState(false);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [showAllTracks, setShowAllTracks] = useState(false);
  const [activeTab, setActiveTab] = useState<DiscographyTab>('all');
  const [sortOrder, setSortOrder] = useState<DiscographySort>('newest');

  const selection = useTrackSelection();

  const downloadedIds = useMemo(
    () =>
      new Set(
        downloads
          .filter((d) => d.phase === 'completed' && d.localUri)
          .map((d) => d.track.id)
      ),
    [downloads]
  );

  const detail = query.data;
  const artist = detail?.artist;
  const isFollowed = artist ? followedArtists.some((item) => item.id === artist.id || item.name.toLowerCase() === artist.name.toLowerCase()) : false;
  const tracks = detail?.topTracks ?? [];

  const displayedTracks = showAllTracks ? tracks : tracks.slice(0, 5);

  const playQueue = (index: number, shuffle = false) => {
    if (tracks.length === 0) return;
    const queue = shuffle ? shuffled(tracks, Math.random) : tracks;
    void playerService.playQueue(queue, shuffle ? 0 : index);
    navigation.navigate('Player');
  };

  const downloadPopular = async () => {
    if (tracks.length === 0) return;
    setDownloadBusy(true);
    const result = await queueTracksForDownload(tracks);
    setDownloadBusy(false);
    toast(
      result.queued > 0
        ? `Downloading ${result.queued} popular song${result.queued === 1 ? '' : 's'}`
        : 'All popular songs are already downloaded',
      result.queued > 0 ? 'success' : 'default'
    );
  };

  // Discography filtering and sorting
  const discographyItems = useMemo(() => {
    if (!detail) return [];
    let pool: CanonicalAlbum[] = [];
    if (activeTab === 'all') {
      pool = [
        ...detail.discography.albums,
        ...detail.discography.singles,
        ...detail.discography.eps,
        ...detail.discography.compilations,
      ];
    } else if (activeTab === 'albums') {
      pool = detail.discography.albums;
    } else if (activeTab === 'singles') {
      pool = [...detail.discography.singles, ...detail.discography.eps];
    } else if (activeTab === 'compilations') {
      pool = detail.discography.compilations;
    }

    const uniqueMap = new Map<string, CanonicalAlbum>();
    for (const alb of pool) {
      if (!uniqueMap.has(alb.id)) uniqueMap.set(alb.id, alb);
    }
    const list = Array.from(uniqueMap.values());

    return list.sort((a, b) => {
      if (sortOrder === 'az') return a.title.localeCompare(b.title);
      const dateA = a.releaseDate ?? '';
      const dateB = b.releaseDate ?? '';
      if (sortOrder === 'oldest') return dateA.localeCompare(dateB);
      return dateB.localeCompare(dateA); // newest
    });
  }, [detail, activeTab, sortOrder]);

  if (query.isLoading) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.topBar}>
          <IconButton
            icon="chevron-back"
            label="Back"
            size={40}
            background="rgba(255,255,255,0.08)"
            onPress={() => navigation.goBack()}
          />
        </View>
        <View style={{ padding: spacing.lg }}>
          <ListSkeleton rows={8} />
        </View>
      </View>
    );
  }

  if (query.isError || !detail) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.topBar}>
          <IconButton
            icon="chevron-back"
            label="Back"
            size={40}
            background="rgba(255,255,255,0.08)"
            onPress={() => navigation.goBack()}
          />
        </View>
        <ErrorState
          title="Artist unavailable"
          message={query.error instanceof Error ? query.error.message : 'Could not load artist profile.'}
          onRetry={() => void query.refetch()}
        />
      </View>
    );
  }

  const stats = detail.statistics;
  const links = detail.externalLinks;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 90 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero Section */}
        <View style={styles.heroContainer}>
          {artist?.artworkUrl ? (
            <Image source={{ uri: artist.artworkUrl }} style={styles.heroImage} resizeMode="cover" />
          ) : (
            <View style={[styles.heroImage, styles.heroFallback]} />
          )}
          <View style={styles.heroGradientOverlay} />

          {/* Top navigation row */}
          <View style={[styles.topBar, { top: insets.top }]}>
            <IconButton
              icon="chevron-back"
              label="Back"
              size={40}
              background="rgba(0,0,0,0.5)"
              onPress={() => navigation.goBack()}
            />
            <IconButton
              icon="share-outline"
              label="Share artist"
              size={40}
              background="rgba(0,0,0,0.5)"
              onPress={() =>
                void shareEntity({
                  type: 'artist',
                  id: artist?.id ?? id,
                  title: artist?.name ?? 'Artist',
                })
              }
            />
          </View>

          {/* Artist identity header */}
          <View style={styles.heroContent}>
            {detail.isVerified ? (
              <View style={styles.verifiedRow}>
                <Ionicons name="checkmark-circle" size={16} color={colors.accent} />
                <Text variant="small" style={{ color: colors.accent, fontWeight: '700' }}>
                  VERIFIED ARTIST
                </Text>
              </View>
            ) : null}

            <Text variant="display" style={styles.artistName} numberOfLines={2}>
              {artist?.name ?? route.params.name ?? 'Artist'}
            </Text>

            {detail.country || (artist?.genres && artist.genres.length > 0) ? (
              <View style={styles.metaRow}>
                {detail.country ? (
                  <Text variant="small" style={styles.originText}>
                    {detail.country}
                  </Text>
                ) : null}
                {detail.country && artist?.genres.length ? (
                  <Text variant="small" style={styles.metaSeparator}>
                    ·
                  </Text>
                ) : null}
                {artist?.genres.slice(0, 3).map((g) => (
                  <Text key={g} variant="small" style={styles.genreText}>
                    {g}
                  </Text>
                ))}
              </View>
            ) : null}
          </View>
        </View>

        {/* Action Controls & Follow */}
        <View style={styles.actionStrip}>
          <Pressable
            style={[styles.followButton, isFollowed ? styles.followedButton : styles.unfollowedButton]}
            onPress={() => {
              if (!artist) return;
              toggleFollowArtist(artist);
              toast(isFollowed ? 'Artist unfollowed' : 'Artist followed', 'success');
            }}
            accessibilityRole="button"
            accessibilityLabel={isFollowed ? 'Unfollow artist' : 'Follow artist'}
          >
            <Ionicons
              name={isFollowed ? 'heart' : 'heart-outline'}
              size={18}
              color={isFollowed ? colors.accent : colors.text}
            />
            <Text variant="bodyStrong" style={{ color: isFollowed ? colors.accent : colors.text }}>
              {isFollowed ? 'Following' : 'Follow'}
            </Text>
          </Pressable>

          <View style={styles.playbackButtons}>
            <IconButton
              icon="shuffle"
              label="Shuffle popular"
              size={46}
              background="rgba(255,255,255,0.08)"
              onPress={() => playQueue(0, true)}
              disabled={tracks.length === 0}
            />
            <IconButton
              icon="play"
              label="Play popular"
              size={52}
              background={colors.accent}
              color="#ffffff"
              onPress={() => playQueue(0, false)}
              disabled={tracks.length === 0}
            />
          </View>
        </View>

        {/* Statistics Bar */}
        {(stats.deezerFans || stats.albumCount || stats.lastFmListeners) ? (
          <View style={styles.statsContainer}>
            {stats.deezerFans ? (
              <View style={styles.statBox}>
                <Text variant="title" style={styles.statValue}>
                  {formatNumber(stats.deezerFans)}
                </Text>
                <Text variant="small" style={styles.statLabel}>
                  Fans · Deezer
                </Text>
              </View>
            ) : null}

            {stats.albumCount ? (
              <View style={styles.statBox}>
                <Text variant="title" style={styles.statValue}>
                  {stats.albumCount}
                </Text>
                <Text variant="small" style={styles.statLabel}>
                  Releases
                </Text>
              </View>
            ) : null}

            {stats.lastFmListeners ? (
              <View style={styles.statBox}>
                <Text variant="title" style={styles.statValue}>
                  {formatNumber(stats.lastFmListeners)}
                </Text>
                <Text variant="small" style={styles.statLabel}>
                  Listeners · Last.fm
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Biography */}
        {detail.biography ? (
          <View style={styles.bioCard}>
            <Text variant="bodyStrong" style={{ marginBottom: spacing.xs }}>
              About
            </Text>
            <Text
              variant="body"
              numberOfLines={bioExpanded ? undefined : 3}
              style={{ color: colors.textSecondary, lineHeight: 21 }}
            >
              {detail.biography}
            </Text>
            <Pressable
              onPress={() => setBioExpanded((prev) => !prev)}
              style={{ alignSelf: 'flex-start', marginTop: spacing.xs }}
              accessibilityRole="button"
            >
              <Text variant="small" style={{ color: colors.accent, fontWeight: '700' }}>
                {bioExpanded ? 'Show less' : 'Read more'}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/* External Profile Links */}
        {Object.values(links).some(Boolean) ? (
          <View style={styles.linksRow}>
            {links.spotify ? (
              <Pressable
                onPress={() => void openSpotifyUrl(links.spotify!)}
                style={styles.linkPill}
                accessibilityRole="button"
                accessibilityLabel="Open in Spotify"
              >
                <Ionicons name="musical-notes" size={14} color="#1DB954" />
                <Text variant="small" style={{ color: colors.text, fontWeight: '600' }}>
                  Spotify
                </Text>
              </Pressable>
            ) : null}

            {links.deezer ? (
              <Pressable
                onPress={() => void Linking.openURL(links.deezer!)}
                style={styles.linkPill}
                accessibilityRole="button"
                accessibilityLabel="Open in Deezer"
              >
                <Ionicons name="disc" size={14} color="#EF5466" />
                <Text variant="small" style={{ color: colors.text, fontWeight: '600' }}>
                  Deezer
                </Text>
              </Pressable>
            ) : null}

            {links.musicbrainz ? (
              <Pressable
                onPress={() => void Linking.openURL(links.musicbrainz!)}
                style={styles.linkPill}
                accessibilityRole="button"
                accessibilityLabel="Open in MusicBrainz"
              >
                <Ionicons name="book-outline" size={14} color="#BA478F" />
                <Text variant="small" style={{ color: colors.text, fontWeight: '600' }}>
                  MusicBrainz
                </Text>
              </Pressable>
            ) : null}

            {links.lastfm ? (
              <Pressable
                onPress={() => void Linking.openURL(links.lastfm!)}
                style={styles.linkPill}
                accessibilityRole="button"
                accessibilityLabel="Open in Last.fm"
              >
                <Ionicons name="radio-outline" size={14} color="#D51007" />
                <Text variant="small" style={{ color: colors.text, fontWeight: '600' }}>
                  Last.fm
                </Text>
              </Pressable>
            ) : null}

            {links.homepage ? (
              <Pressable
                onPress={() => void Linking.openURL(links.homepage!)}
                style={styles.linkPill}
                accessibilityRole="button"
                accessibilityLabel="Open official website"
              >
                <Ionicons name="globe-outline" size={14} color={colors.textSecondary} />
                <Text variant="small" style={{ color: colors.text, fontWeight: '600' }}>
                  Website
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* Popular Tracks Section */}
        {tracks.length > 0 ? (
          <View style={styles.section}>
            <SectionHeader
              title="Popular songs"
              subtitle={`${tracks.length} songs`}
              actionLabel={selection.active ? 'Done' : 'Select'}
              onAction={selection.active ? selection.cancel : () => selection.begin()}
            />

            <View style={{ gap: 2 }}>
              {displayedTracks.map((track, index) => (
                <SongRow
                  key={track.id}
                  track={track}
                  showIndex={index + 1}
                  subtitle={track.album?.title}
                  downloaded={downloadedIds.has(track.id)}
                  isCurrent={currentTrack?.id === track.id}
                  isPlaying={playing}
                  selectionMode={selection.active}
                  selected={selection.isSelected(track.id)}
                  onLongPress={() => selection.toggle(track.id)}
                  onPress={() => {
                    if (selection.active) selection.toggle(track.id);
                    else playQueue(index);
                  }}
                  onMore={
                    selection.active
                      ? undefined
                      : () => openSongMenu(track, { sourceLabel: `Artist · ${artist?.name}` })
                  }
                />
              ))}
            </View>

            {tracks.length > 5 ? (
              <Pressable
                onPress={() => setShowAllTracks((prev) => !prev)}
                style={styles.showMoreButton}
                accessibilityRole="button"
              >
                <Text variant="small" style={{ color: colors.accent, fontWeight: '700' }}>
                  {showAllTracks ? 'Show less' : `Show all ${tracks.length} popular songs`}
                </Text>
              </Pressable>
            ) : null}

            <View style={{ marginTop: spacing.md }}>
              <PrimaryButton
                label={downloadBusy ? 'Queuing downloads...' : 'Download popular songs'}
                icon="download-outline"
                onPress={() => void downloadPopular()}
                disabled={downloadBusy}
              />
            </View>
          </View>
        ) : null}

        {/* Discography Section */}
        <View style={styles.section}>
          <SectionHeader title="Discography" subtitle="Albums, singles and releases" />

          {/* Discography Filter Tabs */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterTabsRow}
          >
            <FilterChip
              label="All"
              active={activeTab === 'all'}
              onPress={() => setActiveTab('all')}
            />
            <FilterChip
              label={`Albums (${detail.discography.albums.length})`}
              active={activeTab === 'albums'}
              onPress={() => setActiveTab('albums')}
            />
            <FilterChip
              label={`Singles & EPs (${detail.discography.singles.length + detail.discography.eps.length})`}
              active={activeTab === 'singles'}
              onPress={() => setActiveTab('singles')}
            />
            {detail.discography.compilations.length > 0 ? (
              <FilterChip
                label={`Compilations (${detail.discography.compilations.length})`}
                active={activeTab === 'compilations'}
                onPress={() => setActiveTab('compilations')}
              />
            ) : null}
          </ScrollView>

          {/* Sort Selector */}
          <View style={styles.sortRow}>
            <Text variant="small" style={{ color: colors.textMuted }}>
              Sort by:
            </Text>
            <Pressable
              onPress={() =>
                setSortOrder((curr) =>
                  curr === 'newest' ? 'oldest' : curr === 'oldest' ? 'az' : 'newest'
                )
              }
              style={styles.sortButton}
            >
              <Text variant="small" style={{ color: colors.accent, fontWeight: '600' }}>
                {sortOrder === 'newest'
                  ? 'Newest first'
                  : sortOrder === 'oldest'
                    ? 'Oldest first'
                    : 'Alphabetical (A-Z)'}
              </Text>
              <Ionicons name="swap-vertical" size={14} color={colors.accent} />
            </Pressable>
          </View>

          {/* Albums Rail / List */}
          {discographyItems.length > 0 ? (
            <SectionRail>
              {discographyItems.map((album) => (
                <MediaCard
                  key={album.id}
                  title={album.title}
                  subtitle={album.releaseDate ? album.releaseDate.slice(0, 4) : album.type}
                  artworkUri={album.artworkUrl}
                  onPress={() =>
                    navigation.navigate('Album', { id: album.id, title: album.title })
                  }
                />
              ))}
            </SectionRail>
          ) : (
            <Text variant="small" style={{ color: colors.textMuted, paddingVertical: spacing.md }}>
              No releases found for this category.
            </Text>
          )}
        </View>

        {/* Similar Artists Section */}
        {detail.relatedArtists.length > 0 ? (
          <View style={styles.section}>
            <SectionHeader title="Similar artists" subtitle="Fans also listen to" />
            <SectionRail>
              {detail.relatedArtists.map((rel) => (
                <ArtistCard
                  key={rel.id}
                  name={rel.name}
                  artworkUri={rel.artworkUrl}
                  onPress={() =>
                    navigation.push('Artist', { id: rel.id, name: rel.name })
                  }
                />
              ))}
            </SectionRail>
          </View>
        ) : null}

        {/* Artist Playlists Section */}
        {detail.playlists.length > 0 ? (
          <View style={styles.section}>
            <SectionHeader
              title="Playlists"
              subtitle="Featuring this artist"
            />
            <SectionRail>
              {detail.playlists.map((playlist) => (
                <MediaCard
                  key={playlist.id}
                  title={playlist.name}
                  subtitle={`${playlist.trackCount} songs · ${playlist.owner.name}`}
                  artworkUri={playlist.artworkUrl}
                  onPress={() => {
                    if (playlist.id.startsWith('local:')) {
                      navigation.navigate('LocalPlaylist', { id: playlist.id.slice(6) });
                    } else {
                      navigation.navigate('Playlist', {
                        id: playlist.id,
                        name: playlist.name,
                      });
                    }
                  }}
                />
              ))}
            </SectionRail>
          </View>
        ) : null}
      </ScrollView>

      {/* Track Selection Footer */}
      <TrackSelectionFooter
        selection={selection}
        tracks={tracks}
        bottomInset={insets.bottom}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  heroContainer: {
    height: 330,
    width: '100%',
    position: 'relative',
    justifyContent: 'flex-end',
  },
  heroImage: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: 330,
  },
  heroFallback: {
    backgroundColor: '#2e1065',
  },
  heroGradientOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(18, 18, 20, 0.65)',
  },
  topBar: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    zIndex: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  heroContent: {
    padding: spacing.lg,
    zIndex: 2,
  },
  verifiedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.xs,
  },
  artistName: {
    color: colors.text,
    fontSize: 34,
    fontWeight: '800',
    lineHeight: 40,
    letterSpacing: -0.5,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.xs,
    flexWrap: 'wrap',
  },
  originText: {
    color: colors.accentBright,
    fontWeight: '600',
  },
  metaSeparator: {
    color: colors.textMuted,
  },
  genreText: {
    color: colors.textSecondary,
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  actionStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  followButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radii.full,
    borderWidth: 1,
  },
  followedButton: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  unfollowedButton: {
    backgroundColor: colors.card,
    borderColor: colors.border,
  },
  playbackButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  statBox: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  bioCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  linksRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  linkPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.full,
  },
  section: {
    marginTop: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  showMoreButton: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  filterTabsRow: {
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  sortButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
});
