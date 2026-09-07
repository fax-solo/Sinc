import { describe, expect, it } from 'vitest';
import type { CanonicalTrack } from '@sinc/shared';
import type { LocalPlaylist, PlayStat } from '../../services/library/libraryStore';
import { buildLocalSections, type DigestInput } from './localDigest';

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

function stat(count: number, completed = 0): PlayStat {
  return { count, completedCount: completed, lastPlayedAt: Date.now() };
}

function playlist(id: string, name: string, updatedAt: number): LocalPlaylist {
  return {
    id,
    name,
    tracks: [],
    createdAt: 0,
    updatedAt,
  };
}

function base(): DigestInput {
  return {
    recentlyPlayed: [],
    favoriteTracks: [],
    playStats: {},
    skipStats: {},
    hiddenTrackIds: [],
    hiddenArtistNames: [],
    playlists: [],
    recentlyPlayedPlaylistIds: [],
    downloadedTracks: [],
  };
}

describe('buildLocalSections', () => {
  it('starts with Recently played using the freshest tracks', () => {
    const t1 = track('t1');
    const t2 = track('t2');
    const sections = buildLocalSections({ ...base(), recentlyPlayed: [t1, t2] });
    expect(sections[0]).toEqual({
      kind: 'recently-played',
      title: 'Recently played',
      tracks: [t1, t2],
    });
  });

  it('ranks On repeat by count then recency and omits skip-heavy/hidden', () => {
    const heavy = track('heavy', 'Heavy Artist');
    const hidden = track('hidden', 'Hidden Artist');
    const top = track('top', 'Top Artist');
    const mid = track('mid', 'Mid Artist');
    const sections = buildLocalSections({
      ...base(),
      recentlyPlayed: [top, heavy, hidden, mid],
      playStats: {
        heavy: stat(5),
        hidden: stat(4),
        top: stat(3),
        mid: stat(2),
      },
      skipStats: { heavy: 4 },
      hiddenTrackIds: ['hidden'],
    });
    const onRepeat = sections.find((s) => s.title === 'On repeat');
    expect(onRepeat?.kind === 'tracks' && onRepeat.tracks.map((t) => t.id)).toEqual(['top', 'mid']);
  });

  it('builds Saved for you from completed downloads only', () => {
    const sections = buildLocalSections({
      ...base(),
      downloadedTracks: [track('d1'), track('d2'), track('d3')],
    });
    const saved = sections.find((s) => s.title === 'Saved for you');
    expect(saved?.kind === 'tracks' && saved.tracks.map((t) => t.id)).toEqual(['d1', 'd2', 'd3']);
  });

  it('orders playlists with recent-first then updatedAt, capped at 6', () => {
    const a = playlist('a', 'A', 100);
    const b = playlist('b', 'B', 300);
    const c = playlist('c', 'C', 200);
    const sections = buildLocalSections({
      ...base(),
      playlists: [a, b, c],
      recentlyPlayedPlaylistIds: ['c'],
    });
    const qa = sections.find((s) => s.title === 'Your playlists');
    expect(qa?.kind === 'quick-access' && qa.playlists.map((p) => p.id)).toEqual(['c', 'b', 'a']);
  });

  it('returns empty when there is nothing local', () => {
    expect(buildLocalSections(base())).toEqual([]);
  });
});
