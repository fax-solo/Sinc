import { useCallback, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { AppText } from '../../components/AppText';
import { SongRow } from '../../components/SongRow';
import { AppButton } from '../../components/AppButton';
import { useTheme } from '../../theme';
import { playerService } from '../../services/player/PlayerService';
import { useLibraryStore } from '../../services/library/libraryStore';
import { useDownloadsStore } from '../../services/library/downloadsStore';
import { importSpotifyPlaylist, type SpotifyImportResult } from '../../api/music';
import { chevronIcon } from '../../utils/rtl';

const TRACK_ROW_HEIGHT = 64;

type Status =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; result: SpotifyImportResult };

/**
 * Imports a Spotify playlist from a pasted link. The public (no-OAuth) embed
 * route is capped at 100 tracks; bigger playlists warn about the truncation.
 * Matched tracks can be saved as a local Sinc playlist and/or downloaded.
 */
export function SpotifyImportScreen({ onBack }: { onBack: () => void }) {
  const { colors, spacing, radii } = useTheme();
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [saved, setSaved] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [doneCount, setDoneCount] = useState(0);

  const addPlaylist = useLibraryStore((s) => s.addPlaylist);
  const downloadTrack = useDownloadsStore((s) => s.downloadTrack);

  const fetchPlaylist = async () => {
    const link = url.trim();
    if (!link) return;
    setStatus({ kind: 'loading' });
    setSaved(false);
    try {
      const result = await importSpotifyPlaylist(link);
      setStatus({ kind: 'done', result });
    } catch (e) {
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : 'Import failed' });
    }
  };

  const savePlaylist = () => {
    if (status.kind !== 'done') return;
    addPlaylist(status.result.playlist.name || 'Imported from Spotify', status.result.tracks);
    setSaved(true);
  };

  const downloadAll = async () => {
    if (status.kind !== 'done' || downloading) return;
    const tracks = status.result.tracks;
    setDownloading(true);
    setDoneCount(0);
    for (let i = 0; i < tracks.length; i++) {
      try {
        await downloadTrack(tracks[i]);
      } catch {
        // keep going; individual failures shouldn't abort the whole import
      }
      setDoneCount(i + 1);
    }
    setDownloading(false);
  };

  const renderTrack = useCallback(
    ({ item, index }: { item: SpotifyImportResult['tracks'][number]; index: number }) => (
      <SongRow
        track={item}
        showFavorite
        showDownload
        onPress={() =>
          void playerService.playQueue(
            status.kind === 'done' ? status.result.tracks : [item],
            index
          )
        }
      />
    ),
    [status]
  );

  return (
    <FlatList
      style={{ backgroundColor: colors.background, flex: 1 }}
      data={status.kind === 'done' ? status.result.tracks : []}
      renderItem={renderTrack}
      keyExtractor={(track) => track.id}
      getItemLayout={(_, index) => ({
        length: TRACK_ROW_HEIGHT,
        offset: TRACK_ROW_HEIGHT * index,
        index,
      })}
      initialNumToRender={12}
      maxToRenderPerBatch={12}
      windowSize={7}
      ListHeaderComponent={
        <>
          <SectionHeader title="Import from Spotify" onBack={onBack} />
          <View style={{ padding: spacing.md, gap: spacing.sm }}>
            <AppText variant="body" color="textSecondary">
              Paste any public Spotify playlist link to fetch all of its tracks and save or download
              them.
            </AppText>
            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              <TextInput
                value={url}
                onChangeText={setUrl}
                placeholder="https://open.spotify.com/playlist/..."
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.surfaceElevated,
                    borderRadius: radii.md,
                    color: colors.textPrimary,
                  },
                ]}
              />
              <AppButton label="Fetch" onPress={fetchPlaylist} disabled={!url.trim()} />
            </View>

            {status.kind === 'loading' ? (
              <AppText variant="body" color="textSecondary">
                Importing… this can take ~15 seconds for a full playlist.
              </AppText>
            ) : null}
            {status.kind === 'error' ? (
              <AppText variant="body" color="error">
                {status.message}
              </AppText>
            ) : null}
            {status.kind === 'done' ? (
              <>
                <View
                  style={[
                    styles.playlistHeader,
                    { backgroundColor: colors.surfaceElevated, borderRadius: radii.lg },
                  ]}
                >
                  {status.result.playlist.artworkUrl ? (
                    <Image
                      source={{ uri: status.result.playlist.artworkUrl }}
                      style={styles.artwork}
                    />
                  ) : (
                    <View
                      style={[
                        styles.artwork,
                        styles.artworkFallback,
                        { backgroundColor: '#7B5DD6' },
                      ]}
                    >
                      <Ionicons name="musical-notes" size={28} color="#000" />
                    </View>
                  )}
                  <View style={styles.playlistMeta}>
                    <AppText variant="title">{status.result.playlist.name}</AppText>
                    <AppText variant="body" color="textSecondary">
                      {status.result.playlist.owner}
                    </AppText>
                    <AppText variant="body" color="textSecondary">
                      {status.result.counts.fetched} tracks
                      {status.result.counts.unresolved > 0
                        ? ` · ${status.result.counts.matched} matched to the catalog`
                        : ' · all matched to the catalog'}
                    </AppText>
                  </View>
                </View>
                {status.result.playlist.truncated ? (
                  <AppText variant="body" color="error">
                    Spotify limited us to the first {status.result.counts.fetched} songs of this
                    playlist.
                  </AppText>
                ) : null}
                {status.result.counts.unresolved > 0 ? (
                  <AppText variant="body" color="textSecondary">
                    {status.result.counts.unresolved} tracks aren't in our catalog — they're kept
                    with their Spotify info and will be resolved via YouTube/SoundCloud when you
                    play or download them.
                  </AppText>
                ) : null}
                <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                  <AppButton
                    label={saved ? 'Saved' : 'Save as playlist'}
                    onPress={savePlaylist}
                    disabled={saved || status.result.tracks.length === 0}
                    style={{ flex: 1 }}
                  />
                  <AppButton
                    label={
                      downloading
                        ? `Downloading ${doneCount}/${status.result.tracks.length}`
                        : `Download all (${status.result.tracks.length})`
                    }
                    onPress={downloadAll}
                    disabled={downloading || status.result.tracks.length === 0}
                    loading={downloading}
                    style={{ flex: 1 }}
                  />
                </View>
              </>
            ) : null}
          </View>
        </>
      }
      contentContainerStyle={{ paddingBottom: 48 }}
    />
  );
}

function SectionHeader({ title, onBack }: { title: string; onBack: () => void }) {
  const { colors, spacing } = useTheme();
  return (
    <View style={[styles.sectionHeader, { marginTop: spacing.md }]}>
      <Pressable
        onPress={onBack}
        hitSlop={8}
        style={styles.backButton}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <Ionicons name={chevronIcon('back')} size={24} color={colors.textPrimary} />
      </Pressable>
      <AppText variant="headline" style={styles.sectionHeaderTitle}>
        {title}
      </AppText>
      <View style={{ width: 32 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  playlistHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
  },
  artwork: {
    width: 64,
    height: 64,
    borderRadius: 8,
  },
  artworkFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  playlistMeta: {
    flex: 1,
    gap: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  sectionHeaderTitle: {
    flex: 1,
    textAlign: 'center',
  },
  backButton: {
    width: 32,
  },
});
