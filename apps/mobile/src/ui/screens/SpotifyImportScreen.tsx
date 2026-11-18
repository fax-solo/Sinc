import { useEffect, useRef, useState } from 'react';
import { FlatList, Keyboard, Linking, Pressable, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../components/Text';
import { Artwork } from '../components/Artwork';
import { IconButton, PrimaryButton } from '../components/Buttons';
import { Field } from '../components/Fields';
import { SongRow } from '../components/SongRow';
import { toast } from '../components/Overlays';
import { EmptyState, ErrorState, Pill, ListSkeleton } from '../components/State';
import { colors, radii, spacing } from '../theme';
import { importSpotifyPlaylist, type SpotifyImportResult } from '../../api/music';
import { useLibraryStore } from '../../services/library/libraryStore';
import { isDownloadInProgress, useDownloadsStore } from '../../services/library/downloadsStore';
import { useNotificationStore } from '../../features/notifications/notificationStore';
import { usePreferencesStore } from '../../features/preferences/preferencesStore';
import { selectCurrentTrack, usePlayerStore } from '../../services/player/playerStore';
import { playerService } from '../../services/player/PlayerService';
import { openSongMenu } from '../songMenu/songMenuStore';
import type { RootStackParamList } from '../../app/navigation/types';

type Status =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; result: SpotifyImportResult };

