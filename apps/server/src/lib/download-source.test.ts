import { describe, expect, it } from 'vitest';
import type { CanonicalTrack } from '@sinc/shared';
import { DOWNLOAD_SOURCE_ORDER, DownloadResolver, safeStem } from './download-source.js';
import type { DownloadSourceImpl } from './download-source.js';

const track: CanonicalTrack = {
  id: 'track-1',
  title: 'Test Song',
  artists: [{ id: 'a1', name: 'Test Artist', providerIds: {}, genres: [] }],
  durationMs: 120_000,
  explicit: false,
  providerIds: {},
};

function fakeSource(name: DownloadSourceImpl['name'], ok: boolean): DownloadSourceImpl {
  return {
    name,
    download: async () =>
      ok
        ? {
            provider: name,
            sourceUrl: 'https://example.com/x',
            filePath: `/tmp/${name}.mp3`,
            mimeType: 'audio/mpeg',
          }
        : null,
  };
}

describe('DOWNLOAD_SOURCE_ORDER', () => {
  it('keeps the reliability-first chain order', () => {
    expect(DOWNLOAD_SOURCE_ORDER).toEqual(['soundcloud', 'youtube', 'jamendo', 'archive', 'fma']);
  });
});

describe('safeStem', () => {
  it('preserves non-Latin characters', () => {
    const stem = safeStem({
      ...track,
      title: 'بعتالي في الشات',
      artists: [{ ...track.artists[0], name: 'otscha' }],
    });
    expect(stem).toContain('بعتالي-في-الشات');
    expect(stem).not.toContain(' ');
  });

  it('is unique for distinct track ids with the same artist/title', () => {
    const a = safeStem({ ...track, id: 'itunes:1', title: 'Bloodline' });
    const b = safeStem({ ...track, id: 'deezer:2', title: 'Bloodline' });
    expect(a).not.toBe(b);
  });
});

describe('DownloadResolver chain', () => {
  it('returns the first source that produces a file', async () => {
    const resolver = new DownloadResolver({} as never, '/tmp/sinc-downloads', [
      fakeSource('soundcloud', false),
      fakeSource('youtube', true),
      fakeSource('archive', true),
    ]);
    const result = await resolver.download(track, undefined);
    expect(result.provider).toBe('youtube');
  });

  it('falls through every source when all fail', async () => {
    const resolver = new DownloadResolver({} as never, '/tmp/sinc-downloads', [
      fakeSource('soundcloud', false),
      fakeSource('youtube', false),
      fakeSource('archive', false),
    ]);
    await expect(resolver.download(track, undefined)).rejects.toThrow(
      'All download sources failed'
    );
  });

  it('passes progress through', async () => {
    const saw: number[] = [];
    const source: DownloadSourceImpl = {
      name: 'archive',
      download: async (_t, _u, _s, _d, onProgress) => {
        onProgress(50);
        return {
          provider: 'archive',
          sourceUrl: 'u',
          filePath: '/tmp/a.mp3',
          mimeType: 'audio/mpeg',
        };
      },
    };
    const resolver = new DownloadResolver({} as never, '/tmp/sinc-downloads', [source]);
    await resolver.download(track, undefined, (p) => saw.push(p));
    expect(saw).toEqual([50]);
  });
});
