import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Keyboard, Linking, View } from 'react-native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { CompositeNavigationProp } from '@react-navigation/native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { v2Spacing } from '../theme';
import { V2Text } from '../components/V2Text';
import { V2Button } from '../components/V2Button';
import { V2TextField } from '../components/V2Fields';
import { V2TrackRow } from '../components/V2TrackRow';
import { V2Artwork } from '../components/V2Artwork';
import { V2Header } from '../components/V2Header';
import { V2Empty } from '../components/V2State';
import { playerService } from '../../services/player/PlayerService';
import { useLibraryStore } from '../../services/library/libraryStore';
import { useDownloadsStore } from '../../services/library/downloadsStore';
import { importSpotifyPlaylist, type SpotifyImportResult } from '../../api/music';
import type { MainTabParamList, RootStackParamList } from '../../app/navigation/types';

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Library'>,
  NativeStackNavigationProp<RootStackParamList>
>;

type Status =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; result: SpotifyImportResult };

export function V2SpotifyImportScreen({ onBack }: { onBack: () => void }) {
  const navigation = useNavigation<Nav>();
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [saved, setSaved] = useState(false);
  const [queuedSummary, setQueuedSummary] = useState<{ queued: number; skipped: number } | null>(
    null
  );

  const addPlaylist = useLibraryStore((s) => s.addPlaylist);
  const downloadTrack = useDownloadsStore((s) => s.downloadTrack);

  // In-flight guards: a double-tap on Fetch must not interleave two requests
  // (last response wins was a stale-render bug), and leaving the screen must
  // not keep setting state on a dead component.
  const fetchSeqRef = useRef(0);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      fetchSeqRef.current += 1; // orphan any in-flight request on unmount
    };
  }, []);

  const fetchPlaylist = async () => {
    const link = url.trim();
    if (!link) return;
    const seq = ++fetchSeqRef.current;
    Keyboard.dismiss();
    setStatus({ kind: 'loading' });
    setSaved(false);
    setQueuedSummary(null);
    try {
      const result = await importSpotifyPlaylist(link);
      if (seq !== fetchSeqRef.current || !aliveRef.current) return; // superseded/unmounted
      setStatus({ kind: 'done', result });
    } catch (e) {
      if (seq !== fetchSeqRef.current || !aliveRef.current) return;
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : 'Import failed' });
    }
  };

  const savePlaylist = () => {
    if (status.kind !== 'done') return;
    addPlaylist(status.result.playlist.name || 'Imported from Spotify', status.result.tracks);
    setSaved(true);
  };

  /**
   * Queues every track for download in the BACKGROUND (no per-track await):
   * each job resolves and transfers on its own — the native download pool
   * executes two at a time and the rest line up — while the store keeps the
   * attempt loop alive across screens. Rows already saved or currently queued
   * are skipped so re-tapping a playlist never double-queues it.
   */
  const downloadAll = async () => {
    if (status.kind !== 'done') return;
    const store = useDownloadsStore.getState();
    let queued = 0;
    let skipped = 0;
    for (const track of status.result.tracks) {
      const existing = store.getDownload(track.id);
      if (
        existing &&
        (existing.localUri || existing.phase === 'source' || existing.phase === 'transfer')
      ) {
        skipped += 1;
        continue;
      }
      // Fire-and-forget: failures are surfaced on the queue rows themselves,
      // not by this screen — the queue keeps running when the user leaves.
      void downloadTrack(track).catch(() => undefined);
      queued += 1;
      // Gentle pump: stagger entries so a 50-song playlist doesn't fire 50
      // provider probes at once on a weak link; the first jobs still start
      // immediately and the native pool lines the rest up.
      await new Promise((r) => setTimeout(r, 400));
    }
    setQueuedSummary({ queued, skipped });
  };

  const renderTrack = useCallback(
    ({ item, index }: { item: SpotifyImportResult['tracks'][number]; index: number }) => (
      <V2TrackRow
        track={item}
        showFavorite
        showDownload
        onPress={() => {
          const list = status.kind === 'done' ? status.result.tracks : [item];
          void playerService.playQueue(list, index);
          navigation.navigate('Player');
        }}
      />
    ),
    [status, navigation]
  );

  return (
    <FlatList
      style={{ flex: 1 }}
      data={status.kind === 'done' ? status.result.tracks : []}
      renderItem={renderTrack}
      keyExtractor={(track) => track.id}
      keyboardShouldPersistTaps="handled"
      initialNumToRender={12}
      maxToRenderPerBatch={12}
      windowSize={7}
      contentContainerStyle={{ paddingBottom: v2Spacing.xxxl }}
      ListHeaderComponent={
        <View style={{ gap: v2Spacing.md }}>
          <V2Header title="Import from Spotify" onBack={onBack} />
          <V2Text variant="body" color="textSecondary">
            Paste any public Spotify playlist link to fetch its tracks, then save or download them
            for offline listening.
          </V2Text>
          <View style={{ flexDirection: 'row', gap: v2Spacing.xs }}>
            <View style={{ flex: 1 }}>
              <V2TextField
                value={url}
                onChangeText={setUrl}
                placeholder="https://open.spotify.com/playlist/..."
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={fetchPlaylist}
              />
            </View>
            <V2Button
              label="Fetch"
              onPress={fetchPlaylist}
              disabled={!url.trim() || status.kind === 'loading'}
              loading={status.kind === 'loading'}
              compact
            />
          </View>

          {status.kind === 'loading' ? (
            <V2Text variant="body" color="textSecondary">
              Importing… this can take a little while for big playlists.
            </V2Text>
          ) : null}
          {status.kind === 'error' ? (
            <V2Text variant="body" color="error">
              {status.message}
            </V2Text>
          ) : null}
          {status.kind === 'done' ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: v2Spacing.sm,
              }}
            >
              <V2Artwork uri={status.result.playlist.artworkUrl} size={72} />
              <View style={{ flex: 1 }}>
                <V2Text variant="headline" numberOfLines={1}>
                  {status.result.playlist.name}
                </V2Text>
                <V2Text variant="small" color="textSecondary" numberOfLines={1}>
                  {status.result.playlist.owner}
                </V2Text>
                <V2Text variant="small" color="textSecondary">
                  {status.result.counts.fetched} tracks
                  {status.result.counts.unresolved > 0
                    ? ` · ${status.result.counts.matched} matched`
                    : ' · all matched'}
                </V2Text>
              </View>
            </View>
          ) : null}
          {status.kind === 'done' && status.result.playlist.truncated ? (
            <V2Text variant="small" color="error">
              Spotify limited us to the first {status.result.counts.fetched} songs of this playlist.
            </V2Text>
          ) : null}
          {status.kind === 'done' && status.result.counts.unresolved > 0 ? (
            <V2Text variant="small" color="textSecondary">
              {status.result.counts.unresolved} tracks aren't in the catalog — they're kept with
              their Spotify info and resolve via streaming when you play or download them.
            </V2Text>
          ) : null}
          {status.kind === 'done' ? (
            <View style={{ gap: v2Spacing.xs }}>
              <View style={{ flexDirection: 'row', gap: v2Spacing.xs }}>
                <View style={{ flex: 1 }}>
                  <V2Button
                    label={saved ? 'Saved ✓' : 'Save as playlist'}
                    onPress={savePlaylist}
                    disabled={saved || status.result.tracks.length === 0}
                    variant="secondary"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <V2Button
                    label={queuedSummary ? `Queued ${queuedSummary.queued} ✓` : 'Download all'}
                    onPress={downloadAll}
                    disabled={queuedSummary !== null || status.result.tracks.length === 0}
                  />
                </View>
              </View>
              {queuedSummary ? (
                <V2Text variant="small" color="textSecondary">
                  {queuedSummary.skipped > 0
                    ? `${queuedSummary.skipped} were already saved or queued · `
                    : ''}
                  The queue keeps running in the background — check it under Library → Download
                  queue.
                </V2Text>
              ) : null}
            </View>
          ) : status.kind === 'idle' ? (
            <V2Empty
              icon="musical-notes"
              title="No playlist yet"
              hint="Links look like open.spotify.com/playlist/…"
            />
          ) : null}
          <View style={{ alignItems: 'center' }}>
            <V2Text
              variant="caption"
              color="textMuted"
              onPress={() => void Linking.openURL('https://open.spotify.com')}
            >
              Open Spotify to copy a link
            </V2Text>
          </View>
        </View>
      }
    />
  );
}
