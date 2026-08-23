import { describe, expect, it, vi } from 'vitest';
import type { CanonicalTrack } from '@sinc/shared';
import { cleanCaptionLrc, YoutubeCaptionsProvider } from './youtube-captions.js';
import type { YtdlpResolver } from './ytdlp.js';

const track: CanonicalTrack = {
  id: 'deezer:3847276131',
  title: 'بلو بيري (قولي ازاى تقدري تنسي)',
  artists: [{ id: 'deezer:7', name: 'otsha', providerIds: {}, genres: [] }],
  durationMs: 178_000,
  explicit: false,
  providerIds: { deezer: '3847276131' },
};

describe('cleanCaptionLrc', () => {
  it('strips metadata, placeholders and blank lines', () => {
    const dirty = [
      '[re:Lavf63.1.101]',
      '[ve:63.1.101]',
      '',
      '[00:00.65][موسيقى]',
      '[00:05.23] ',
      '[00:18.24]بلوبيري تتصدم مش هتسمع غيري',
      '[00:22.63][Music]',
    ].join('\n');
    expect(cleanCaptionLrc(dirty)).toBe('[00:18.24]بلوبيري تتصدم مش هتسمع غيري');
  });

  it('removes inline placeholder fragments and collapses duplicate frames', () => {
    const dirty = [
      '[00:17.60]مزت [موسيقى]',
      '[00:18.23]مزت [موسيقى]',
      '[00:18.24]بلوبيري تتصدم مش هتسمع غيري',
      '[00:22.63]بلوبيري تتصدم مش هتسمع غيري',
      '[00:22.64]بلوبيري تتصدم مش هتسمع غيري',
      '[00:22.64]بتشتكي [موسيقى]',
    ].join('\n');
    expect(cleanCaptionLrc(dirty)).toBe(
      '[00:17.60]مزت\n[00:18.24]بلوبيري تتصدم مش هتسمع غيري\n[00:22.64]بتشتكي'
    );
  });
});

describe('YoutubeCaptionsProvider', () => {
  it('resolves the matching video and returns synced captions', async () => {
    const ytdlp = {
      bestMatchUrl: vi.fn(async () => 'https://www.youtube.com/watch?v=abc'),
      fetchCaptions: vi.fn(
        async () => '[re:x]\n[00:01.00]بلوبيري\n[00:02.00][موسيقى]\n[00:03.00]تتصدم'
      ),
    } as unknown as YtdlpResolver;
    const provider = new YoutubeCaptionsProvider(ytdlp);

    const raw = await provider.fetchLyrics(track);
    expect(raw?.synced).toContain('[00:01.00]بلوبيري');
    expect(raw?.synced).not.toContain('موسيقى');
    expect(ytdlp.bestMatchUrl).toHaveBeenCalledWith(
      expect.stringContaining('بلو بيري'),
      'youtube',
      expect.objectContaining({ title: track.title, artist: 'otsha' })
    );
  });

  it('returns null when no matching video is found', async () => {
    const ytdlp = { bestMatchUrl: vi.fn(async () => null) } as unknown as YtdlpResolver;
    const provider = new YoutubeCaptionsProvider(ytdlp);
    expect(await provider.fetchLyrics(track)).toBeNull();
  });

  it('returns null when captions are unavailable', async () => {
    const ytdlp = {
      bestMatchUrl: vi.fn(async () => 'https://www.youtube.com/watch?v=abc'),
      fetchCaptions: vi.fn(async () => null),
    } as unknown as YtdlpResolver;
    const provider = new YoutubeCaptionsProvider(ytdlp);
    expect(await provider.fetchLyrics(track)).toBeNull();
  });
});
