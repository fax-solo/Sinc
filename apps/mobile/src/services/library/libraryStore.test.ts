import { beforeEach, describe, expect, it } from 'vitest';
import type { CanonicalTrack } from '@sinc/shared';
import { useLibraryStore, type PlayStat } from './libraryStore';

function track(id: string, artist = `Artist ${id}`): CanonicalTrack {
  return {
    id,
    title: `Track ${id}`,
    artists: [{ id: `artist:${artist}`, name: artist, providerIds: {}, genres: [] }],
    durationMs: 1000,
    artworkUrl: undefined,
    providerIds: {},
    explicit: false,
  };
}

function resetSignals() {
  useLibraryStore.setState({
    playStats: {},
    skipStats: {},
    artistPlayStats: {},
    thumbsUp: {},
    thumbsDown: {},
    hiddenTrackIds: [],
    hiddenArtistNames: [],
    discoveryPreference: 0.5,
  });
}

beforeEach(() => {
  resetSignals();
});

describe('libraryStore signals (v3)', () => {
  it('recordPlayStarted bumps count, lastPlayedAt and artist stats', () => {
    const t = track('t1', 'Solo');
    useLibraryStore.getState().recordPlayStarted(t);
    useLibraryStore.getState().recordPlayStarted(t);

    const stat = useLibraryStore.getState().playStats['t1'];
    expect(stat?.count).toBe(2);
    expect(stat?.completedCount).toBe(0);
    expect(typeof stat?.lastPlayedAt).toBe('number');
    expect(useLibraryStore.getState().artistPlayStats['Solo']).toBe(2);
  });

  it('recordPlayCompleted bumps completed count', () => {
    const t = track('t1');
    useLibraryStore.getState().recordPlayCompleted(t);
    expect(useLibraryStore.getState().playStats['t1']?.completedCount).toBe(1);
  });

  it('recordSkip bumps skip stats', () => {
    useLibraryStore.getState().recordSkip(track('t1'));
    useLibraryStore.getState().recordSkip(track('t1'));
    expect(useLibraryStore.getState().skipStats['t1']).toBe(2);
  });

  it('keeps playStats capped and prunes least-recently-played', () => {
    const seed: Record<string, PlayStat> = {};
    for (let i = 0; i < 500; i++) seed[`t${i}`] = { count: 1, completedCount: 0, lastPlayedAt: i };
    useLibraryStore.setState({ playStats: seed });
    useLibraryStore.getState().recordPlayStarted(track('new'));
    const keys = Object.keys(useLibraryStore.getState().playStats);
    expect(keys.length).toBe(500);
    expect(keys).not.toContain('t0');
    expect(keys).toContain('new');
  });

  it('setThumb toggles up/down/none and getThumb reflects it', () => {
    const store = useLibraryStore.getState();
    expect(store.getThumb('itunes:1')).toBeUndefined();

    store.setThumb('itunes:1', 'up');
    expect(useLibraryStore.getState().getThumb('itunes:1')).toBe('up');
    expect(useLibraryStore.getState().thumbsUp['itunes:1']).toBeTypeOf('number');

    useLibraryStore.getState().setThumb('itunes:1', 'down');
    const after = useLibraryStore.getState();
    expect(after.getThumb('itunes:1')).toBe('down');
    expect(after.thumbsUp['itunes:1']).toBeUndefined();
    expect(after.thumbsDown['itunes:1']).toBeTypeOf('number');

    useLibraryStore.getState().setThumb('itunes:1', 'none');
    const cleared = useLibraryStore.getState();
    expect(cleared.getThumb('itunes:1')).toBeUndefined();
  });

  it('hideTrack/hideArtist cap and unhide', () => {
    const state = useLibraryStore.getState();
    state.hideTrack('a');
    state.hideTrack('b');
    state.hideArtist('Artist A');
    expect(useLibraryStore.getState().hiddenTrackIds).toEqual(['a', 'b']);
    expect(useLibraryStore.getState().hiddenArtistNames).toEqual(['Artist A']);

    useLibraryStore.getState().unhideTrack('a');
    useLibraryStore.getState().unhideArtist('Artist A');
    expect(useLibraryStore.getState().hiddenTrackIds).toEqual(['b']);
    expect(useLibraryStore.getState().hiddenArtistNames).toEqual([]);
  });

  it('keeps hiddenTrackIds capped at 200', () => {
    for (let i = 0; i < 210; i++) useLibraryStore.getState().hideTrack(`h${i}`);
    expect(useLibraryStore.getState().hiddenTrackIds.length).toBe(200);
    expect(useLibraryStore.getState().hiddenTrackIds).not.toContain('h0');
    expect(useLibraryStore.getState().hiddenTrackIds[199]).toBe('h209');
  });

  it('clamps discoveryPreference to [0,1]', () => {
    useLibraryStore.getState().setDiscoveryPreference(2);
    expect(useLibraryStore.getState().discoveryPreference).toBe(1);
    useLibraryStore.getState().setDiscoveryPreference(-0.5);
    expect(useLibraryStore.getState().discoveryPreference).toBe(0);
    useLibraryStore.getState().setDiscoveryPreference(0.42);
    expect(useLibraryStore.getState().discoveryPreference).toBe(0.42);
  });
});
