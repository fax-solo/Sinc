import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalTrack } from '@sinc/shared';
import { storage, STORAGE_KEYS } from '../../utils/storage';
import { useDownloadsStore, safeFileName } from './downloadsStore';
import type { DownloadJob } from '../../api/music';
import type { NativeDownloaderModule } from '../native/types';

function track(id: string, title = `Track ${id}`): CanonicalTrack {
  return {
    id,
    title,
    artists: [{ id: `a-${id}`, name: 'Artist', providerIds: {}, genres: [] }],
    durationMs: 1000,
    artworkUrl: undefined,
    providerIds: { itunes: id },
    explicit: false,
  };
}

function job(overrides: Partial<DownloadJob> = {}): DownloadJob {
  return {
    id: 'job-1',
    trackId: 'itunes:1',
    trackTitle: 'Track itunes:1',
    trackArtist: 'Artist',
    quality: 'high',
    status: 'downloading',
    progress: 0,
    bytesDownloaded: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function resetStore() {
  void useDownloadsStore.persist.clearStorage();
  useDownloadsStore.setState({ downloads: [] });
}

const startDownload = vi.fn();
const getDownload = vi.fn();
const deleteDownload = vi.fn();
const download = vi.fn();
const remove = vi.fn();

vi.mock('../../api/music', () => ({
  musicApi: {
    startDownload: (...args: unknown[]) => startDownload(...args),
    getDownload: (...args: unknown[]) => getDownload(...args),
    deleteDownload: (...args: unknown[]) => deleteDownload(...args),
    downloadFileUrl: (jobId: string) => `http://test/music/downloads/${jobId}/file`,
  },
}));

vi.mock('../../api/client', () => ({
  apiClient: { getAccessToken: () => 'at-1' },
}));

vi.mock('../native', () => ({
  nativeBridge: {
    downloader: {
      available: () => true,
      download: (...args: unknown[]) => download(...args),
      remove: (...args: unknown[]) => remove(...args),
      addProgressListener: () => () => {},
    } as unknown as NativeDownloaderModule,
  },
}));

beforeEach(() => {
  storage.remove(STORAGE_KEYS.DOWNLOADS);
  resetStore();
  vi.clearAllMocks();
  startDownload.mockResolvedValue(job());
  getDownload.mockResolvedValue(
    job({ status: 'completed', progress: 100, provider: 'soundcloud' })
  );
  download.mockResolvedValue({
    localUri: 'file:///data/sinc_downloads/track.mp3',
    sizeBytes: 1234,
  });
  remove.mockResolvedValue(undefined);
  deleteDownload.mockResolvedValue(undefined);
});

describe('safeFileName', () => {
  it('keeps Arabic titles distinct (no ASCII-only word-class collision)', () => {
    const a = safeFileName(track('itunes:1', 'بعتالي في الشات'));
    const b = safeFileName(track('itunes:2', 'ضميري'));
    const c = safeFileName(track('itunes:3', 'مكنش العشم'));
    expect(new Set([a, b, c]).size).toBe(3);
    expect(a).toContain('بعتالي-في-الشات');
  });

  it('is unique for distinct track ids with the same artist/title', () => {
    const a = safeFileName(track('itunes:1', 'Bloodline'));
    const b = safeFileName(track('deezer:2', 'Bloodline'));
    expect(a).not.toBe(b);
  });

  it('sanitizes path-hostile characters', () => {
    const name = safeFileName(track('itunes:1', 'A/B\\C:D*E?F"G<H>I|J'));
    expect(name).toMatch(/^Artist-A-B-C-D-E-F-G-H-I-J-[0-9a-z]+\.mp3$/);
  });
});

describe('downloadsStore', () => {
  it('downloads a track end-to-end', async () => {
    const t = track('itunes:1');
    expect(useDownloadsStore.getState().isDownloaded(t.id)).toBe(false);

    await useDownloadsStore.getState().downloadTrack(t);

    expect(startDownload).toHaveBeenCalledWith(t.id, t);
    expect(download).toHaveBeenCalledWith(
      'job-1',
      'http://test/music/downloads/job-1/file',
      { Authorization: 'Bearer at-1' },
      expect.any(String),
      {
        title: t.title,
        artist: t.artists[0]?.name,
        album: undefined,
        publicFileName: expect.any(String),
      }
    );
    const record = useDownloadsStore.getState().getDownload(t.id);
    expect(record?.phase).toBe('completed');
    expect(record?.localUri).toBe('file:///data/sinc_downloads/track.mp3');
    expect(record?.progress).toBe(100);
    expect(record?.provider).toBe('soundcloud');
    expect(useDownloadsStore.getState().isDownloaded(t.id)).toBe(true);
  });

  it('marks the download as failed when the source fails', async () => {
    getDownload.mockResolvedValue(
      job({ status: 'failed', errorMessage: 'All download sources failed' })
    );
    await useDownloadsStore.getState().downloadTrack(track('itunes:1'));

    const record = useDownloadsStore.getState().getDownload('itunes:1');
    expect(record?.phase).toBe('failed');
    expect(record?.error).toBe('All download sources failed');
    expect(download).not.toHaveBeenCalled();
  });

  it('marks the download as failed when the device transfer fails', async () => {
    download.mockRejectedValue(new Error('Network unreachable'));
    await useDownloadsStore.getState().downloadTrack(track('itunes:1'));

    const record = useDownloadsStore.getState().getDownload('itunes:1');
    expect(record?.phase).toBe('failed');
    expect(record?.error).toBe('Network unreachable');
  });

  it('does not start a duplicate download for the same track', async () => {
    const t = track('itunes:1');
    await useDownloadsStore.getState().downloadTrack(t);
    const calls = startDownload.mock.calls.length;

    await useDownloadsStore.getState().downloadTrack(t);
    expect(startDownload.mock.calls.length).toBe(calls);
  });

  it('resumes an interrupted transfer after a restart', async () => {
    const t = track('itunes:1');
    useDownloadsStore.setState({
      downloads: [
        {
          jobId: 'job-1',
          track: t,
          phase: 'transfer',
          progress: 60,
          createdAt: Date.now(),
        },
      ],
    });

    await useDownloadsStore.getState().resumeInFlight();

    expect(download).toHaveBeenCalledWith(
      'job-1',
      'http://test/music/downloads/job-1/file',
      { Authorization: 'Bearer at-1' },
      expect.any(String),
      {
        title: t.title,
        artist: t.artists[0]?.name,
        album: undefined,
        publicFileName: expect.any(String),
      }
    );
    const record = useDownloadsStore.getState().getDownload(t.id);
    expect(record?.phase).toBe('completed');
    expect(record?.progress).toBe(100);
  });

  it('removes a download from device and server', async () => {
    const t = track('itunes:1');
    await useDownloadsStore.getState().downloadTrack(t);
    const record = useDownloadsStore.getState().getDownload(t.id);

    await useDownloadsStore.getState().removeDownload(record!.jobId);

    expect(remove).toHaveBeenCalledWith(record!.jobId, 'track.mp3');
    expect(deleteDownload).toHaveBeenCalledWith(record!.jobId);
    expect(useDownloadsStore.getState().getDownload(t.id)).toBeUndefined();
    expect(useDownloadsStore.getState().isDownloaded(t.id)).toBe(false);
  });
});
