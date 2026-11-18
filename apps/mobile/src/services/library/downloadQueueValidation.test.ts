import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalTrack } from '@sinc/shared';
import type { NativeDownloadResult } from '../native/types';
import {
  useDownloadsStore,
  jobIdForTrack,
  isBadDownloadDuration,
  validateDownloadDuration,
  durationToleranceMs,
  resetDirectSourceMissCache,
  resetDownloadQueueForTests,
  MAX_CONCURRENT_DOWNLOADS,
} from './downloadsStore';
import { queueTracksForDownload } from './downloadQueue';

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
    remove: vi.fn((..._args: unknown[]): Promise<void> => Promise.resolve()),
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

function makeTrack(id: string, durationMs = 180_000): CanonicalTrack {
  return {
    id,
    title: `Track ${id}`,
    artists: [{ id: `a-${id}`, name: 'Artist', providerIds: {}, genres: [] }],
    durationMs,
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

function completeHeldDownload(
  gates: Map<string, Deferred<NativeDownloadResult>>,
  jobId: string,
  durationMs = 180_000
): void {
  const gate = gates.get(jobId);
  if (!gate) throw new Error(`No held download for ${jobId}`);
  gate.resolve({
    localUri: `file:///data/sinc_downloads/${jobId}.mp3`,
    sizeBytes: 4321,
    durationMs,
  });
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
  downloaderMock.remove.mockReset();
  downloaderMock.remove.mockImplementation(async () => undefined);
  ytMock.available.mockClear();
  ytMock.download.mockClear();
  trackAnalytics.mockClear();
});

describe('Test A: Three-song queue reliability', () => {
  it('processes three songs through the queue without third-song false error', async () => {
    const gates = holdDirectDownloads();
    findArchive.mockImplementation(async (candidate: CanonicalTrack) => ({
      url: `https://archive.org/download/${candidate.id}.mp3`,
      provider: 'archive',
      mimeType: 'audio/mpeg',
      expectedDurationMs: candidate.durationMs,
    }));

    const tracks = ['song-1', 'song-2', 'song-3'].map((id) => makeTrack(id));
    const pending = tracks.map((t) => useDownloadsStore.getState().downloadTrack(t));

    // 1. Verify that songs 1 and 2 start concurrently
    await vi.waitFor(() => expect(downloaderMock.download).toHaveBeenCalledTimes(2));
    expect(useDownloadsStore.getState().getDownload('song-1')?.phase).toBe('transfer');
    expect(useDownloadsStore.getState().getDownload('song-2')?.phase).toBe('transfer');
    expect(useDownloadsStore.getState().getDownload('song-3')?.phase).toBe('queued');

    // 2. Allow first song to complete
    completeHeldDownload(gates, jobIdForTrack(tracks[0]));
    await vi.waitFor(() => expect(useDownloadsStore.getState().getDownload('song-1')?.phase).toBe('completed'));

    // 3. Verify third song starts transfer immediately after slot opens
    await vi.waitFor(() => expect(downloaderMock.download).toHaveBeenCalledTimes(3));
    expect(useDownloadsStore.getState().getDownload('song-3')?.phase).toBe('transfer');

    // 4. Allow second song to complete
    completeHeldDownload(gates, jobIdForTrack(tracks[1]));
    await vi.waitFor(() => expect(useDownloadsStore.getState().getDownload('song-2')?.phase).toBe('completed'));

    // 5. Allow third song to complete
    completeHeldDownload(gates, jobIdForTrack(tracks[2]));
    await Promise.all(pending);

    // 6. Verify third song completed successfully without false error
    const row3 = useDownloadsStore.getState().getDownload('song-3');
    expect(row3?.phase).toBe('completed');
    expect(row3?.error).toBeUndefined();
    expect(row3?.localUri).toBeTruthy();

    // Verify all 3 songs are completed
    const all = useDownloadsStore.getState().downloads;
    expect(all).toHaveLength(3);
    expect(all.every((d) => d.phase === 'completed')).toBe(true);
  });

  it('processes three songs via batch queueTracksForDownload with engine fallback enabled', async () => {
    findArchive.mockResolvedValue(null); // Direct sources return null
    ytMock.download.mockImplementation(async (...args: unknown[]) => {
      const jobId = (args[0] as string | undefined) ?? 'test';
      return {
        localUri: `file:///data/sinc_yt/${jobId}.mp3`,
        durationMs: 180_000,
        mimeType: 'audio/mpeg',
      };
    });

    const tracks = ['batch-1', 'batch-2', 'batch-3'].map((id) => makeTrack(id));
    const result = await queueTracksForDownload(tracks, { allowEngine: true });
    expect(result.queued).toBe(3);
    expect(result.skipped).toBe(0);

    // Wait for all 3 downloads to finish through the engine
    await vi.waitFor(
      () => {
        const store = useDownloadsStore.getState();
        expect(store.downloads).toHaveLength(3);
        expect(store.downloads.every((d) => d.phase === 'completed')).toBe(true);
      },
      { timeout: 5000 }
    );

    const store = useDownloadsStore.getState();
    expect(store.getDownload('batch-3')?.phase).toBe('completed');
    expect(store.getDownload('batch-3')?.error).toBeUndefined();
  });
});

describe('Test B: Larger queues with concurrency limit enforcement', () => {
  it.each([1, 2, 3, 5, 10])('handles queue of %i songs with max 2 concurrent', async (count) => {
    let activeTransfers = 0;
    let peakConcurrency = 0;

    downloaderMock.download.mockImplementation(async (...args: unknown[]) => {
      const jobId = (args[0] as string | undefined) ?? 'test';
      activeTransfers += 1;
      peakConcurrency = Math.max(peakConcurrency, activeTransfers);
      // Small artificial delay to verify concurrency overlapping
      await new Promise((resolve) => setTimeout(resolve, 15));
      activeTransfers -= 1;
      return {
        localUri: `file:///sdcard/Sinc/${jobId}.mp3`,
        sizeBytes: 5000,
        durationMs: 180_000,
      };
    });

    findArchive.mockImplementation(async (candidate: CanonicalTrack) => ({
      url: `https://archive.org/download/${candidate.id}.mp3`,
      provider: 'archive',
      mimeType: 'audio/mpeg',
      expectedDurationMs: candidate.durationMs,
    }));

    const tracks = Array.from({ length: count }, (_, i) => makeTrack(`large-${count}-${i}`));
    const pending = tracks.map((t) => useDownloadsStore.getState().downloadTrack(t));

    await Promise.all(pending);

    // Verify peak concurrency never exceeded MAX_CONCURRENT_DOWNLOADS (2)
    expect(peakConcurrency).toBeLessThanOrEqual(MAX_CONCURRENT_DOWNLOADS);
    if (count >= 2) {
      expect(peakConcurrency).toBe(2);
    } else {
      expect(peakConcurrency).toBe(1);
    }

    // Verify every song completed successfully
    const downloads = useDownloadsStore.getState().downloads;
    expect(downloads).toHaveLength(count);
    expect(downloads.every((d) => d.phase === 'completed')).toBe(true);
  });
});

describe('Test C: Consecutive downloads without state leakage', () => {
  it('runs multiple consecutive batches cleanly without leaked tokens or state', async () => {
    findArchive.mockImplementation(async (candidate: CanonicalTrack) => ({
      url: `https://archive.org/download/${candidate.id}.mp3`,
      provider: 'archive',
      mimeType: 'audio/mpeg',
      expectedDurationMs: candidate.durationMs,
    }));

    // Batch 1: 3 songs
    const batch1 = ['c1-a', 'c1-b', 'c1-c'].map((id) => makeTrack(id));
    await Promise.all(batch1.map((t) => useDownloadsStore.getState().downloadTrack(t)));
    expect(useDownloadsStore.getState().downloads.filter((d) => d.phase === 'completed')).toHaveLength(3);

    // Batch 2: 3 different songs immediately after
    const batch2 = ['c2-a', 'c2-b', 'c2-c'].map((id) => makeTrack(id));
    await Promise.all(batch2.map((t) => useDownloadsStore.getState().downloadTrack(t)));
    expect(useDownloadsStore.getState().downloads.filter((d) => d.phase === 'completed')).toHaveLength(6);

    // Batch 3: 4 more songs
    const batch3 = ['c3-a', 'c3-b', 'c3-c', 'c3-d'].map((id) => makeTrack(id));
    await Promise.all(batch3.map((t) => useDownloadsStore.getState().downloadTrack(t)));
    expect(useDownloadsStore.getState().downloads.filter((d) => d.phase === 'completed')).toHaveLength(10);
    expect(useDownloadsStore.getState().downloads.every((d) => d.phase === 'completed')).toBe(true);
  });
});

describe('Test D: Duration tolerance & structured diagnostics', () => {
  it('validates exact match correctly', () => {
    const diag = validateDownloadDuration(180_000, 180_000);
    expect(diag.status).toBe('validation_passed');
    expect(diag.difference).toBe(0);
    expect(diag.fileReadable).toBe(true);
    expect(isBadDownloadDuration(180_000, 180_000)).toBe(false);
  });

  it('accepts small metadata and intro/outro differences', () => {
    // 1s difference on 175s song
    const diag1 = validateDownloadDuration(174_000, 175_000);
    expect(diag1.status).toBe('validation_passed');
    expect(isBadDownloadDuration(174_000, 175_000)).toBe(false);

    // 1.17s difference on 175s song
    const diag2 = validateDownloadDuration(176_170, 175_000);
    expect(diag2.status).toBe('validation_passed');
    expect(isBadDownloadDuration(176_170, 175_000)).toBe(false);
  });

  it('accepts acceptable moderate difference (e.g. 6.3s on 213.5s track = 2.95%)', () => {
    // 213.5s source vs 207.2s downloaded (6.3s difference, 2.95%)
    const diag = validateDownloadDuration(207_200, 213_500);
    expect(diag.status).toBe('validation_passed');
    expect(diag.difference).toBeCloseTo(6.3, 1);
    expect(diag.differencePercentage).toBeCloseTo(2.95, 1);
    expect(diag.fileReadable).toBe(true);
    expect(isBadDownloadDuration(207_200, 213_500)).toBe(false);
  });

  it('rejects unacceptable large difference (e.g. 45s off) with structured diagnostics', () => {
    // 130s downloaded vs 175s expected (45s difference, 25.7%)
    const diag = validateDownloadDuration(130_000, 175_000);
    expect(diag.status).toBe('validation_failed');
    expect(diag.reason).toBe('incorrect_version');
    expect(diag.sourceDuration).toBe(175);
    expect(diag.downloadedDuration).toBe(130);
    expect(diag.difference).toBe(45);
    expect(diag.differencePercentage).toBeCloseTo(25.71, 1);
    expect(diag.validationPolicy).toBe('duration_tolerance_v2');
    expect(diag.fileReadable).toBe(true);
    expect(isBadDownloadDuration(130_000, 175_000)).toBe(true);
  });

  it('handles missing or unknown source duration gracefully', () => {
    // Expected duration missing (null or 0) for normal 10-minute track
    const diagValid = validateDownloadDuration(600_000, null);
    expect(diagValid.status).toBe('validation_passed');
    expect(isBadDownloadDuration(600_000, null)).toBe(false);

    // Expected duration missing for excessive 25-minute file
    const diagExcessive = validateDownloadDuration(1_500_000, null);
    expect(diagExcessive.status).toBe('validation_failed');
    expect(diagExcessive.reason).toBe('duration_mismatch');
    expect(isBadDownloadDuration(1_500_000, null)).toBe(true);
  });

  it('handles missing downloaded duration (ffprobe failure)', () => {
    const diag = validateDownloadDuration(0, 180_000);
    expect(diag.status).toBe('validation_failed');
    expect(diag.reason).toBe('ffprobe_failure');
    expect(diag.downloadedDuration).toBe(0);
    expect(isBadDownloadDuration(0, 180_000)).toBe(true);
  });

  it('handles unreadable audio files with invalid_audio reason', () => {
    const diag = validateDownloadDuration(180_000, 180_000, { fileReadable: false });
    expect(diag.status).toBe('validation_failed');
    expect(diag.reason).toBe('invalid_audio');
    expect(diag.fileReadable).toBe(false);
  });

  it('handles audio files with no audio stream', () => {
    const diag = validateDownloadDuration(180_000, 180_000, { hasAudioStream: false });
    expect(diag.status).toBe('validation_failed');
    expect(diag.reason).toBe('invalid_audio');
    expect(diag.hasAudioStream).toBe(false);
  });

  it('computes duration tolerance within configured bounds', () => {
    // Short track (100s): max(8s, 4s) = 8s
    expect(durationToleranceMs(100_000)).toBe(8_000);
    // Medium track (213.5s): max(8s, 8.54s) = 8.54s (~8540ms)
    expect(durationToleranceMs(213_500)).toBe(8_540);
    // Long track (600s): min(15s, 24s) = 15s cap
    expect(durationToleranceMs(600_000)).toBe(15_000);
  });
});

describe('Test E: Truncated audio detection', () => {
  it('rejects files shorter than 45s minimum length', () => {
    // 30s preview snippet for 180s song
    const diag = validateDownloadDuration(30_000, 180_000);
    expect(diag.status).toBe('validation_failed');
    expect(diag.reason).toBe('truncated_file');
    expect(isBadDownloadDuration(30_000, 180_000)).toBe(true);
  });

  it('rejects files shorter than 50% of expected duration', () => {
    // 80s downloaded for a 180s song (44.4% of expected duration, > 45s but < 50%)
    const diag = validateDownloadDuration(80_000, 180_000);
    expect(diag.status).toBe('validation_failed');
    expect(diag.reason).toBe('truncated_file');
    expect(diag.difference).toBe(100);
    expect(diag.differencePercentage).toBeCloseTo(55.56, 1);
    expect(isBadDownloadDuration(80_000, 180_000)).toBe(true);
  });
});

describe('Test F: Incorrect versions rejected', () => {
  it('rejects alternate versions, remixes, or live recordings with large duration gaps', () => {
    // 240s extended mix for 180s track (60s difference, 33.3%)
    const diag1 = validateDownloadDuration(240_000, 180_000);
    expect(diag1.status).toBe('validation_failed');
    expect(diag1.reason).toBe('incorrect_version');
    expect(isBadDownloadDuration(240_000, 180_000)).toBe(true);

    // 300s live version for 180s album track
    const diag2 = validateDownloadDuration(300_000, 180_000);
    expect(diag2.status).toBe('validation_failed');
    expect(diag2.reason).toBe('incorrect_version');
    expect(isBadDownloadDuration(300_000, 180_000)).toBe(true);

    // 198s re-upload vs 210s expected (12s difference on 210s track, exceeding tolerance of 8.4s)
    const diag3 = validateDownloadDuration(198_000, 210_000);
    expect(diag3.status).toBe('validation_failed');
    expect(diag3.reason).toBe('duration_mismatch');
    expect(isBadDownloadDuration(198_000, 210_000)).toBe(true);
  });
});

describe('Test G: Retry behavior and queue isolation', () => {
  it('retries a failed task cleanly to completion without duplicate records', async () => {
    const t = makeTrack('retry-test');
    findArchive.mockResolvedValue(null);
    ytMock.download
      .mockRejectedValueOnce(new Error('Extraction blocked: format unavailable'))
      .mockResolvedValueOnce({
        localUri: 'file:///sdcard/Sinc/retried.mp3',
        durationMs: 180_000,
        mimeType: 'audio/mpeg',
      });

    // Initial attempt fails
    await useDownloadsStore.getState().downloadTrack(t);
    const failedRecord = useDownloadsStore.getState().getDownload(t.id);
    expect(failedRecord?.phase).toBe('failed');

    // Retry the failed download
    await useDownloadsStore.getState().retryDownload(jobIdForTrack(t));

    const completedRecord = useDownloadsStore.getState().getDownload(t.id);
    expect(completedRecord?.phase).toBe('completed');
    expect(completedRecord?.localUri).toBe('file:///sdcard/Sinc/retried.mp3');

    // Verify exactly one record exists for this track (no duplicates)
    const records = useDownloadsStore.getState().downloads.filter((d) => d.track.id === t.id);
    expect(records).toHaveLength(1);
  });

  it('does not re-download or overwrite an already completed download on retry', async () => {
    const t = makeTrack('completed-guard');
    findArchive.mockResolvedValueOnce({
      url: 'https://archive.org/download/x/song.mp3',
      provider: 'archive',
      mimeType: 'audio/mpeg',
      expectedDurationMs: 180_000,
    });

    await useDownloadsStore.getState().downloadTrack(t);
    expect(useDownloadsStore.getState().getDownload(t.id)?.phase).toBe('completed');
    expect(downloaderMock.download).toHaveBeenCalledTimes(1);

    // Call retryDownload on a completed job: should be a no-op
    await useDownloadsStore.getState().retryDownload(jobIdForTrack(t));
    expect(downloaderMock.download).toHaveBeenCalledTimes(1);
    expect(ytMock.download).not.toHaveBeenCalled();
  });

  it('ensures failure of one queued task does not break or stall the rest of the queue', async () => {
    findArchive.mockImplementation(async (candidate: CanonicalTrack) => {
      if (candidate.id === 'fail-mid-2') {
        throw new Error('Unrecoverable provider 500 error');
      }
      return {
        url: `https://archive.org/download/${candidate.id}.mp3`,
        provider: 'archive',
        mimeType: 'audio/mpeg',
        expectedDurationMs: candidate.durationMs,
      };
    });

    const tracks = ['fail-mid-1', 'fail-mid-2', 'fail-mid-3', 'fail-mid-4'].map((id) =>
      makeTrack(id)
    );
    await Promise.all(tracks.map((t) => useDownloadsStore.getState().downloadTrack(t)));

    const store = useDownloadsStore.getState();
    expect(store.getDownload('fail-mid-1')?.phase).toBe('completed');
    expect(store.getDownload('fail-mid-2')?.phase).toBe('failed');
    expect(store.getDownload('fail-mid-3')?.phase).toBe('completed');
    expect(store.getDownload('fail-mid-4')?.phase).toBe('completed');
  });
});
