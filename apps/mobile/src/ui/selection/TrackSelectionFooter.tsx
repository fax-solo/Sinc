import { useState } from 'react';
import type { CanonicalTrack } from '@sinc/shared';
import { PrimaryButton } from '../components/Buttons';
import { ConfirmDialog, toast } from '../components/Overlays';
import { queueTracksForDownload } from '../../services/library/downloadQueue';
import { AddToPlaylistSheet } from './AddToPlaylistSheet';
import { TrackSelectionBar } from './TrackSelectionBar';
import type { TrackSelection } from './useTrackSelection';

interface TrackSelectionFooterProps {
  selection: TrackSelection;
  /** All tracks currently represented by the list, used to resolve selected IDs. */
  tracks: CanonicalTrack[];
  showDownload?: boolean;
  onRemoveSelected?: (tracks: CanonicalTrack[]) => void;
  removeLabel?: string;
  bottomInset?: number;
}

/** Standard multi-select actions: add to playlist, download, optional remove. */
export function TrackSelectionFooter({
  selection,
  tracks,
  showDownload = true,
  onRemoveSelected,
  removeLabel = 'Remove',
  bottomInset,
}: TrackSelectionFooterProps) {
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const selectedTracks = tracks.filter((track) => selection.selectedIds.has(track.id));
  const count = selectedTracks.length;
  const allSelected = tracks.length > 0 && count === tracks.length;

  const download = async () => {
    if (count === 0 || downloading) return;
    setDownloading(true);
    try {
      const result = await queueTracksForDownload(selectedTracks);
      if (result.queued > 0) {
        toast(
          `Downloading ${result.queued} song${result.queued === 1 ? '' : 's'}${
            result.skipped > 0 ? ` · ${result.skipped} already offline` : ''
          }`,
          'success'
        );
      } else {
        toast('Selected songs are already downloaded or downloading', 'default');
      }
    } catch {
      toast('Could not start those downloads', 'error');
    } finally {
      setDownloading(false);
    }
  };

  const remove = () => {
    if (count === 0) return;
    setConfirmRemoveOpen(false);
    onRemoveSelected?.(selectedTracks);
    toast(`Removed ${count} song${count === 1 ? '' : 's'} from this playlist`, 'success');
    selection.cancel();
  };

  return (
    <>
      <TrackSelectionBar
        count={count}
        totalCount={tracks.length}
        allSelected={allSelected}
        onCancel={selection.cancel}
        onSelectAll={() => selection.selectAll(tracks.map((track) => track.id))}
        onDeselectAll={selection.deselectAll}
        bottomInset={bottomInset}
      >
        <PrimaryButton
          compact
          label="Add to playlist"
          disabled={count === 0}
          onPress={() => setPlaylistOpen(true)}
          style={{ flex: 1 }}
        />
        {showDownload ? (
          <PrimaryButton
            compact
            variant="secondary"
            label="Download"
            loading={downloading}
            disabled={count === 0}
            onPress={() => void download()}
            style={{ flex: 1 }}
          />
        ) : null}
        {onRemoveSelected ? (
          <PrimaryButton
            compact
            variant="danger"
            label={removeLabel}
            disabled={count === 0}
            onPress={() => setConfirmRemoveOpen(true)}
            style={{ flex: 1 }}
          />
        ) : null}
      </TrackSelectionBar>

      <AddToPlaylistSheet
        visible={playlistOpen}
        tracks={selectedTracks}
        onClose={() => setPlaylistOpen(false)}
        onDone={selection.cancel}
      />

      <ConfirmDialog
        visible={confirmRemoveOpen}
        title={`Remove ${count} song${count === 1 ? '' : 's'}?`}
        message="They will be removed from this playlist. The songs and any downloads stay in your library."
        confirmLabel="Remove"
        destructive
        onCancel={() => setConfirmRemoveOpen(false)}
        onConfirm={remove}
      />
    </>
  );
}