export function SpotifyImportScreen({
  route,
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'SpotifyImport'>) {
  const insets = useSafeAreaInsets();
  const [url, setUrl] = useState(route.params?.initialUrl ?? '');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [savedId, setSavedId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadSummary, setDownloadSummary] = useState<{
    queued: number;
    skipped: number;
  } | null>(null);
  const aliveRef = useRef(true);
  const fetchSeqRef = useRef(0);
  const addPlaylist = useLibraryStore((state) => state.addPlaylist);
  const downloadTrack = useDownloadsStore((state) => state.downloadTrack);
  const currentTrack = usePlayerStore(selectCurrentTrack);
  const playing = usePlayerStore((state) => state.status === 'playing');

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      fetchSeqRef.current += 1;
    };
  }, []);

  const fetchPlaylist = async (overrideUrl?: string) => {
    const link = (overrideUrl ?? url).trim();
    if (!link) return;
    const seq = ++fetchSeqRef.current;
    Keyboard.dismiss();
    setStatus({ kind: 'loading' });
    setSavedId(null);
    setDownloadSummary(null);
    try {
      const result = await importSpotifyPlaylist(link);
      if (seq !== fetchSeqRef.current || !aliveRef.current) return;
      setStatus({ kind: 'done', result });
    } catch (error) {
      if (seq !== fetchSeqRef.current || !aliveRef.current) return;
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Import failed',
      });
    }
  };

  useEffect(() => {
    const initialUrl = route.params?.initialUrl;
    if (initialUrl) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void fetchPlaylist(initialUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.initialUrl]);

  const savePlaylist = () => {
    if (status.kind !== 'done' || savedId) return;
    const playlistId = addPlaylist(
      status.result.playlist.name || 'Imported from Spotify',
      status.result.tracks,
      `Imported from Spotify${status.result.playlist.owner ? ` · ${status.result.playlist.owner}` : ''}`
    );
    setSavedId(playlistId);
    toast('Playlist saved to your library', 'success');
    if (usePreferencesStore.getState().notifications.imports) {
      const count = status.result.tracks.length;
      useNotificationStore.getState().add({
        id: `spotify-import-${playlistId}`,
        kind: 'import',
        title: 'Spotify import complete',
        body: `${status.result.playlist.name || 'Your playlist'} was saved with ${count} song${
          count === 1 ? '' : 's'
        }.`,
        action: { type: 'playlist', playlistId },
      });
    }
  };

  const downloadAll = async () => {
    if (status.kind !== 'done' || downloading) return;
    setDownloading(true);
    const store = useDownloadsStore.getState();
    let queued = 0;
    let skipped = 0;
    for (const track of status.result.tracks) {
      const existing = store.getDownload(track.id);
      if (existing && (existing.localUri || isDownloadInProgress(existing.phase))) {
        skipped += 1;
        continue;
      }
      void downloadTrack(track, { priority: 'bulk' }).catch(() => undefined);
      queued += 1;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    if (!aliveRef.current) return;
    setDownloadSummary({ queued, skipped });
    setDownloading(false);
    toast(
      queued > 0 ? `Queued ${queued} download${queued === 1 ? '' : 's'}` : 'Nothing new to download',
      queued > 0 ? 'success' : 'default'
    );
  };

  const play = (index: number) => {
    if (status.kind !== 'done' || status.result.tracks.length === 0) return;
    void playerService.playQueue(status.result.tracks, index);
    navigation.navigate('Player');
  };

  const header = (
    <View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          paddingTop: spacing.xs,
          marginBottom: spacing.md,
        }}
      >
        <IconButton
          icon="chevron-back"
          label="Back"
          size={38}
          background={colors.card}
          onPress={() => navigation.goBack()}
        />
        <View style={{ flex: 1 }}>
          <Text variant="headline">Import from Spotify</Text>
          <Text variant="caption">Public playlists only</Text>
        </View>
      </View>

      <Text variant="small" style={{ lineHeight: 20, marginBottom: spacing.md }}>
        Paste a public Spotify playlist link. Sinc matches each song in its catalog, then you can
        save the playlist, download it for offline listening, or play it right away.
      </Text>

      <View
        style={{
          backgroundColor: colors.card,
          borderRadius: radii.lg,
          padding: spacing.md,
          gap: spacing.md,
        }}
      >
        <Field
          label="Playlist link"
          value={url}
          onChangeText={(value) => {
            setUrl(value);
            if (status.kind === 'error') setStatus({ kind: 'idle' });
          }}
          placeholder="https://open.spotify.com/playlist/…"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={() => void fetchPlaylist()}
        />
        <PrimaryButton
          label={status.kind === 'loading' ? 'Importing…' : 'Fetch playlist'}
          icon="cloud-download-outline"
          loading={status.kind === 'loading'}
          disabled={!url.trim()}
          onPress={() => void fetchPlaylist()}
        />
      </View>

      <Pressable
        onPress={() => void Linking.openURL('https://open.spotify.com')}
        accessibilityRole="link"
        accessibilityLabel="Open Spotify to copy a playlist link"
        style={{ alignSelf: 'center', paddingVertical: spacing.sm, marginTop: spacing.xs }}
      >
        <Text variant="caption" style={{ color: colors.accent }}>
          Open Spotify to copy a link
        </Text>
      </Pressable>

      {status.kind === 'loading' ? (
        <View
          style={{
            marginTop: spacing.md,
            backgroundColor: colors.card,
            borderRadius: radii.lg,
            padding: spacing.md,
            gap: spacing.sm,
          }}
        >
          <Text variant="bodyStrong">Reading the playlist…</Text>
          <Text variant="caption">
            Large playlists can take a little while while Sinc matches songs.
          </Text>
          <ListSkeleton rows={4} />
        </View>
      ) : null}

      {status.kind === 'error' ? (
        <View style={{ marginTop: spacing.md }}>
          <ErrorState
            compact
            title="Could not import that playlist"
            message={status.message}
            onRetry={() => void fetchPlaylist()}
          />
        </View>
      ) : null}

      {status.kind === 'done' ? (
        <View style={{ marginTop: spacing.md, gap: spacing.md }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.sm,
              backgroundColor: colors.card,
              borderRadius: radii.lg,
              padding: spacing.md,
            }}
          >
            <Artwork uri={status.result.playlist.artworkUrl} size={74} radius={radii.md} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text variant="headline" numberOfLines={2}>
                {status.result.playlist.name}
              </Text>
              <Text variant="small" numberOfLines={1}>
                {status.result.playlist.owner || 'Spotify'}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
                <Pill
                  label={`${status.result.tracks.length} imported`}
                  tone="accent"
                />
                {status.result.counts.unresolved > 0 ? (
                  <Pill label={`${status.result.counts.unresolved} unresolved`} />
                ) : (
                  <Pill label="All matched" tone="accent" />
                )}
              </View>
            </View>
          </View>

          {status.result.playlist.truncated ? (
            <Text variant="small" style={{ color: colors.warning }}>
              Spotify limited this import to the first {status.result.counts.fetched} songs.
            </Text>
          ) : null}

          {status.result.counts.unresolved > 0 ? (
            <Text variant="caption" style={{ lineHeight: 17 }}>
              Unmatched songs keep their Spotify details and try provider streaming when played or
              downloaded. They never show invented audio.
            </Text>
          ) : null}

          <View style={{ flexDirection: 'row', gap: spacing.xs }}>
            <PrimaryButton
              label={savedId ? 'Open playlist' : 'Save playlist'}
              icon={savedId ? 'arrow-forward' : 'add'}
              variant="secondary"
              compact
              disabled={status.result.tracks.length === 0}
              style={{ flex: 1 }}
              onPress={() => {
                if (savedId) navigation.navigate('LocalPlaylist', { id: savedId });
                else savePlaylist();
              }}
            />
            <PrimaryButton
              label="Download all"
              icon="download-outline"
              compact
              loading={downloading}
              disabled={downloading || status.result.tracks.length === 0}
              style={{ flex: 1 }}
              onPress={() => void downloadAll()}
            />
          </View>

          {downloadSummary ? (
            <Text variant="caption">
              {downloadSummary.queued > 0
                ? `Queued ${downloadSummary.queued} downloads. `
                : 'No new downloads were needed. '}
              {downloadSummary.skipped > 0
                ? `${downloadSummary.skipped} were already saved or queued. `
                : ''}
              Downloads keep running when you leave this screen.
            </Text>
          ) : null}

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: spacing.sm,
            }}
          >
            <Text variant="micro">TRACKS</Text>
            <Pressable
              onPress={() => play(0)}
              accessibilityRole="button"
              accessibilityLabel="Play imported songs"
              disabled={status.result.tracks.length === 0}
              style={{ paddingVertical: 4 }}
            >
              <Text variant="small" style={{ color: colors.accent, fontWeight: '700' }}>
                Play all
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {status.kind === 'idle' ? (
        <EmptyState
          icon="musical-notes-outline"
          title="No playlist imported yet"
          message="Links look like open.spotify.com/playlist/… . Private or account-only playlists cannot be imported."
        />
      ) : null}
    </View>
  );

  return (
    <FlatList
      data={status.kind === 'done' ? status.result.tracks : []}
      keyExtractor={(track) => track.id}
      ListHeaderComponent={header}
      contentContainerStyle={{
        paddingTop: insets.top + spacing.xs,
        paddingHorizontal: spacing.lg,
        paddingBottom: insets.bottom + spacing.xxl,
      }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      renderItem={({ item, index }) => (
        <SongRow
          track={item}
          showIndex={index + 1}
          isCurrent={currentTrack?.id === item.id}
          isPlaying={playing}
          onPress={() => play(index)}
          onMore={() => openSongMenu(item, { sourceLabel: 'Spotify import' })}
        />
      )}
    />
  );
}
