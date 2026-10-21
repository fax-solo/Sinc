import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalTrack } from '@sinc/shared';
import {
  useDownloadsStore,
  safeFileName,
  jobIdForTrack,
  formatSpeed,
  formatYtSpeed,
  isBadDownloadDuration,
  isTransientDownloadError,
  resetDirectSourceMissCache,
} from './downloadsStore';

const { findArchive, findJamendo, findFma, downloaderMock, ytMock, trackAnalytics } = vi.hoisted(
  () => ({
    findArchive: vi.fn(),
    findJamendo: vi.fn(),
    findFma: vi.fn(),
    downloaderMock: {
      download: vi.fn((..._args: unknown[]) =>
        Promise.resolve({
          localUri: 'file:///sdcard/Sinc/song.mp3',
          sizeBytes: 1234,
          durationMs: 180_000,
        })
      ),
      remove: vi.fn((..._args: unknown[]) => Promise.resolve(undefined)),
    },
    ytMock: {
      available: vi.fn(() => true),
      resolveStream: vi.fn(),
      resolveByQuery: vi.fn(),
      download: vi.fn(async () => ({
        localUri: 'file:///sdcard/Sinc/dl.mp3',
        durationMs: 180000,
        mimeType: 'audio/mpeg',
      })),
    },
    trackAnalytics: vi.fn(),
  })
);

vi.mock('../providers/download-source', () => ({
  findArchiveSource: findArchive,
  findJamendoSource: findJamendo,
  findFmaSource: findFma,
  searchTitle: (title: string) => title,
}));

vi.mock('../native', () => ({
  nativeBridge: {
    player: { available: () => false },
    downloader: {
      available: () => true,
      download: downloaderMock.download,
      remove: downloaderMock.remove,
      addProgressListener: vi.fn(() => undefined),
      removeProgressListener: vi.fn(() => undefined),
    },
    yt: ytMock,
    downloads: {
      available: () => false,
      addActionListener: vi.fn(() => () => {}),
      addYtProgressListener: vi.fn(() => () => {}),
    },
  },
}));

vi.mock('../analytics/analytics', () => ({ track: (...a: unknown[]) => trackAnalytics(...a) }));

vi.mock('../lyrics/lyricsStore', () => ({
  useLyricsStore: { getState: () => ({ loadLyrics: vi.fn(async () => null) }) },
}));

function track(id: string): CanonicalTrack {
  return {
    id,
    title: `Track ${id}`,
    artists: [{ id: `a-${id}`, name: 'Artist', providerIds: {}, genres: [] }],
    durationMs: 180000,
    artworkUrl: undefined,
    providerIds: { itunes: id },
    explicit: false,
  };
}

function resetStore() {
  useDownloadsStore.setState({ downloads: [] });
}

beforeEach(() => {
  resetStore();
  resetDirectSourceMissCache();
  findArchive.mockReset();
  findJamendo.mockReset();
  findFma.mockReset();
  downloaderMock.download.mockClear();
  downloaderMock.remove.mockClear();
  ytMock.available.mockClear();
  ytMock.download.mockClear();
  trackAnalytics.mockClear();
});

