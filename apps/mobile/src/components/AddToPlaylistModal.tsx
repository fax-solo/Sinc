import { useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import type { CanonicalTrack } from '@sinc/shared';
import { AppText } from './AppText';
import { AppButton } from './AppButton';
import { useTheme } from '../theme';
import { useLibraryStore } from '../services/library/libraryStore';

interface AddToPlaylistModalProps {
  track: CanonicalTrack;
  visible: boolean;
  onClose: () => void;
}

export function AddToPlaylistModal({ track, visible, onClose }: AddToPlaylistModalProps) {
  const { colors, spacing, radii } = useTheme();
  const playlists = useLibraryStore((s) => s.playlists);
  const addToPlaylist = useLibraryStore((s) => s.addToPlaylist);
  const removeFromPlaylist = useLibraryStore((s) => s.removeFromPlaylist);
  const addPlaylist = useLibraryStore((s) => s.addPlaylist);
  const [newName, setNewName] = useState('');

  const createAndAdd = () => {
    const name = newName.trim();
    if (!name) return;
    const id = addPlaylist(name);
    addToPlaylist(id, track);
    setNewName('');
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface,
              borderTopLeftRadius: radii.xl,
              borderTopRightRadius: radii.xl,
            },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.handle} />
          <View style={styles.header}>
            <AppText variant="headline">Add to playlist</AppText>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>
          <AppText
            variant="small"
            color="textSecondary"
            numberOfLines={1}
            style={{ marginBottom: spacing.md }}
          >
            {track.title} — {track.artists.map((a) => a.name).join(', ')}
          </AppText>

          <View style={{ gap: spacing.xs }}>
            {playlists.length === 0 ? (
              <AppText variant="body" color="textMuted" style={styles.empty}>
                No playlists yet. Create one below.
              </AppText>
            ) : (
              playlists.map((p) => {
                const included = p.tracks.some((t) => t.id === track.id);
                return (
                  <Pressable
                    key={p.id}
                    onPress={() =>
                      included ? removeFromPlaylist(p.id, track.id) : addToPlaylist(p.id, track)
                    }
                    style={({ pressed }) => [
                      styles.playlistRow,
                      { padding: spacing.sm },
                      pressed && styles.pressed,
                    ]}
                  >
                    <View
                      style={[
                        styles.iconTile,
                        { backgroundColor: '#7B5DD6', borderRadius: radii.sm },
                      ]}
                    >
                      <Ionicons name="musical-notes" size={18} color="#000" />
                    </View>
                    <View style={styles.playlistText}>
                      <AppText variant="body" numberOfLines={1}>
                        {p.name}
                      </AppText>
                      <AppText variant="small" color="textSecondary">
                        {p.tracks.length} songs
                      </AppText>
                    </View>
                    <Ionicons
                      name={included ? 'checkmark-circle' : 'add-circle-outline'}
                      size={22}
                      color={included ? colors.accent : colors.textMuted}
                    />
                  </Pressable>
                );
              })
            )}
          </View>

          <View style={[styles.newRow, { gap: spacing.xs }]}>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder="New playlist name"
              placeholderTextColor={colors.textMuted}
              style={[
                styles.input,
                {
                  backgroundColor: colors.surfaceElevated,
                  borderRadius: radii.md,
                  color: colors.textPrimary,
                },
              ]}
            />
            <AppButton label="Create" onPress={createAndAdd} disabled={!newName.trim()} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  sheet: {
    padding: 20,
    paddingBottom: 32,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  empty: {
    textAlign: 'center',
    paddingVertical: 16,
  },
  playlistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconTile: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playlistText: {
    flex: 1,
  },
  newRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
  },
  input: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
  },
  pressed: {
    opacity: 0.7,
  },
});
