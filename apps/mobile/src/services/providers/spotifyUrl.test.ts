import { describe, expect, it } from 'vitest';
import { parseSpotifyUrl, isSpotifyPlaylistUrl } from './spotifyUrl';

describe('spotifyUrl', () => {
  it('parses valid Spotify playlist URLs and URIs', () => {
    const webUrl = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=12345';
    const parsedWeb = parseSpotifyUrl(webUrl);
    expect(parsedWeb).not.toBeNull();
    expect(parsedWeb?.type).toBe('playlist');
    expect(parsedWeb?.id).toBe('37i9dQZF1DXcBWIGoYBM5M');
    expect(parsedWeb?.url).toBe('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
    expect(isSpotifyPlaylistUrl(webUrl)).toBe(true);

    const uri = 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M';
    const parsedUri = parseSpotifyUrl(uri);
    expect(parsedUri).not.toBeNull();
    expect(parsedUri?.type).toBe('playlist');
    expect(parsedUri?.id).toBe('37i9dQZF1DXcBWIGoYBM5M');
  });

  it('parses valid Spotify artist, album, and track URLs', () => {
    const artist = parseSpotifyUrl('https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb');
    expect(artist?.type).toBe('artist');
    expect(artist?.id).toBe('4Z8W4fKeB5YxbusRsdQVPb');

    const album = parseSpotifyUrl('spotify:album:2noRn2Aes5aoNVsU6iWThc');
    expect(album?.type).toBe('album');
    expect(album?.id).toBe('2noRn2Aes5aoNVsU6iWThc');

    const track = parseSpotifyUrl('https://open.spotify.com/track/7ouMYWpwJ422jRcDASZB7P');
    expect(track?.type).toBe('track');
    expect(track?.id).toBe('7ouMYWpwJ422jRcDASZB7P');
  });

  it('returns null on invalid or non-Spotify URLs', () => {
    expect(parseSpotifyUrl('')).toBeNull();
    expect(parseSpotifyUrl('https://deezer.com/playlist/123')).toBeNull();
    expect(parseSpotifyUrl('spotify:unknown:123')).toBeNull();
    expect(parseSpotifyUrl('hello world')).toBeNull();
  });
});
