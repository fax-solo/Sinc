import { useMemo } from 'react';
import type { CanonicalTrack } from '@sinc/shared';
import { BottomSheet, SheetRow, toast } from '../components/Overlays';
import { useLibraryStore } from '../../services/library/libraryStore';
import { nextPlaylistName } from '../../services/library/playlistNames';
import { navigateTo } from '../navigation/navigation';

interface AddToPlaylistSheetProps {
  visible: boolean;
  tracks: CanonicalTrack[];
  onClose: () => void;
  /** Called after an existing playlist is updated or a new one is created. */
  onDone?: () => void;
}

/** Playlist picker shared by the multi-select toolbar and Add Songs. */
export function AddToPlaylistSheet({ visible, tracks, onClose, onDone }: AddToPlaylistSheetProps) {
  const playlists = useLibraryStore((state) => state.playlists);
  const addPlaylist = useLibraryStore((state) => state.addPlaylist);
  const addTracksToPlaylist = useLibraryStore((state) => state.addTracksToPlaylist);

  const trackIds = useMemo(() => new Set(tracks.map((track) => track.id)), [tracks]);
  const countLabel = `${tracks.length} song${tracks.length === 1 ? '' : 's'}`;

  const finish = () => {
    onClose();
    onDone?.();
  };

  const createPlaylist = () => {
    if (tracks.length === 0) return;
    const playlistId = addPlaylist(nextPlaylistName(playlists), tracks);
    toast(`Playlist created with ${countLabel}`, 'success');
    finish();
    navigateTo('LocalPlaylist', { id: playlistId });
  };

  const addToExisting = (playlistId: string, playlistName: string) => {
    const added = addTracksToPlaylist(playlistId, tracks);
    const skipped = tracks.length - added;
    if (added > 0) {
      toast(
        `Added ${added} song${added === 1 ? '' : 's'} to ${playlistName}${
          skipped > 0 ? ` · ${skipped} already there` : ''
        }`,
        'success'
      );
    } else {
      toast(`Those songs are already in ${playlistName}`, 'default');
    }
    finish();
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Add to playlist"
      subtitle={`${countLabel} selected`}
      scroll
    >
      <SheetRow
        icon="add"
        label="New playlist"
        tone="accent"
        disabled={tracks.length === 0}
        onPress={createPlaylist}
      />
      {playlists.map((playlist) => {
        const existingCount = playlist.tracks.filter((track) => trackIds.has(track.id)).length;
        const allAlreadyAdded = tracks.length > 0 && existingCount === tracks.length;
        return (
          <SheetRow
            key={playlist.id}
            icon={allAlreadyAdded ? 'checkmark-circle' : 'musical-notes-outline'}
            label={playlist.name}
            detail={`${playlist.tracks.length} song${
              playlist.tracks.length === 1 ? '' : 's'
            }${existingCount > 0 ? ` · ${existingCount} selected already added` : ''}`}
            disabled={allAlreadyAdded}
            onPress={() => addToExisting(playlist.id, playlist.name)}
          />
        );
      })}
      {playlists.length === 0 ? (
        <SheetRow
          icon="information-circle-outline"
          label="No playlists yet"
          detail="Create your first playlist with these songs."
          disabled
          onPress={() => undefined}
        />
      ) : null}
      <SheetRow icon="close" label="Cancel" onPress={onClose} />
    </BottomSheet>
  );
}
