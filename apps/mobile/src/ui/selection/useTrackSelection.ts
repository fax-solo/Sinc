import { useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler } from 'react-native';
import { selectedIdsFromList, toggleSelectedId } from './selectionMath';

export interface TrackSelection {
  active: boolean;
  selectedIds: ReadonlySet<string>;
  count: number;
  isSelected: (trackId: string) => boolean;
  /** Enters selection mode, optionally selecting the song that started it. */
  begin: (trackId?: string) => void;
  /** Adds/removes a song and enters selection mode if needed. */
  toggle: (trackId: string) => void;
  selectAll: (trackIds: Iterable<string>) => void;
  deselectAll: () => void;
  cancel: () => void;
}

/**
 * Local, screen-owned multi-select state. Long-press calls `toggle`, a normal
 * tap calls `toggle` while active, and the selection bar calls `cancel`.
 */
export function useTrackSelection(): TrackSelection {
  const [active, setActive] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());

  const begin = useCallback((trackId?: string) => {
    setActive(true);
    if (trackId) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.add(trackId);
        return next;
      });
    }
  }, []);

  const toggle = useCallback((trackId: string) => {
    setActive(true);
    setSelectedIds((prev) => toggleSelectedId(prev, trackId));
  }, []);

  const selectAll = useCallback((trackIds: Iterable<string>) => {
    setActive(true);
    setSelectedIds(selectedIdsFromList(trackIds));
  }, []);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const cancel = useCallback(() => {
    setActive(false);
    setSelectedIds(new Set());
  }, []);

  const isSelected = useCallback((trackId: string) => selectedIds.has(trackId), [selectedIds]);

  // Hardware back is the natural way out of a transient selection toolbar on
  // Android and must not pop the whole screen.
  useEffect(() => {
    if (!active) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      cancel();
      return true;
    });
    return () => subscription.remove();
  }, [active, cancel]);

  return useMemo(
    () => ({
      active,
      selectedIds,
      count: selectedIds.size,
      isSelected,
      begin,
      toggle,
      selectAll,
      deselectAll,
      cancel,
    }),
    [active, selectedIds, isSelected, begin, toggle, selectAll, deselectAll, cancel]
  );
}
