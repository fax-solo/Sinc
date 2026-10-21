import { mkdtemp, writeFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DownloadsService } from './service.js';
import type { CanonicalTrack } from '@sinc/shared';

const { mockFindFirst, mockCreate, mockUpdate, mockDelete, mockFindMany } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
  mockFindMany: vi.fn(),
}));

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    downloadJob: {
      findFirst: mockFindFirst,
      create: mockCreate,
      update: mockUpdate,
      delete: mockDelete,
      findMany: mockFindMany,
    },
  },
}));

vi.mock('../../lib/audio-tag.js', () => ({
  tagMp3: vi.fn(async () => true),
  hasId3Title: vi.fn(async () => false),
}));

const { tagMp3, hasId3Title } = await import('../../lib/audio-tag.js');

const track: CanonicalTrack = {
  id: 'itunes:123',
  title: 'Song',
  artists: [{ id: 'a1', name: 'Artist', providerIds: {}, genres: [] }],
  album: {
    id: 'al1',
    title: 'Album',
    artist: { id: 'a1', name: 'Artist', providerIds: {}, genres: [] },
    trackCount: 1,
    providerIds: {},
    type: 'album',
  },
  durationMs: 200000,
  artworkUrl: 'https://x/cover.jpg',
  providerIds: {},
  explicit: false,
};

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    userId: 'user-1',
    trackId: track.id,
    trackTitle: track.title,
    trackArtist: 'Artist',
    trackArtwork: null,
    trackJson: null,
    quality: 'high',
    status: 'downloading',
    progress: 0,
    bytesDownloaded: 0n,
    bytesTotal: null,
    errorCode: null,
    errorMessage: null,
    provider: null,
    sourceUrl: null,
    localPath: null,
    createdAt: new Date(),
    startedAt: new Date(),
    completedAt: null,
    ...overrides,
  };
}

let resolver: { download: ReturnType<typeof vi.fn> };
let lyrics: { warmTrack: ReturnType<typeof vi.fn> };
let tmpDir: string;

beforeEach(async () => {
  vi.clearAllMocks();
  (tagMp3 as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  (hasId3Title as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(false);
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'sinc-dl-test-'));
  resolver = {
    download: vi.fn(async () => ({
      filePath: path.join(tmpDir, 'song.mp3'),
      provider: 'soundcloud',
      sourceUrl: 'https://sc/x',
    })),
  };
  lyrics = { warmTrack: vi.fn() };
});

describe('DownloadsService', () => {
  it('creates a fresh job, runs it, and marks it completed with source metadata', async () => {
    await writeFile(path.join(tmpDir, 'song.mp3'), Buffer.alloc(42));
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue(jobRow());
    mockUpdate.mockResolvedValue(jobRow({ status: 'completed', progress: 100 }));

    const svc = new DownloadsService(resolver as never, lyrics as never);
    const dto = await svc.startDownload('user-1', track);

    expect(dto.id).toBe('job-1');
    expect(mockCreate.mock.calls[0][0].data.trackJson).toEqual(track);
    await vi.waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'completed',
            progress: 100,
            bytesDownloaded: 42,
            provider: 'soundcloud',
            sourceUrl: 'https://sc/x',
          }),
        })
      )
    );
    expect(lyrics.warmTrack).toHaveBeenCalledWith(track);
  });

  it('marks the job failed (with a code) when resolution or download throws', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue(jobRow());
    resolver.download.mockRejectedValue(new Error('cancelled upstream'));

    const svc = new DownloadsService(resolver as never, lyrics as never);
    await svc.startDownload('user-1', track);
    await vi.waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'failed', errorCode: 'DOWNLOAD_FAILED' }),
        })
      )
    );
  });

  it('reuses a completed job and tags legacy files on demand', async () => {
    mockFindFirst.mockResolvedValue(
      jobRow({ status: 'completed', localPath: path.join(tmpDir, 'legacy.mp3') })
    );

    const svc = new DownloadsService(resolver as never, lyrics as never);
    const dto = await svc.startDownload('user-1', track);

    expect(dto.status).toBe('completed');
    expect(mockCreate).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(hasId3Title).toHaveBeenCalledWith(path.join(tmpDir, 'legacy.mp3'))
    );
    expect(tagMp3).toHaveBeenCalledWith(
      path.join(tmpDir, 'legacy.mp3'),
      expect.objectContaining({ title: 'Song', artist: 'Artist', album: 'Album' })
    );
  });

  it('recovers a stale downloading job by failing it and starting a new one', async () => {
    mockFindFirst.mockResolvedValue(
      jobRow({ status: 'downloading', startedAt: new Date(Date.now() - 10 * 60 * 60 * 1000) })
    );
    mockCreate.mockResolvedValue(jobRow({ id: 'job-2' }));

    const svc = new DownloadsService(resolver as never, lyrics as never);
    const dto = await svc.startDownload('user-1', track);

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { status: 'failed', errorMessage: 'Source resolution timed out' },
    });
    expect(dto.id).toBe('job-2');
  });

  it('lists a bounded history and maps bigints to numbers', async () => {
    mockFindMany.mockResolvedValue([jobRow({ status: 'completed' })]);

    const svc = new DownloadsService(resolver as never);
    const list = await svc.listByUser('user-1', { take: 9999 });
    expect(mockFindMany.mock.calls[0][0].take).toBe(200);
    expect(list[0]).toMatchObject({ trackTitle: 'Song', bytesDownloaded: 0 });
  });

  it('deletes the file when removing a job and 404s for others', async () => {
    mockFindFirst.mockResolvedValue(null);
    const svc = new DownloadsService(resolver as never);
    await expect(svc.remove('job-x', 'user-1')).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const file = path.join(tmpDir, 'real.mp3');
    await writeFile(file, 'x');
    mockFindFirst.mockResolvedValue(jobRow({ localPath: file }));
    mockDelete.mockResolvedValue({});
    await svc.remove('job-1', 'user-1');
    await expect(access(file)).rejects.toThrow();
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 'job-1' } });
  });

  it('only exposes file paths for completed jobs', async () => {
    mockFindFirst.mockResolvedValue(jobRow({ status: 'completed', localPath: '/tmp/song.mp3' }));
    const svc = new DownloadsService(resolver as never);
    expect(await svc.filePath('job-1', 'user-1')).toBe('/tmp/song.mp3');

    mockFindFirst.mockResolvedValue(jobRow({ status: 'failed' }));
    expect(await svc.filePath('job-1', 'user-1')).toBeNull();
  });
});
