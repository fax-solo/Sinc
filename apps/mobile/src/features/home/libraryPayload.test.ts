import { beforeEach, describe, expect, it } from 'vitest';
import type { CanonicalTrack } from '@sinc/shared';
import { useLibraryStore, type PlayStat } from '../../services/library/libraryStore';
import { useDownloadsStore } from '../../services/library/downloadsStore';
import { buildLibraryPayload } from './libraryPayload';

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

function reset() {
  useLibraryStore.setState({
    playStats: {},
    skipStats: {},
    artistPlayStats: {},
    thumbsUp: {},
    thumbsDown: {},
    hiddenTrackIds: [],
    hiddenArtistNames: [],
    discoveryPreference: 0.5,
    playlists: [],
    recentlyPlayedPlaylistIds: [],
  });
  useDownloadsStore.setState({ downloads: [] });
}

beforeEach(() => {
  reset();
});

describe('buildLibraryPayload', () => {
  it('caps playCounts/completedCounts at 300 and sorts by recency', () => {
    const seed: Record<string, PlayStat> = {};
    for (let i = 0; i < 310; i++)
      seed[`t${i}`] = { count: i + 1, completedCount: i + 1, lastPlayedAt: i };
    useLibraryStore.setState({ playStats: seed });
    const payload = buildLibraryPayload();
    expect(payload.signals?.playCounts.length).toBe(300);
    expect(payload.signals?.completedCounts.length).toBe(300);
    expect(payload.signals?.playCounts[0].trackId).toBe('t309');
  });

  it('caps artistPlayCounts at 100', () => {
    for (let i = 0; i < 110; i++)
      useLibraryStore.getState().recordPlayStarted(track(`t${i}`, `A${i}`));
    const payload = buildLibraryPayload();
    expect(payload.signals?.artistPlayCounts.length).toBe(100);
  });

  it('caps skips at 300 highest first and includes thumb rows', () => {
    for (let i = 0; i < 305; i++) useLibraryStore.getState().recordSkip(track(`t${i}`));
    const store = useLibraryStore.getState();
    store.setThumb('itunes:1', 'up');
    store.setThumb('artist:Pop', 'down');
    const payload = buildLibraryPayload();
    expect(payload.signals?.skipCounts.length).toBe(300);
    expect(payload.signals?.skipCounts[0].count).toBe(1);
    expect(payload.signals?.thumbs).toContainEqual({ targetId: 'itunes:1', value: 'up' });
    expect(payload.signals?.thumbs).toContainEqual({ targetId: 'artist:Pop', value: 'down' });
  });

  it('ships hidden lists and clamps discoveryPreference in payload', () => {
    const store = useLibraryStore.getState();
    store.hideTrack('x');
    store.hideArtist('Dodgy');
    store.setDiscoveryPreference(0.9);
    const payload = buildLibraryPayload();
    expect(payload.signals?.hiddenTrackIds).toEqual(['x']);
    expect(payload.signals?.hiddenArtistNames).toEqual(['Dodgy']);
    expect(payload.signals?.discoveryPreference).toBe(0.9);
  });

  it('includes only completed downloads, newest first', () => {
    useDownloadsStore.setState({
      downloads: [
        {
          jobId: '1',
          track: track('d1'),
          phase: 'completed',
          progress: 100,
          createdAt: 1,
          completedAt: 2,
        },
        { jobId: '2', track: track('d2'), phase: 'failed', progress: 0, createdAt: 3 },
        {
          jobId: '3',
          track: track('d3'),
          phase: 'completed',
          progress: 100,
          createdAt: 2,
          completedAt: 4,
        },
      ],
    });
    const payload = buildLibraryPayload();
    expect(payload.downloadedTracks.map((t) => t.id)).toEqual(['d3', 'd1']);
  });
});
