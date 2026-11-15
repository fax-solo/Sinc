import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalTrack } from '@sinc/shared';
import {
  buildBackupPayload,
  saveBackupToDevice,
  readBackupFromDevice,
  restoreFromBackup,
  autoRestoreIfFresh,
  useBackupStore,
  type SincBackupPayload,
} from './backupService';
import { useLibraryStore } from '../library/libraryStore';
import { useDownloadsStore } from '../library/downloadsStore';
import { nativeBridge } from '../native';

const mockTrack: CanonicalTrack = {
  id: 'track-1',
  title: 'Test Song',
  artists: [{ id: 'artist-1', name: 'Solo Artist', providerIds: {}, genres: [] }],
  durationMs: 180000,
  artworkUrl: 'https://example.com/art.jpg',
  providerIds: {},
  explicit: false,
};

describe('backupService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLibraryStore.setState({
      favoriteTracks: [],
      favoriteIds: new Set(),
      playlists: [],
      playStats: {},
      artistPlayStats: {},
      recentlyPlayed: [],
    });
    useDownloadsStore.setState({
      downloads: [],
      downloadedIds: new Set(),
    });
  });

  it('builds a complete backup payload from current stores', () => {
    useLibraryStore.setState({
      favoriteTracks: [mockTrack],
      favoriteIds: new Set([mockTrack.id]),
      playStats: {
        'track-1': { count: 15, completedCount: 12, lastPlayedAt: 1000 },
      },
      artistPlayStats: { 'Solo Artist': 15 },
    });

    useDownloadsStore.setState({
      downloads: [
        {
          jobId: 'dl-1',
          track: mockTrack,
          localUri: 'file:///storage/emulated/0/Music/Sinc/Solo Artist - Test Song.mp3',
          publishedName: 'Solo Artist - Test Song.mp3',
          phase: 'completed',
          progress: 100,
          createdAt: 1000,
        },
      ],
      downloadedIds: new Set([mockTrack.id]),
    });

    const payload = buildBackupPayload();
    expect(payload.version).toBe(1);
    expect(payload.favoriteTracks).toHaveLength(1);
    expect(payload.favoriteTracks[0]?.title).toBe('Test Song');
    expect(payload.playStats['track-1']?.count).toBe(15);
    expect(payload.artistPlayStats['Solo Artist']).toBe(15);
    expect(payload.downloads).toHaveLength(1);
    expect(payload.downloads[0]?.publishedName).toBe('Solo Artist - Test Song.mp3');
  });

  it('saves backup to device storage via native bridge', async () => {
    vi.spyOn(nativeBridge.backup, 'available').mockReturnValue(true);
    vi.spyOn(nativeBridge.backup, 'saveBackup').mockResolvedValue({
      success: true,
      path: '/storage/emulated/0/Music/Sinc/.sinc_backup.json',
      timestamp: 12345678,
      sizeBytes: 1024,
    });

    const res = await saveBackupToDevice();
    expect(res.success).toBe(true);
    expect(res.path).toBe('/storage/emulated/0/Music/Sinc/.sinc_backup.json');
    expect(useBackupStore.getState().lastBackupTime).toBe(12345678);
  });

  it('reads backup from device storage and parses payload', async () => {
    const payload = buildBackupPayload();
    vi.spyOn(nativeBridge.backup, 'available').mockReturnValue(true);
    vi.spyOn(nativeBridge.backup, 'readBackup').mockResolvedValue({
      exists: true,
      data: JSON.stringify(payload),
      path: '/storage/emulated/0/Music/Sinc/.sinc_backup.json',
      timestamp: 12345678,
      sizeBytes: 1024,
    });

    const result = await readBackupFromDevice();
    expect(result).not.toBeNull();
    expect(result?.version).toBe(1);
  });

  it('restores library, downloads, and profile from payload', async () => {
    vi.spyOn(nativeBridge.backup, 'available').mockReturnValue(true);
    vi.spyOn(nativeBridge.backup, 'scanDownloadedFiles').mockResolvedValue([
      {
        fileName: 'Solo Artist - Test Song.mp3',
        uri: 'file:///storage/emulated/0/Music/Sinc/Solo Artist - Test Song.mp3',
        sizeBytes: 5000000,
        lastModified: 1000,
      },
    ]);

    const payload: SincBackupPayload = {
      version: 1,
      createdAt: 1000,
      profile: {
        id: 'local',
        username: 'Solo',
        bio: 'Music Lover 🎵',
      },
      favoriteTracks: [mockTrack],
      playlists: [
        {
          id: 'pl-1',
          name: 'My Vibe',
          tracks: [mockTrack],
          createdAt: 1000,
          updatedAt: 1000,
        },
      ],
      playStats: {
        'track-1': { count: 42, completedCount: 40, lastPlayedAt: 1000 },
      },
      artistPlayStats: {
        'Solo Artist': 42,
      },
      skipStats: {},
      recentlyPlayed: [mockTrack],
      followedArtists: [],
      followedAlbums: [],
      downloads: [
        {
          jobId: 'dl-1',
          track: mockTrack,
          publishedName: 'Solo Artist - Test Song.mp3',
          phase: 'completed',
          progress: 100,
          createdAt: 1000,
        },
      ],
    };

    const success = await restoreFromBackup(payload);
    expect(success).toBe(true);

    const library = useLibraryStore.getState();
    expect(library.favoriteTracks).toHaveLength(1);
    expect(library.playlists).toHaveLength(1);
    expect(library.playStats['track-1']?.count).toBe(42);
    expect(library.artistPlayStats['Solo Artist']).toBe(42);

    const downloads = useDownloadsStore.getState();
    expect(downloads.downloads).toHaveLength(1);
    expect(downloads.downloads[0]?.localUri).toBe(
      'file:///storage/emulated/0/Music/Sinc/Solo Artist - Test Song.mp3'
    );
    expect(downloads.isDownloaded('track-1')).toBe(true);
  });

  it('auto-restores if local library is completely fresh', async () => {
    const payload = buildBackupPayload();
    payload.favoriteTracks = [mockTrack];

    vi.spyOn(nativeBridge.backup, 'available').mockReturnValue(true);
    vi.spyOn(nativeBridge.backup, 'readBackup').mockResolvedValue({
      exists: true,
      data: JSON.stringify(payload),
    });
    vi.spyOn(nativeBridge.backup, 'scanDownloadedFiles').mockResolvedValue([]);

    const restored = await autoRestoreIfFresh();
    expect(restored).toBe(true);
    expect(useLibraryStore.getState().favoriteTracks).toHaveLength(1);
  });
});
