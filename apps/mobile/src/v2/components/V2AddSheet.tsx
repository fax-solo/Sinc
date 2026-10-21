import { useState } from 'react';
import { FlatList, Modal, Pressable, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import type { CanonicalTrack } from '@sinc/shared';
import { v2Colors, v2Radii, v2Spacing } from '../theme';
import { V2Text } from './V2Text';
import { V2TextField } from './V2Fields';
import { V2Button } from './V2Button';
import { useLibraryStore } from '../../services/library/libraryStore';

interface V2AddSheetProps {
  track: CanonicalTrack;
  visible: boolean;
  onClose: () => void;
}

/** Bottom sheet to file a track into a playlist (v2-styled). */
export function V2AddSheet({ track, visible, onClose }: V2AddSheetProps) {
  const playlists = useLibraryStore((s) => s.playlists);
  const addPlaylist = useLibraryStore((s) => s.addPlaylist);
  const addToPlaylist = useLibraryStore((s) => s.addToPlaylist);
  const [name, setName] = useState('');

  const create = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const id = addPlaylist(trimmed, [track]);
    void id;
    setName('');
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            backgroundColor: v2Colors.surface,
            borderTopLeftRadius: v2Radii.xl,
            borderTopRightRadius: v2Radii.xl,
            padding: v2Spacing.lg,
            gap: v2Spacing.md,
            maxHeight: '75%',
          }}
        >
          <View
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <V2Text variant="title" numberOfLines={1} style={{ flex: 1 }}>
              Add to playlist
            </V2Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
              <Ionicons name="close" size={24} color={v2Colors.textSecondary} />
            </Pressable>
          </View>
          <V2Text variant="small" color="textSecondary" numberOfLines={1}>
            {track.title}
          </V2Text>
          <View style={{ flexDirection: 'row', gap: v2Spacing.xs }}>
            <View style={{ flex: 1 }}>
              <V2TextField
                value={name}
                onChangeText={setName}
                placeholder="New playlist name"
                onSubmitEditing={create}
              />
            </View>
            <V2Button label="Create" onPress={create} disabled={!name.trim()} compact />
          </View>
          <FlatList
            data={playlists}
            keyExtractor={(p) => p.id}
            contentContainerStyle={{ gap: v2Spacing.xs }}
            renderItem={({ item }) => {
              const contains = item.tracks.some((t) => t.id === track.id);
              return (
                <Pressable
                  onPress={() => {
                    if (!contains) addToPlaylist(item.id, track);
                    onClose();
                  }}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: v2Spacing.sm,
                    backgroundColor: v2Colors.surfaceElevated,
                    borderRadius: v2Radii.md,
                    padding: v2Spacing.sm,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <View style={{ flex: 1 }}>
                    <V2Text variant="body" style={{ fontWeight: '600' }} numberOfLines={1}>
                      {item.name}
                    </V2Text>
                    <V2Text variant="small" color="textSecondary">
                      {item.tracks.length} songs
                    </V2Text>
                  </View>
                  {contains ? (
                    <Ionicons name="checkmark" size={20} color={v2Colors.accent} />
                  ) : null}
                </Pressable>
              );
            }}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
