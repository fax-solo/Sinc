import { beforeEach, describe, expect, it, vi } from 'vitest';
import { musicApi, providerIdOf } from '../api/music';

const requestMock = vi.hoisted(() => vi.fn());

vi.mock('../api/client', () => ({
  apiClient: { request: requestMock },
}));

describe('musicApi detail endpoints', () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockResolvedValue({});
  });

  it('getTrackDetail hits /music/tracks/:id', async () => {
    await musicApi.getTrackDetail('mb-track-1');
    expect(requestMock).toHaveBeenCalledWith('/music/tracks/mb-track-1');
  });

  it('getTrackDetail appends provider and limit options', async () => {
    await musicApi.getTrackDetail('mb-track-1', { provider: 'musicbrainz', limit: 5 });
    expect(requestMock).toHaveBeenCalledWith(
      '/music/tracks/mb-track-1?provider=musicbrainz&limit=5',
    );
  });

  it('getArtistDetail hits /music/artists/:id', async () => {
    await musicApi.getArtistDetail('mb-artist-1');
    expect(requestMock).toHaveBeenCalledWith('/music/artists/mb-artist-1');
  });

  it('getAlbumDetail hits /music/albums/:id', async () => {
    await musicApi.getAlbumDetail('mb-album-1');
    expect(requestMock).toHaveBeenCalledWith('/music/albums/mb-album-1');
  });

  it('getPlaylistDetail hits /music/playlists/:id', async () => {
    await musicApi.getPlaylistDetail('pl-1');
    expect(requestMock).toHaveBeenCalledWith('/music/playlists/pl-1');
  });

  it('getTrackSources hits /music/tracks/:id/sources with provider', async () => {
    await musicApi.getTrackSources('mb-track-1', 'musicbrainz');
    expect(requestMock).toHaveBeenCalledWith(
      '/music/tracks/mb-track-1/sources?provider=musicbrainz',
    );
  });

  it('encodes ids in the path', async () => {
    await musicApi.getTrackDetail('a/b c');
    expect(requestMock).toHaveBeenCalledWith('/music/tracks/a%2Fb%20c');
  });

  it('omits empty query options', async () => {
    await musicApi.getTrackDetail('mb-1', { provider: '', offset: undefined });
    expect(requestMock).toHaveBeenCalledWith('/music/tracks/mb-1');
  });
});

describe('providerIdOf', () => {
  it('returns undefined when there are no provider ids', () => {
    expect(providerIdOf(undefined)).toBeUndefined();
    expect(providerIdOf({})).toBeUndefined();
  });

  it('returns the first provider id (MusicBrainz-first ordering)', () => {
    expect(providerIdOf({ musicbrainz: 'mb-1', ytdlp: 'yt-1' })).toBe('mb-1');
  });
});
