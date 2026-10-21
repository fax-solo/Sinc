import { beforeEach, describe, expect, it, vi } from 'vitest';
import { artworkUrl, prefetchArtworks } from './artwork';

const { mockPrefetch } = vi.hoisted(() => ({ mockPrefetch: vi.fn(async () => true) }));

vi.mock('react-native', () => ({ Image: { prefetch: mockPrefetch } }));

const consoleMock = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('artworkUrl', () => {
  it('passes remote http(s) artwork through untouched (no backend proxy)', () => {
    expect(artworkUrl('https://cdn/x?a=b')).toBe('https://cdn/x?a=b');
  });

  it('passes through local or non-http uris untouched', () => {
    expect(artworkUrl('file:///sdcard/cover.jpg')).toBe('file:///sdcard/cover.jpg');
    expect(artworkUrl('asset:cover')).toBe('asset:cover');
  });

  it('returns undefined for empty values', () => {
    expect(artworkUrl()).toBeUndefined();
    expect(artworkUrl('')).toBeUndefined();
  });
});

describe('prefetchArtworks', () => {
  it('prefetches up to count remote artworks and skips non-http', () => {
    prefetchArtworks(
      ['https://cdn/1.jpg', 'file:///local.jpg', 'https://cdn/2.jpg', 'https://cdn/3.jpg'],
      2
    );
    expect(mockPrefetch).toHaveBeenCalledTimes(2);
    const firstCall = (mockPrefetch.mock.calls as unknown as [string][])[0];
    expect(firstCall[0]).toBe('https://cdn/1.jpg');
    void consoleMock;
  });

  it('survives a throwing prefetch', async () => {
    mockPrefetch.mockRejectedValue(new Error('no'));
    expect(() => prefetchArtworks(['https://cdn/1.jpg'])).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(mockPrefetch).toHaveBeenCalled();
  });
});
