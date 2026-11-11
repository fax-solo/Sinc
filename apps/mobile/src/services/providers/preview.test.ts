import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalTrack } from '@sinc/shared';
import { resetPreviewCache, resolvePreviewUrl } from './preview';
import { itunes } from './itunes';
import { deezer } from './deezer';

vi.mock('./itunes', () => ({
  itunes: {
    lookupTrack: vi.fn(),
    searchTracks: vi.fn(),
  },
}));

vi.mock('./deezer', () => ({
  deezer: {
    lookupTrack: vi.fn(),
    searchTracks: vi.fn(),
  },
}));

function track(overrides: Partial<CanonicalTrack> = {}): CanonicalTrack {
  return {
    id: 'itunes:1',
    title: 'Levitating',
    artists: [
      {
        id: 'itunes:2',
        name: 'Dua Lipa',
        providerIds: { itunes: '2' },
        genres: [],
      },
    ],
    durationMs: 203_000,
    providerIds: { itunes: '1' },
    explicit: false,
    ...overrides,
  };
}

function candidate(overrides: Partial<CanonicalTrack> = {}): CanonicalTrack {
  return track({
    previewUrl: 'https://preview.test/levitating.m4a',
    ...overrides,
  });
}

describe('resolvePreviewUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPreviewCache();
  });

  it('uses the catalog preview without any network call', async () => {
    const url = await resolvePreviewUrl(track({ previewUrl: 'https://preview.test/known.m4a' }));
    expect(url).toBe('https://preview.test/known.m4a');
    expect(itunes.lookupTrack).not.toHaveBeenCalled();
    expect(deezer.lookupTrack).not.toHaveBeenCalled();
  });

  it('refreshes an expired Deezer preview instead of using it', async () => {
    const fresh = 'https://cdnt-preview.dzcdn.net/fresh.mp3?exp=9999999999';
    vi.mocked(deezer.lookupTrack).mockResolvedValue(
      candidate({ previewUrl: fresh, providerIds: { deezer: '1' } })
    );
    const stale = track({
      previewUrl: 'https://cdnt-preview.dzcdn.net/stale.mp3?hdnea=exp=1~acl=/stale.mp3*~hmac=abc',
      providerIds: { deezer: '1' },
    });
    await expect(resolvePreviewUrl(stale)).resolves.toBe(fresh);
    expect(deezer.lookupTrack).toHaveBeenCalledWith('1');
  });

  it('looks up the provider id and accepts the exact recording', async () => {
    vi.mocked(itunes.lookupTrack).mockResolvedValue(candidate());
    const url = await resolvePreviewUrl(track());
    expect(url).toBe('https://preview.test/levitating.m4a');
    expect(itunes.lookupTrack).toHaveBeenCalledWith('1');
  });

  it('falls back to a strict search when the provider lookup is a different version', async () => {
    vi.mocked(itunes.lookupTrack).mockResolvedValue(
      candidate({ title: 'Levitating (Live)', previewUrl: 'https://preview.test/live.m4a' })
    );
    vi.mocked(itunes.searchTracks).mockResolvedValue([
      candidate({ title: 'Levitating (Remix)', previewUrl: 'https://preview.test/remix.m4a' }),
      candidate(),
    ]);
    const url = await resolvePreviewUrl(track());
    expect(url).toBe('https://preview.test/levitating.m4a');
  });

  it('returns null when no trustworthy preview exists', async () => {
    vi.mocked(itunes.lookupTrack).mockResolvedValue(null);
    vi.mocked(itunes.searchTracks).mockResolvedValue([]);
    vi.mocked(deezer.searchTracks).mockResolvedValue([]);
    await expect(resolvePreviewUrl(track())).resolves.toBeNull();
  });

  it('caches positive results per track', async () => {
    vi.mocked(itunes.lookupTrack).mockResolvedValue(candidate());
    await resolvePreviewUrl(track());
    await resolvePreviewUrl(track());
    expect(itunes.lookupTrack).toHaveBeenCalledTimes(1);
  });
});