describe('downloadsStore (local)', () => {
  it('downloads through a direct Archive source via the native downloader', async () => {
    findArchive.mockResolvedValueOnce({
      url: 'https://archive.org/download/x/song.mp3',
      provider: 'archive',
      mimeType: 'audio/mpeg',
    });
    await useDownloadsStore.getState().downloadTrack(track('itunes:1'));

    const record = useDownloadsStore.getState().getDownload('itunes:1');
    expect(record?.phase).toBe('completed');
    expect(record?.provider).toBe('archive');
    expect(record?.localUri).toBe('file:///sdcard/Sinc/song.mp3');
    expect(downloaderMock.download).toHaveBeenCalledTimes(1);
    expect(useDownloadsStore.getState().isDownloaded('itunes:1')).toBe(true);
    expect(trackAnalytics).toHaveBeenCalledWith('download:complete', 'itunes:1', expect.anything());
  });

  it('falls back to the on-device yt-dlp engine without any direct source', async () => {
    findArchive.mockResolvedValueOnce(null);
    findJamendo.mockResolvedValueOnce(null);
    findFma.mockResolvedValueOnce(null);
    await useDownloadsStore.getState().downloadTrack(track('itunes:1'));

    const record = useDownloadsStore.getState().getDownload('itunes:1');
    expect(record?.phase).toBe('completed');
    expect(ytMock.download).toHaveBeenCalledTimes(1);
    const called = ytMock.download.mock.calls[0] as unknown as [
      string,
      string,
      string,
      number,
      unknown,
    ];
    expect(called[0]).toBe(jobIdForTrack(track('itunes:1')));
    expect(called[1]).toContain('Artist');
    expect(called[1]).toContain('Track itunes:1');
    expect(called[2]).toBe(safeFileName(track('itunes:1')));
  });

  it('reuses a known soundcloud url for yt-dlp downloads', async () => {
    const t = track('youtube:1');
    t.providerIds.soundcloud = 'https://soundcloud.com/a/b';
    findArchive.mockResolvedValueOnce(null);
    await useDownloadsStore.getState().downloadTrack(t);

    const called = ytMock.download.mock.calls[0] as unknown as [
      string,
      string,
      string,
      number,
      unknown,
    ];
    expect(called[1]).toBe('');
    expect(called[4]).toBe('https://soundcloud.com/a/b');
  });

  it('does not duplicate in-flight downloads', async () => {
    const t = track('itunes:9');
    findArchive.mockImplementation(async () => null);
    const first = useDownloadsStore.getState().downloadTrack(t);
    void useDownloadsStore.getState().downloadTrack(t);
    await first;
    const full = useDownloadsStore.getState().downloads;
    expect(full.filter((d) => d.track.id === 'itunes:9')).toHaveLength(1);
  });

  it('removes a completed download and its file', async () => {
    findArchive.mockResolvedValue({
      url: 'https://archive.org/download/x/song.mp3',
      provider: 'archive',
      mimeType: 'audio/mpeg',
    });
    await useDownloadsStore.getState().downloadTrack(track('itunes:1'));
    const record = useDownloadsStore.getState().getDownload('itunes:1')!;

    await useDownloadsStore.getState().removeDownload(record.jobId);
    expect(useDownloadsStore.getState().getDownload('itunes:1')).toBeUndefined();
    // Third arg: the published Music/Sinc copy's display name, so the
    // MediaStore ghost entry gets cleaned up too.
    expect(downloaderMock.remove).toHaveBeenCalledWith(
      record.jobId,
      'song.mp3',
      expect.any(String)
    );
  });

  it('rejects a direct download whose probed duration is wrong', () => {
    expect(isBadDownloadDuration(30_000, null)).toBe(true); // preview-length
    expect(isBadDownloadDuration(0, 180_000)).toBe(false); // probe unavailable → accept
    expect(isBadDownloadDuration(180_000, undefined)).toBe(false);
    expect(isBadDownloadDuration(180_000, 180_000)).toBe(false);
    expect(isBadDownloadDuration(30_000, 180_000)).toBe(true); // 0.17x of expected
    expect(isBadDownloadDuration(500_000, 180_000)).toBe(true); // 2.8x of expected
    expect(isBadDownloadDuration(25 * 60 * 1000, null)).toBe(true); // 25min song?
    expect(isBadDownloadDuration(10 * 60 * 1000, null)).toBe(false);
  });

  it('falls through to yt-dlp when a direct source downloads a bad-length file', async () => {
    findArchive.mockResolvedValue({
      url: 'https://archive.org/download/x/song.mp3',
      provider: 'archive',
      mimeType: 'audio/mpeg',
      expectedDurationMs: 180_000,
    });
    downloaderMock.download.mockResolvedValueOnce({
      localUri: 'file:///sdcard/Sinc/song.mp3',
      sizeBytes: 999,
      durationMs: 30_000, // probed: a preview/compilation segment, not the song
    });
    await useDownloadsStore.getState().downloadTrack(track('itunes:1'));

    expect(downloaderMock.remove).toHaveBeenCalledTimes(1); // bad file cleaned up
    expect(ytMock.download).toHaveBeenCalledTimes(1); // fell through to the engine
    expect(useDownloadsStore.getState().getDownload('itunes:1')?.phase).toBe('completed');
  });

  it('falls back to yt-dlp when the direct source transfer fails with an HTTP error', async () => {
    findArchive.mockResolvedValue({
      url: 'https://archive.org/download/x/song.mp3',
      provider: 'archive',
      mimeType: 'audio/mpeg',
    });
    downloaderMock.download.mockRejectedValueOnce(
      Object.assign(new Error('HTTP_401'), { code: 'HTTP_401' })
    );
    await useDownloadsStore.getState().downloadTrack(track('itunes:1'));

    // The file host rejected the url, so the engine tier must rescue the job.
    expect(downloaderMock.download).toHaveBeenCalledTimes(1);
    expect(ytMock.download).toHaveBeenCalledTimes(1);
    expect(useDownloadsStore.getState().getDownload('itunes:1')?.phase).toBe('completed');
  });

  it('falls back to yt-dlp when the bridge error carries the status in code with an empty message', async () => {
    // RN bridge rejects carry `code: 'HTTP_401'` and an EMPTY message.
    findArchive.mockResolvedValue({
      url: 'https://archive.org/download/x/song.mp3',
      provider: 'archive',
      mimeType: 'audio/mpeg',
    });
    downloaderMock.download.mockRejectedValueOnce(
      Object.assign(new Error(''), { code: 'HTTP_401' })
    );
    await useDownloadsStore.getState().downloadTrack(track('itunes:empty-message'));

    expect(downloaderMock.download).toHaveBeenCalledTimes(1);
    expect(ytMock.download).toHaveBeenCalledTimes(1);
    expect(useDownloadsStore.getState().getDownload('itunes:empty-message')?.phase).toBe(
      'completed'
    );
  });

  it('parks the job instead of failing when the link collapses during the engine lookup', async () => {
    // Flapping Wi-Fi: DNS/route gone — the engine lookup can't run, which is
    // not a verdict about the track. The job must wait, not die.
    findArchive.mockResolvedValue(null);
    findJamendo.mockResolvedValue(null);
    findFma.mockResolvedValue(null);
    ytMock.download.mockRejectedValueOnce(
      new Error('Network was unreachable during the source lookup')
    );
    await useDownloadsStore.getState().downloadTrack(track('itunes:park'));

    const row = useDownloadsStore.getState().getDownload('itunes:park');
    expect(row?.phase).toBe('source');
    expect(row?.error).toBe('Waiting for connection…');
    expect(row?.phase).not.toBe('failed');

    // Regression: Pause must work on parked rows (no active worker) — the
    // old activeJobs guard made the button a dead no-op while the park
    // poller kept reviving the job against the user's wishes.
    await useDownloadsStore.getState().pauseDownload(row!.jobId);
    expect(useDownloadsStore.getState().pausedIds.has(row!.jobId)).toBe(true);

    // And resume brings it back.
    findArchive.mockResolvedValueOnce({
      url: 'https://archive.org/download/x/song.mp3',
      provider: 'archive',
      mimeType: 'audio/mpeg',
    });
    await useDownloadsStore.getState().resumeDownload(row!.jobId);
    expect(useDownloadsStore.getState().getDownload('itunes:park')?.phase).toBe('completed');
  });

  it('removeDownload drops the row and cleans native files', async () => {
    findArchive.mockResolvedValueOnce({
      url: 'https://archive.org/download/x/song.mp3',
      provider: 'archive',
      mimeType: 'audio/mpeg',
    });
    await useDownloadsStore.getState().downloadTrack(track('itunes:rm'));
    expect(useDownloadsStore.getState().isDownloaded('itunes:rm')).toBe(true);

    await useDownloadsStore.getState().removeDownload(jobIdForTrack(track('itunes:rm')));
    expect(downloaderMock.remove).toHaveBeenCalled();
    expect(useDownloadsStore.getState().getDownload('itunes:rm')).toBeUndefined();
    expect(useDownloadsStore.getState().isDownloaded('itunes:rm')).toBe(false);
  });

  it('removeDownload is a no-op for unknown job ids', async () => {
    await expect(
      useDownloadsStore.getState().removeDownload('missing-job')
    ).resolves.toBeUndefined();
  });

  it('marks failures permanent and reports them', async () => {
    findArchive.mockResolvedValueOnce(null);
    ytMock.available.mockReturnValueOnce(false);
    await useDownloadsStore.getState().downloadTrack(track('itunes:1'));
    expect(useDownloadsStore.getState().getDownload('itunes:1')?.phase).toBe('failed');
    expect(trackAnalytics).toHaveBeenCalledWith('download:failed', 'itunes:1', expect.anything());
  });

  it('classifies transient vs definitive transfer errors', () => {
    expect(isTransientDownloadError(new Error('yt-dlp timed out'))).toBe(true);
    expect(isTransientDownloadError(new Error('Failed to connect to server'))).toBe(true);
    expect(isTransientDownloadError(new Error('Connection reset by peer'))).toBe(true);
    expect(isTransientDownloadError(new Error('HTTP_500'))).toBe(true);
    expect(isTransientDownloadError(new Error('HTTP_503'))).toBe(true);
    expect(isTransientDownloadError(new Error('HTTP_403'))).toBe(false);
    expect(isTransientDownloadError(new Error('HTTP_404'))).toBe(false);
    expect(
      isTransientDownloadError(new Error('No downloadable source was found for this track'))
    ).toBe(false);
  });

  it('auto-retries a transient transfer error and resumes from the part', async () => {
    vi.useFakeTimers();
    try {
      findArchive.mockResolvedValue(null); // no direct source → yt path
      ytMock.download.mockRejectedValueOnce(new Error('yt-dlp timed out')).mockResolvedValueOnce({
        localUri: 'file:///sdcard/Sinc/dl.mp3',
        durationMs: 180_000,
        mimeType: 'audio/mpeg',
      });
      const pending = useDownloadsStore.getState().downloadTrack(track('itunes:1'));
      await vi.advanceTimersByTimeAsync(5_000); // first backoff window
      await pending;

      expect(ytMock.download).toHaveBeenCalledTimes(2);
      // The retry continues from the surviving `.part` rather than restarting.
      const secondCall = ytMock.download.mock.calls[1] as unknown[];
      expect(secondCall[6]).toBe(true);
      expect(useDownloadsStore.getState().getDownload('itunes:1')?.phase).toBe('completed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('retryDownload re-runs a failed job', async () => {
    const t = track('itunes:1');
    findArchive.mockResolvedValue(null);
    ytMock.available.mockReturnValue(false);
    await useDownloadsStore.getState().downloadTrack(t);
    expect(useDownloadsStore.getState().getDownload('itunes:1')?.phase).toBe('failed');

    ytMock.available.mockReturnValue(true);
    await useDownloadsStore.getState().retryDownload(jobIdForTrack(t));
    expect(useDownloadsStore.getState().getDownload('itunes:1')?.phase).toBe('completed');
  });

  it('formats transfer speeds for display', () => {
    expect(formatSpeed(null)).toBeNull();
    expect(formatSpeed(0)).toBeNull();
    expect(formatSpeed(512)).toBe('512 B/s');
    expect(formatSpeed(214 * 1024)).toBe('214 KiB/s');
    expect(formatSpeed(234.5 * 1024)).toBe('235 KiB/s');
    expect(formatSpeed(3.2 * 1024 * 1024)).toBe('3.2 MiB/s');
  });

  it('normalizes yt-dlp speed tokens for display', () => {
    expect(formatYtSpeed(null)).toBeNull();
    expect(formatYtSpeed('214.55KiB/s')).toBe('215 KiB/s');
    expect(formatYtSpeed('1.23 MiB/s')).toBe('1.2 MiB/s');
    expect(formatYtSpeed('512 B/s')).toBe('512 B/s');
    expect(formatYtSpeed('garbage')).toBe('garbage');
  });

  it('resumeWaiting is a no-op with nothing parked', async () => {
    await useDownloadsStore.getState().resumeWaiting();
    expect(useDownloadsStore.getState().downloads).toHaveLength(0);
  });

  it('resumes in-flight downloads on the next launch', async () => {
    const t = track('itunes:1');
    useDownloadsStore.setState({
      downloads: [
        { jobId: jobIdForTrack(t), track: t, phase: 'source', progress: 0, createdAt: Date.now() },
      ],
    });
    findArchive.mockResolvedValue({
      url: 'https://archive.org/download/x/song.mp3',
      provider: 'archive',
      mimeType: 'audio/mpeg',
    });
    await useDownloadsStore.getState().resumeInFlight();
    expect(useDownloadsStore.getState().getDownload('itunes:1')?.phase).toBe('completed');
  });
});
