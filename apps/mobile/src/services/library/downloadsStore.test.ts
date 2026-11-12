import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalTrack } from '@sinc/shared';
import type { NativeDownloadResult } from '../native/types';
import {
  useDownloadsStore,
  safeFileName,
  publicFileName,
  jobIdForTrack,
  formatSpeed,
  formatYtSpeed,
  isBadDownloadDuration,
  isTransientDownloadError,
  isFingerprintError,
  resetDirectSourceMissCache,
  resetDownloadQueueForTests,
} from './downloadsStore';

const {
  findArchive,
  findJamendo,
  findFma,
  previewMock,
  downloaderMock,
  ytMock,
  trackAnalytics,
  stageHandlers,
} = vi.hoisted(() => ({
  findArchive: vi.fn(),
  findJamendo: vi.fn(),
  findFma: vi.fn(),
  previewMock: vi.fn(),
  downloaderMock: {
    download: vi.fn((..._args: unknown[]): Promise<NativeDownloadResult> =>
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
  stageHandlers: [] as Array<(event: { jobId: string; stage: string }) => void>,
}));

vi.mock('../providers/download-source', () => ({
  findArchiveSource: findArchive,
  findJamendoSource: findJamendo,
  findFmaSource: findFma,
  searchTitle: (title: string) => title,
  extensionForDownloadSource: (source: { url: string }) => {
    const match = /\.([a-z0-9]{2,5})(?:\?|$)/i.exec(source.url);
    return match?.[1] ?? 'mp3';
  },
}));

vi.mock('../providers/preview', () => ({
  resolvePreviewUrl: previewMock,
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
      available: () => true,
      addActionListener: vi.fn(() => () => {}),
      addYtProgressListener: vi.fn(() => () => {}),
      addStageListener: (listener: (event: { jobId: string; stage: string }) => void) => {
        stageHandlers.push(listener);
        return () => {};
      },
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

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Holds each native transfer open so the scheduler can be observed. */
function holdDirectDownloads(): Map<string, Deferred<NativeDownloadResult>> {
  const gates = new Map<string, Deferred<NativeDownloadResult>>();
  downloaderMock.download.mockImplementation((...args: unknown[]) => {
    const jobId = args[0] as string;
    const gate = deferred<NativeDownloadResult>();
    gates.set(jobId, gate);
    return gate.promise;
  });
  return gates;
}

function completeDownload(gates: Map<string, Deferred<NativeDownloadResult>>, jobId: string): void {
  const gate = gates.get(jobId);
  if (!gate) throw new Error(`No held download for ${jobId}`);
  gate.resolve({
    localUri: `file:///data/sinc_downloads/${jobId}.mp3`,
    sizeBytes: 4321,
    durationMs: 180_000,
  });
}

function emitStage(jobId: string, stage: string): void {
  for (const handler of stageHandlers) handler({ jobId, stage });
}

function resetStore() {
  useDownloadsStore.setState({
    downloads: [],
    downloadedIds: new Set<string>(),
    pausedIds: new Set<string>(),
  });
}

beforeEach(() => {
  resetDownloadQueueForTests();
  resetStore();
  resetDirectSourceMissCache();
  findArchive.mockReset();
  findJamendo.mockReset();
  findFma.mockReset();
  previewMock.mockReset();
  previewMock.mockResolvedValue(null);
  downloaderMock.download.mockReset();
  downloaderMock.download.mockImplementation(async () => ({
    localUri: 'file:///sdcard/Sinc/song.mp3',
    sizeBytes: 1234,
    durationMs: 180_000,
  }));
  downloaderMock.remove.mockClear();
  ytMock.available.mockClear();
  ytMock.download.mockClear();
  trackAnalytics.mockClear();
});

describe('download file names', () => {
  it('keeps the source container instead of forcing .mp3', () => {
    const t = track('itunes:names');
    expect(safeFileName(t, 'ogg')).toMatch(/\.ogg$/);
    expect(publicFileName(t, 'flac')).toBe('Track itunes names.flac');
    expect(safeFileName(t, 'mp4')).toMatch(/\.mp4$/);
  });
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

  it('names and tags a direct download with its real container', async () => {
    const t = {
      ...track('itunes:ogg'),
      artworkUrl: 'https://images.test/cover.jpg',
    };
    findArchive.mockResolvedValueOnce({
      url: 'https://archive.org/download/x/song.ogg',
      provider: 'archive',
      mimeType: 'audio/ogg',
    });
    downloaderMock.download.mockResolvedValueOnce({
      localUri: 'file:///data/sinc_downloads/song.ogg',
      sizeBytes: 4321,
      durationMs: 180_000,
      mimeType: 'audio/ogg',
      publishedName: 'Track itunes:ogg.ogg',
    });

    await useDownloadsStore.getState().downloadTrack(t);

    const call = downloaderMock.download.mock.calls[0] as unknown as [
      string,
      string,
      unknown,
      string,
      { publicFileName?: string; artworkUrl?: string },
      boolean,
    ];
    expect(call[3]).toBe(safeFileName(t, 'ogg'));
    expect(call[4].publicFileName).toBe(publicFileName(t, 'ogg'));
    expect(call[4].artworkUrl).toBe('https://images.test/cover.jpg');
    expect(useDownloadsStore.getState().getDownload(t.id)?.publishedName).toBe(
      'Track itunes:ogg.ogg'
    );
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

  it('ignores unverified provider URLs and resolves by strict search instead', async () => {
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
    // A catalog provider id can point at a cover/re-upload; the engine must
    // search and validate the candidate instead of downloading it blindly.
    expect(called[1]).toContain('Artist');
    expect(called[1]).toContain('Track youtube:1');
    expect(called[4]).toBeNull();
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

  it('caps concurrent transfers at two and marks overflow as queued', async () => {
    const gates = holdDirectDownloads();
    findArchive.mockImplementation(async (candidate: CanonicalTrack) => ({
      url: `https://archive.org/download/${candidate.id}.mp3`,
      provider: 'archive',
      mimeType: 'audio/mpeg',
    }));
    const tracks = ['queue-a', 'queue-b', 'queue-c'].map(track);
    const pending = tracks.map((candidate) =>
      useDownloadsStore.getState().downloadTrack(candidate)
    );

    await vi.waitFor(() => expect(downloaderMock.download).toHaveBeenCalledTimes(2));
    expect(useDownloadsStore.getState().getDownload('queue-a')?.phase).toBe('transfer');
    expect(useDownloadsStore.getState().getDownload('queue-b')?.phase).toBe('transfer');
    expect(useDownloadsStore.getState().getDownload('queue-c')?.phase).toBe('queued');

    completeDownload(gates, jobIdForTrack(tracks[0]));
    await vi.waitFor(() => expect(downloaderMock.download).toHaveBeenCalledTimes(3));
    expect(useDownloadsStore.getState().getDownload('queue-c')?.phase).toBe('transfer');

    completeDownload(gates, jobIdForTrack(tracks[1]));
    completeDownload(gates, jobIdForTrack(tracks[2]));
    await Promise.all(pending);
    expect(useDownloadsStore.getState().downloads.every((d) => d.phase === 'completed')).toBe(true);
  });

  it('reports post-transfer stages monotonically and ignores stale events', async () => {
    const gates = holdDirectDownloads();
    findArchive.mockResolvedValue({
      url: 'https://archive.org/download/x/staged.mp3',
      provider: 'archive',
      mimeType: 'audio/mpeg',
    });
    const t = track('itunes:staged');
    const pending = useDownloadsStore.getState().downloadTrack(t);
    await vi.waitFor(() => expect(downloaderMock.download).toHaveBeenCalledTimes(1));
    const jobId = jobIdForTrack(t);

    emitStage(jobId, 'processing');
    expect(useDownloadsStore.getState().getDownload(t.id)?.phase).toBe('processing');
    emitStage(jobId, 'tagging');
    expect(useDownloadsStore.getState().getDownload(t.id)?.phase).toBe('tagging');
    emitStage(jobId, 'validating');
    expect(useDownloadsStore.getState().getDownload(t.id)?.phase).toBe('validating');
    // Late, duplicate and malformed events must not move the row backwards.
    emitStage(jobId, 'tagging');
    emitStage(jobId, 'processing');
    emitStage(jobId, 'not-a-stage');
    expect(useDownloadsStore.getState().getDownload(t.id)?.phase).toBe('validating');

    completeDownload(gates, jobId);
    await pending;
    expect(useDownloadsStore.getState().getDownload(t.id)?.phase).toBe('completed');
    emitStage(jobId, 'validating');
    expect(useDownloadsStore.getState().getDownload(t.id)?.phase).toBe('completed');
  });

  it('starts a user tap before an earlier bulk import', async () => {
    const gates = holdDirectDownloads();
    findArchive.mockImplementation(async (candidate: CanonicalTrack) => ({
      url: `https://archive.org/download/${candidate.id}.mp3`,
      provider: 'archive',
      mimeType: 'audio/mpeg',
    }));
    const [activeA, activeB, bulk, userTap] = ['prio-a', 'prio-b', 'prio-bulk', 'prio-user'].map(
      track
    );
    const pending = [
      useDownloadsStore.getState().downloadTrack(activeA),
      useDownloadsStore.getState().downloadTrack(activeB),
    ];
    await vi.waitFor(() => expect(downloaderMock.download).toHaveBeenCalledTimes(2));

    pending.push(useDownloadsStore.getState().downloadTrack(bulk, { priority: 'bulk' }));
    pending.push(useDownloadsStore.getState().downloadTrack(userTap));
    await vi.waitFor(() => {
      expect(useDownloadsStore.getState().getDownload(bulk.id)?.phase).toBe('queued');
      expect(useDownloadsStore.getState().getDownload(userTap.id)?.phase).toBe('queued');
    });

    completeDownload(gates, jobIdForTrack(activeA));
    await vi.waitFor(() => expect(downloaderMock.download).toHaveBeenCalledTimes(3));
    const thirdJobId = downloaderMock.download.mock.calls[2][0] as string;
    expect(thirdJobId).toBe(jobIdForTrack(userTap));
    expect(useDownloadsStore.getState().getDownload(bulk.id)?.phase).toBe('queued');

    completeDownload(gates, jobIdForTrack(activeB));
    await vi.waitFor(() => expect(downloaderMock.download).toHaveBeenCalledTimes(4));
    expect(downloaderMock.download.mock.calls[3][0]).toBe(jobIdForTrack(bulk));

    completeDownload(gates, jobIdForTrack(userTap));
    completeDownload(gates, jobIdForTrack(bulk));
    await Promise.all(pending);
    expect(useDownloadsStore.getState().getDownload(userTap.id)?.phase).toBe('completed');
    expect(useDownloadsStore.getState().getDownload(bulk.id)?.phase).toBe('completed');
  });

  it('cancels a queued download before it reaches the native bridge', async () => {
    const gates = holdDirectDownloads();
    findArchive.mockImplementation(async (candidate: CanonicalTrack) => ({
      url: `https://archive.org/download/${candidate.id}.mp3`,
      provider: 'archive',
      mimeType: 'audio/mpeg',
    }));
    const tracks = ['cancel-q-a', 'cancel-q-b', 'cancel-q-c'].map(track);
    const first = useDownloadsStore.getState().downloadTrack(tracks[0]);
    const second = useDownloadsStore.getState().downloadTrack(tracks[1]);
    const third = useDownloadsStore.getState().downloadTrack(tracks[2]);
    await vi.waitFor(() => expect(downloaderMock.download).toHaveBeenCalledTimes(2));
    const queued = useDownloadsStore.getState().getDownload(tracks[2].id)!;
    expect(queued.phase).toBe('queued');

    await useDownloadsStore.getState().cancelDownload(queued.jobId);
    await third;
    expect(useDownloadsStore.getState().getDownload(tracks[2].id)).toBeUndefined();
    expect(downloaderMock.download).toHaveBeenCalledTimes(2);

    completeDownload(gates, jobIdForTrack(tracks[0]));
    completeDownload(gates, jobIdForTrack(tracks[1]));
    await Promise.all([first, second]);
  });

  it('keeps a paused queued download out of the scheduler until resumed', async () => {
    const gates = holdDirectDownloads();
    findArchive.mockImplementation(async (candidate: CanonicalTrack) => ({
      url: `https://archive.org/download/${candidate.id}.mp3`,
      provider: 'archive',
      mimeType: 'audio/mpeg',
    }));
    const tracks = ['pause-q-a', 'pause-q-b', 'pause-q-c'].map(track);
    const first = useDownloadsStore.getState().downloadTrack(tracks[0]);
    const second = useDownloadsStore.getState().downloadTrack(tracks[1]);
    const third = useDownloadsStore.getState().downloadTrack(tracks[2]);
    await vi.waitFor(() => expect(downloaderMock.download).toHaveBeenCalledTimes(2));
    const queued = useDownloadsStore.getState().getDownload(tracks[2].id)!;
    expect(queued.phase).toBe('queued');

    await useDownloadsStore.getState().pauseDownload(queued.jobId);
    await third;
    expect(useDownloadsStore.getState().pausedIds.has(queued.jobId)).toBe(true);

    completeDownload(gates, jobIdForTrack(tracks[0]));
    await vi.waitFor(() =>
      expect(useDownloadsStore.getState().getDownload(tracks[1].id)?.phase).toBe('transfer')
    );
    expect(downloaderMock.download).toHaveBeenCalledTimes(2);

    const resumed = useDownloadsStore.getState().resumeDownload(queued.jobId);
    await vi.waitFor(() => expect(downloaderMock.download).toHaveBeenCalledTimes(3));
    expect(useDownloadsStore.getState().getDownload(tracks[2].id)?.phase).toBe('transfer');

    completeDownload(gates, jobIdForTrack(tracks[1]));
    completeDownload(gates, jobIdForTrack(tracks[2]));
    await Promise.all([first, second, resumed]);
    expect(useDownloadsStore.getState().getDownload(tracks[2].id)?.phase).toBe('completed');
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
    expect(isBadDownloadDuration(0, 180_000)).toBe(true); // unverified → fail closed
    expect(isBadDownloadDuration(180_000, undefined)).toBe(false);
    expect(isBadDownloadDuration(180_000, 180_000)).toBe(false);
    expect(isBadDownloadDuration(174_000, 175_000)).toBe(false); // 1s intro difference
    expect(isBadDownloadDuration(30_000, 180_000)).toBe(true); // 0.17x of expected
    expect(isBadDownloadDuration(198_000, 210_000)).toBe(true); // 12s off a 3:30 track
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

  it('falls through to yt-dlp when the native layer rejects the direct file length', async () => {
    findArchive.mockResolvedValueOnce({
      url: 'https://archive.org/download/x/wrong-song.mp3',
      provider: 'archive',
      mimeType: 'audio/mpeg',
      expectedDurationMs: 180_000,
    });
    downloaderMock.download.mockRejectedValueOnce(
      Object.assign(new Error('Downloaded file does not match the requested track length'), {
        code: 'DOWNLOAD_UNVERIFIED',
      })
    );
    await useDownloadsStore.getState().downloadTrack(track('itunes:1'));

    expect(downloaderMock.download).toHaveBeenCalledTimes(1);
    expect(ytMock.download).toHaveBeenCalledTimes(1);
    expect(useDownloadsStore.getState().getDownload('itunes:1')?.phase).toBe('completed');
  });

  it('passes the trusted catalog preview to the direct and engine tiers', async () => {
    previewMock.mockResolvedValueOnce('https://preview.test/track.m4a');
    findArchive.mockResolvedValueOnce({
      url: 'https://archive.org/download/x/song.mp3',
      provider: 'archive',
      mimeType: 'audio/mpeg',
    });
    await useDownloadsStore.getState().downloadTrack(track('itunes:preview-direct'));
    expect(downloaderMock.download.mock.calls[0][4]).toMatchObject({
      previewUrl: 'https://preview.test/track.m4a',
    });

    resetStore();
    findArchive.mockResolvedValueOnce(null);
    findJamendo.mockResolvedValueOnce(null);
    findFma.mockResolvedValueOnce(null);
    previewMock.mockResolvedValueOnce('https://preview.test/track2.m4a');
    await useDownloadsStore.getState().downloadTrack(track('itunes:preview-engine'));
    const called = ytMock.download.mock.calls[0] as unknown[];
    expect(called[11]).toBe('https://preview.test/track2.m4a');
  });

  it('falls through to yt-dlp when the direct audio fails fingerprint verification', async () => {
    findArchive.mockResolvedValueOnce({
      url: 'https://archive.org/download/x/wrong-recording.mp3',
      provider: 'archive',
      mimeType: 'audio/mpeg',
    });
    downloaderMock.download.mockRejectedValueOnce(
      Object.assign(new Error('Downloaded audio does not match the selected recording'), {
        code: 'DOWNLOAD_FINGERPRINT_MISMATCH',
      })
    );
    await useDownloadsStore.getState().downloadTrack(track('itunes:fingerprint-direct'));

    expect(downloaderMock.download).toHaveBeenCalledTimes(1);
    expect(ytMock.download).toHaveBeenCalledTimes(1);
    expect(useDownloadsStore.getState().getDownload('itunes:fingerprint-direct')?.phase).toBe(
      'completed'
    );
  });

  it('retries the engine once without the rejected direct source after a fingerprint mismatch', async () => {
    findArchive.mockResolvedValueOnce({
      url: 'https://archive.org/download/x/wrong-recording.mp3',
      provider: 'archive',
      mimeType: 'audio/mpeg',
    });
    downloaderMock.download.mockRejectedValueOnce(
      Object.assign(new Error(''), { code: 'DOWNLOAD_FINGERPRINT_MISMATCH' })
    );
    ytMock.download
      .mockRejectedValueOnce(
        Object.assign(new Error(''), { code: 'DOWNLOAD_FINGERPRINT_MISMATCH' })
      )
      .mockResolvedValueOnce({
        localUri: 'file:///sdcard/Sinc/right.mp3',
        durationMs: 180_000,
        mimeType: 'audio/mpeg',
      });

    await useDownloadsStore.getState().downloadTrack(track('itunes:fingerprint-retry'));

    // The direct source is not searched or downloaded again; the engine gets
    // one fresh resolution and succeeds.
    expect(findArchive).toHaveBeenCalledTimes(1);
    expect(downloaderMock.download).toHaveBeenCalledTimes(1);
    expect(ytMock.download).toHaveBeenCalledTimes(2);
    expect(useDownloadsStore.getState().getDownload('itunes:fingerprint-retry')?.phase).toBe(
      'completed'
    );
  });

  it('classifies fingerprint rejections from both the code and the message', () => {
    expect(
      isFingerprintError(Object.assign(new Error(''), { code: 'DOWNLOAD_FINGERPRINT_MISMATCH' }))
    ).toBe(true);
    expect(isFingerprintError(new Error('Could not verify DOWNLOAD_FINGERPRINT_UNAVAILABLE'))).toBe(
      true
    );
    expect(isFingerprintError(new Error('HTTP_500'))).toBe(false);
    expect(isFingerprintError(Object.assign(new Error(''), { code: 'HTTP_401' }))).toBe(false);
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

  it('resumes a direct transfer from the original URL instead of re-searching', async () => {
    const sourceA = {
      url: 'https://archive.org/download/a/a.mp3',
      provider: 'archive',
      mimeType: 'audio/mpeg',
      expectedDurationMs: 180_000,
    };
    findArchive.mockResolvedValueOnce(sourceA);
    downloaderMock.download.mockRejectedValueOnce(
      new Error('network unreachable during direct transfer')
    );

    await useDownloadsStore.getState().downloadTrack(track('itunes:resume-direct'));
    const row = useDownloadsStore.getState().getDownload('itunes:resume-direct');
    expect(row?.phase).toBe('source');
    expect(row?.error).toBe('Waiting for connection…');
    expect(findArchive).toHaveBeenCalledTimes(1);

    await useDownloadsStore.getState().pauseDownload(row!.jobId);
    // If the provider were searched again it would return a different upload;
    // the resume must keep appending to the part from the original URL.
    findArchive.mockResolvedValueOnce({
      url: 'https://archive.org/download/b/b.mp3',
      provider: 'archive',
      mimeType: 'audio/mpeg',
      expectedDurationMs: 180_000,
    });
    await useDownloadsStore.getState().resumeDownload(row!.jobId);

    expect(findArchive).toHaveBeenCalledTimes(1);
    const secondCall = downloaderMock.download.mock.calls[1] as unknown as [
      string,
      string,
      unknown,
      unknown,
      unknown,
      boolean,
    ];
    expect(secondCall[1]).toBe(sourceA.url);
    expect(secondCall[5]).toBe(true);
    expect(useDownloadsStore.getState().getDownload('itunes:resume-direct')?.phase).toBe(
      'completed'
    );
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

  it('cancelDownload cleans up a job that never produced a localUri', async () => {
    const t = track('itunes:cancel-partial');
    let rejectDownload: ((error: Error) => void) | undefined;
    downloaderMock.download.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectDownload = reject;
        })
    );
    findArchive.mockResolvedValueOnce({
      url: 'https://archive.org/download/x/song.mp3',
      provider: 'archive',
      mimeType: 'audio/mpeg',
    });

    const pending = useDownloadsStore.getState().downloadTrack(t);
    await vi.waitFor(() => {
      expect(useDownloadsStore.getState().getDownload(t.id)?.phase).toBe('transfer');
    });
    const record = useDownloadsStore.getState().getDownload(t.id);
    expect(record?.localUri).toBeUndefined();

    await useDownloadsStore.getState().cancelDownload(record!.jobId);

    // Cancelling only killed the native process before; the .part and the
    // never-published private file were left behind with no record pointing
    // at them.
    expect(downloaderMock.remove).toHaveBeenCalledWith(
      record!.jobId,
      safeFileName(t),
      publicFileName(t)
    );
    expect(useDownloadsStore.getState().getDownload(t.id)).toBeUndefined();

    rejectDownload?.(
      Object.assign(new Error('Download cancelled'), { code: 'DOWNLOAD_CANCELLED' })
    );
    await pending;
  });

  it('does not mark a native user-cancel as a failed download', async () => {
    findArchive.mockResolvedValueOnce({
      url: 'https://archive.org/download/x/song.mp3',
      provider: 'archive',
      mimeType: 'audio/mpeg',
    });
    downloaderMock.download.mockRejectedValueOnce(
      Object.assign(new Error('Download cancelled'), { code: 'DOWNLOAD_CANCELLED' })
    );

    await useDownloadsStore.getState().downloadTrack(track('itunes:cancel'));

    // The notification action event may arrive after the native rejection;
    // the row must stay resumable rather than flip to failed.
    expect(useDownloadsStore.getState().getDownload('itunes:cancel')?.phase).not.toBe('failed');
    expect(trackAnalytics).not.toHaveBeenCalledWith(
      'download:failed',
      'itunes:cancel',
      expect.anything()
    );
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

  it('resumes an active download after the native pause settles', async () => {
    const gates = holdDirectDownloads();
    findArchive.mockResolvedValue({
      url: 'https://archive.org/download/x/active-pause.mp3',
      provider: 'archive',
      mimeType: 'audio/mpeg',
    });
    const t = track('itunes:active-pause');
    const first = useDownloadsStore.getState().downloadTrack(t);
    await vi.waitFor(() => expect(downloaderMock.download).toHaveBeenCalledTimes(1));
    const row = useDownloadsStore.getState().getDownload(t.id)!;
    const gate = gates.get(row.jobId);
    expect(gate).toBeDefined();

    await useDownloadsStore.getState().pauseDownload(row.jobId);
    expect(useDownloadsStore.getState().pausedIds.has(row.jobId)).toBe(true);
    gate!.reject(Object.assign(new Error('Download cancelled'), { code: 'DOWNLOAD_CANCELLED' }));
    await first;

    const resumed = useDownloadsStore.getState().resumeDownload(row.jobId);
    await vi.waitFor(() => expect(downloaderMock.download).toHaveBeenCalledTimes(2));
    completeDownload(gates, row.jobId);
    await resumed;
    expect(useDownloadsStore.getState().getDownload(t.id)?.phase).toBe('completed');
  });

  it('resumes a persisted queued job on the next launch without stale parts', async () => {
    const t = track('itunes:1');
    useDownloadsStore.setState({
      downloads: [
        { jobId: jobIdForTrack(t), track: t, phase: 'queued', progress: 0, createdAt: Date.now() },
      ],
    });
    findArchive.mockResolvedValue({
      url: 'https://archive.org/download/x/song.mp3',
      provider: 'archive',
      mimeType: 'audio/mpeg',
    });
    await useDownloadsStore.getState().resumeInFlight();
    expect(useDownloadsStore.getState().getDownload('itunes:1')?.phase).toBe('completed');
    // A new process cannot prove which source produced the old partial, so it
    // must start a fresh transfer instead of appending new bytes to it.
    const call = downloaderMock.download.mock.calls[0] as unknown[];
    expect(call[5]).toBe(false);
  });
});
