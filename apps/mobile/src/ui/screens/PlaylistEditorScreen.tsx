import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../components/Text';
import { Artwork } from '../components/Artwork';
import { IconButton, PrimaryButton } from '../components/Buttons';
import { Field } from '../components/Fields';
import { toast } from '../components/Overlays';
import { EmptyState } from '../components/State';
import { colors, radii, spacing } from '../theme';
import { useLibraryStore } from '../../services/library/libraryStore';
import { playlistArtworkUrl } from '../../components/PlaylistCover';
import type { RootStackParamList } from '../../app/navigation/types';

export function PlaylistEditorScreen({
  route,
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'PlaylistEditor'>) {
  const insets = useSafeAreaInsets();
  const playlistId = route.params?.playlistId;
  const mode = route.params?.mode ?? (playlistId ? 'edit' : 'create');
  const playlists = useLibraryStore((state) => state.playlists);
  const addPlaylist = useLibraryStore((state) => state.addPlaylist);
  const updatePlaylist = useLibraryStore((state) => state.updatePlaylist);
  const setPlaylistCover = useLibraryStore((state) => state.setPlaylistCover);
  const playlist = playlistId
    ? playlists.find((item) => item.id === playlistId)
    : undefined;

  const [name, setName] = useState(playlist?.name ?? '');
  const [description, setDescription] = useState(playlist?.description ?? '');
  const [coverChoice, setCoverChoice] = useState<string | null>(
    playlist?.coverArtworkUrl ?? null
  );
  const [error, setError] = useState<string | null>(null);

  const tracks = useMemo(() => playlist?.tracks ?? [], [playlist?.tracks]);
  const automaticCover = playlistArtworkUrl(tracks);
  const coverOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: string[] = [];
    for (const track of tracks) {
      if (!track.artworkUrl || seen.has(track.artworkUrl)) continue;
      seen.add(track.artworkUrl);
      options.push(track.artworkUrl);
      if (options.length >= 12) break;
    }
    return options;
  }, [tracks]);

  if (mode === 'edit' && !playlist) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.lg }}>
        <View style={{ flexDirection: 'row', paddingTop: insets.top + spacing.xs }}>
          <IconButton
            icon="chevron-back"
            label="Back"
            size={38}
            background={colors.card}
            onPress={() => navigation.goBack()}
          />
        </View>
        <EmptyState
          icon="list-outline"
          title="Playlist not found"
          message="It may have been deleted on this device."
          actionLabel="Back to library"
          onAction={() =>
            navigation.navigate('Main', {
              screen: 'Library',
              params: { category: 'Playlists' },
            })
          }
        />
      </View>
    );
  }

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Give the playlist a name.');
      return;
    }
    setError(null);
    if (mode === 'create' || !playlist) {
      const id = addPlaylist(trimmed, [], description.trim() || undefined);
      toast('Playlist created', 'success');
      navigation.replace('LocalPlaylist', { id });
      return;
    }
    updatePlaylist(playlist.id, {
      name: trimmed,
      description: description.trim(),
    });
    if (coverChoice !== playlist.coverArtworkUrl) {
      setPlaylistCover(playlist.id, coverChoice ?? undefined);
    }
    toast('Playlist updated', 'success');
    navigation.goBack();
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + spacing.xs,
          paddingHorizontal: spacing.lg,
          paddingBottom: insets.bottom + spacing.xxl,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            marginBottom: spacing.xl,
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
            <Text variant="headline">
              {mode === 'create' ? 'New playlist' : 'Edit playlist'}
            </Text>
            <Text variant="caption">
              {mode === 'create' ? 'Name it now, add music next' : `${tracks.length} songs`}
            </Text>
          </View>
        </View>

        <View style={{ alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xl }}>
          <Artwork
            uri={coverChoice ?? automaticCover}
            size={180}
            radius={radii.lg}
            accessibilityLabel="Playlist cover preview"
            style={{ borderWidth: 1, borderColor: colors.borderSoft }}
          />
          <Text variant="caption">
            {coverChoice ? 'Custom cover selected' : 'Automatic cover'}
          </Text>
        </View>

        <View style={{ gap: spacing.md }}>
          <Field
            label="Playlist name"
            value={name}
            onChangeText={(value) => {
              setName(value);
              if (error) setError(null);
            }}
            placeholder="Late night drive"
            maxLength={80}
            autoFocus={mode === 'create'}
            error={error}
            returnKeyType="next"
          />
          <Field
            label="Description"
            value={description}
            onChangeText={setDescription}
            placeholder="What is this playlist for?"
            multiline
            maxLength={300}
          />
        </View>

        {coverOptions.length > 0 ? (
          <View style={{ marginTop: spacing.xl }}>
            <Text variant="micro" style={{ marginBottom: spacing.xs }}>
              COVER
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              <Pressable
                onPress={() => setCoverChoice(null)}
                accessibilityRole="button"
                accessibilityLabel="Use automatic cover"
                accessibilityState={{ selected: coverChoice == null }}
                style={({ pressed }) => ({
                  width: 74,
                  height: 74,
                  borderRadius: radii.md,
                  backgroundColor: colors.card,
                  borderWidth: 2,
                  borderColor: coverChoice == null ? colors.accent : colors.borderSoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 3,
                  opacity: pressed ? 0.72 : 1,
                })}
              >
                <Ionicons name="sparkles-outline" size={19} color={colors.textSecondary} />
                <Text variant="caption" style={{ fontSize: 9 }}>
                  Auto
                </Text>
              </Pressable>
              {coverOptions.map((uri) => (
                <Pressable
                  key={uri}
                  onPress={() => setCoverChoice(uri)}
                  accessibilityRole="button"
                  accessibilityLabel="Use this artwork as the playlist cover"
                  accessibilityState={{ selected: coverChoice === uri }}
                  style={({ pressed }) => ({
                    borderRadius: radii.md,
                    borderWidth: 2,
                    borderColor: coverChoice === uri ? colors.accent : 'transparent',
                    opacity: pressed ? 0.72 : 1,
                    overflow: 'hidden',
                  })}
                >
                  <Artwork uri={uri} size={70} radius={radii.sm} />
                </Pressable>
              ))}
            </View>
            <Text variant="caption" style={{ marginTop: spacing.xs }}>
              Covers come from songs in this playlist. Sinc does not upload or generate artwork.
            </Text>
          </View>
        ) : null}

        {mode === 'edit' && playlist ? (
          <PrimaryButton
            label="Add songs"
            icon="add"
            variant="secondary"
            style={{ marginTop: spacing.xl }}
            onPress={() => navigation.navigate('AddSongs', { playlistId: playlist.id })}
          />
        ) : null}

        <PrimaryButton
          label={mode === 'create' ? 'Create playlist' : 'Save changes'}
          icon={mode === 'create' ? 'add' : 'checkmark'}
          style={{ marginTop: spacing.md }}
          onPress={save}
          disabled={!name.trim()}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
