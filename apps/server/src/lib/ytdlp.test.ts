import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { YtdlpResolver, encodeTrackId, decodeTrackId, isYtdlpId, providerForUrl } from './ytdlp.js';

const { mockSpawn, mockSpawnSync } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockSpawnSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: (bin: string, args: string[], opts: unknown) => mockSpawn(bin, args, opts),
  spawnSync: (bin: string, args: string[], opts: unknown) => mockSpawnSync(bin, args, opts),
}));

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

beforeEach(() => {
  mockSpawn.mockReset();
  mockSpawnSync.mockReset();
});

function queueSpawn(stdoutLine: string, code = 0) {
  mockSpawn.mockImplementation(() => {
    const child = new FakeChild();
    setImmediate(() => {
      child.stdout.emit('data', Buffer.from(stdoutLine));
      child.emit('close', code);
    });
    return child;
  });
}

describe('ytdlp id helpers', () => {
  it('encodes and decodes URLs', () => {
    const url = 'https://soundcloud.com/artist/song-title';
    const id = encodeTrackId(url);
    expect(id.startsWith('ytdlp:')).toBe(true);
    expect(decodeTrackId(id)).toBe(url);
    expect(isYtdlpId(id)).toBe(true);
  });

  it('rejects non-ytdlp ids', () => {
    expect(decodeTrackId('itunes:1')).toBeNull();
    expect(decodeTrackId('plain')).toBeNull();
    expect(isYtdlpId('plain')).toBe(false);
  });

  it('infers the provider from the host', () => {
    expect(providerForUrl('https://soundcloud.com/x')).toBe('soundcloud');
    expect(providerForUrl('https://youtube.com/watch?v=x')).toBe('youtube');
  });
});

describe('YtdlpResolver', () => {
  it('reports availability from the binary probe', () => {
    mockSpawnSync.mockReturnValue({ status: 0 });
    expect(new YtdlpResolver().isAvailable()).toBe(true);
    mockSpawnSync.mockReturnValue({ status: 1 });
    expect(new YtdlpResolver().isAvailable()).toBe(false);
  });

  it('maps flat search results to canonical entries', async () => {
    queueSpawn(
      JSON.stringify({
        entries: [
          {
            title: 'Song A',
            webpage_url: 'https://soundcloud.com/a',
            uploader: 'Artist',
            duration: 180.5,
            thumbnail: 'https://x/a.jpg',
          },
          { title: '', url: '' },
        ],
      })
    );
    const results = await new YtdlpResolver().searchTracks('song a', 5, 'soundcloud');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: encodeTrackId('https://soundcloud.com/a'),
      title: 'Song A',
      artist: 'Artist',
      durationMs: 180500,
      provider: 'soundcloud',
      url: 'https://soundcloud.com/a',
    });
    expect(mockSpawn.mock.calls[0][1].join(' ')).toContain('scsearch5');
  });

  it('returns an empty list on a non-zero search exit or bad JSON', async () => {
    queueSpawn('', 1);
    expect(await new YtdlpResolver().searchTracks('x', 5, 'youtube')).toEqual([]);
    queueSpawn('not-json');
    expect(await new YtdlpResolver().searchTracks('x', 5, 'youtube')).toEqual([]);
  });

  it('resolves a stream from the yt-dlp print output', async () => {
    queueSpawn('https://cdn.example/audio.m4a\tm4a\t305\n');
    const stream = await new YtdlpResolver().resolve('https://youtube.com/watch?v=x');
    expect(stream).toMatchObject({
      url: 'https://cdn.example/audio.m4a',
      provider: 'youtube',
      mimeType: 'audio/mp4',
      durationMs: 305000,
    });
    expect(mockSpawn.mock.calls[0][1].join(' ')).toContain('player_client=android');
  });

  it('caches negative and positive resolutions', async () => {
    queueSpawn('not a url');
    const resolver = new YtdlpResolver();
    expect(await resolver.resolve('https://youtube.com/watch?v=x')).toBeNull();
    const firstCalls = mockSpawn.mock.calls.length;
    expect(await resolver.resolve('https://youtube.com/watch?v=x')).toBeNull();
    expect(mockSpawn.mock.calls.length).toBe(firstCalls);
  });

  it('reads track info from a dump-single-json response', async () => {
    queueSpawn(
      JSON.stringify({
        title: 'Track',
        uploader: 'Channel',
        duration: 120,
        thumbnail: 'https://x/t.jpg',
        webpage_url: 'https://youtube.com/watch?v=abc',
      })
    );
    const info = await new YtdlpResolver().getTrackInfo('https://youtube.com/watch?v=abc');
    expect(info).toMatchObject({
      id: encodeTrackId('https://youtube.com/watch?v=abc'),
      title: 'Track',
      artist: 'Channel',
      durationMs: 120000,
    });
    expect(mockSpawn.mock.calls[0][1].join(' ')).toContain('--dump-single-json');
  });
});
