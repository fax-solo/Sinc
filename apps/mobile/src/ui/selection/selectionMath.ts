/** Pure helpers for multi-select state; kept React-free for unit tests. */

export function toggleSelectedId(selectedIds: ReadonlySet<string>, trackId: string): Set<string> {
  const next = new Set(selectedIds);
  if (next.has(trackId)) next.delete(trackId);
  else next.add(trackId);
  return next;
}

export function selectedIdsFromList(trackIds: Iterable<string>): Set<string> {
  return new Set(trackIds);
}
