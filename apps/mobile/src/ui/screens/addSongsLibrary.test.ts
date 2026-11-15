import { describe, expect, it } from 'vitest';
import type { CanonicalTrack } from '@sinc/shared';
import { completedDownloadTracks, tracksForAddSongsSource } from './addSongsLibrary';
import type { DownloadRecord } from '../../services/library/downloadsStore';

function track(id: string): CanonicalTrack {
  return {
    id,
    title: `Song ${id}`,
    artists: [{ id: `artist:${id}`, name: `Artist ${id}`, providerIds: {}, genres: [] }],
    durationMs: 180_000,
    providerIds: {},
    explicit: false,
  };
}

function download(id: string, completedAt: number): DownloadRecord {
  return {
    jobId: `job-${id}`,
    track: track(id),
    localUri: `file:///music/${id}.mp3`,
    phase: 'completed',
    progress: 100,
    createdAt: completedAt,
    completedAt,
  };
}

describe('Add Songs library sources', () => {
  it('returns every completed download, not a 30-item suggestion slice', () => {
    const records = Array.from({ length: 75 }, (_, index) => download(`t${index}`, index * 1000));

    const tracks = completedDownloadTracks(records);

    expect(tracks).toHaveLength(75);
    expect(tracks[0]?.id).toBe('t74');
    expect(tracks[74]?.id).toBe('t0');
  });

  it('skips in-flight downloads and records without a local file', () => {
    const records: DownloadRecord[] = [
      download('done', 2),
      { ...download('queued', 1), phase: 'queued', localUri: undefined },
      { ...download('failed', 0), phase: 'failed' },
    ];

    expect(completedDownloadTracks(records).map((item) => item.id)).toEqual(['done']);
  });

  it('provides a full, deduplicated downloaded browse list', () => {
    const records = Array.from({ length: 40 }, (_, index) => download(`d${index}`, index));
    const favorite = track('favorite');

    const source = tracksForAddSongsSource('downloaded', {
      downloads: records,
      favorites: [favorite, records[0]!.track],
      recentlyPlayed: [favorite],
    });

    expect(source).toHaveLength(40);
    expect(source.map((item) => item.id)).not.toContain('favorite');
  });

  it('uses the complete liked and recent lists too', () => {
    const favorites = Array.from({ length: 45 }, (_, index) => track(`f${index}`));
    const recent = Array.from({ length: 60 }, (_, index) => track(`r${index}`));

    expect(
      tracksForAddSongsSource('liked', {
        downloads: [],
        favorites,
        recentlyPlayed: recent,
      })
    ).toHaveLength(45);
    expect(
      tracksForAddSongsSource('recent', {
        downloads: [],
        favorites,
        recentlyPlayed: recent,
      })
    ).toHaveLength(60);
  });
});
