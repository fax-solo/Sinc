import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalTrack } from '@sinc/shared';
import { providerFetchJson } from './http';
import { findArchiveSource } from './download-source';

vi.mock('./http', () => ({ providerFetchJson: vi.fn() }));

const fetchMock = vi.mocked(providerFetchJson);

function track(title: string, artist: string, durationMs: number): CanonicalTrack {
  return {
    id: `itunes:${title}`,
    title,
    durationMs,
    artists: [{ id: `artist:${artist}`, name: artist, providerIds: {}, genres: [] }],
    providerIds: {},
    explicit: false,
  };
}

function mockFetch(handler: (url: string) => unknown): void {
  fetchMock.mockImplementation((async (url: string) =>
    handler(url)) as unknown as typeof providerFetchJson);
}

describe('findArchiveSource', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('tries the title-only query when the artist-scoped item has no matching file', async () => {
    const searches: string[] = [];
    mockFetch((url) => {
      if (url.includes('advancedsearch.php')) {
        searches.push(decodeURIComponent(url));
        return searches.length === 1
          ? {
              response: {
                docs: [{ identifier: 'album', title: 'Album', creator: 'Ariana Grande' }],
              },
            }
          : {
              response: {
                docs: [{ identifier: 'single', title: 'Daylight', creator: 'Ariana Grande' }],
              },
            };
      }
      if (url.includes('/metadata/album')) {
        return {
          metadata: { title: 'Album', creator: 'Ariana Grande' },
          files: [
            {
              name: '01 Intro.mp3',
              format: 'VBR MP3',
              title: 'Intro',
              artist: 'Ariana Grande',
              length: '0:30',
            },
          ],
        };
      }
      if (url.includes('/metadata/single')) {
        return {
          metadata: { title: 'Daylight', creator: 'Ariana Grande' },
          files: [
            {
              name: 'Daylight.mp3',
              format: 'VBR MP3',
              title: 'Daylight',
              artist: 'Ariana Grande',
              length: '3:30',
            },
          ],
        };
      }
      throw new Error(`unexpected URL ${url}`);
    });

    const source = await findArchiveSource(track('Daylight', 'Ariana Grande', 210_000));

    expect(source?.url).toContain('/download/single/Daylight.mp3');
    expect(source?.expectedDurationMs).toBe(210_000);
    expect(searches).toHaveLength(2);
    expect(searches[0]).toContain('creator:"Ariana Grande"');
    expect(searches[1]).not.toContain('creator:');
  });

  it('returns null for an item whose only audio is a labeled cover', async () => {
    mockFetch((url) => {
      if (url.includes('advancedsearch.php')) {
        return {
          response: {
            docs: [
              {
                identifier: 'cover',
                title: 'Soundcloudaud.com Espresso Sabrina Carpenter ( Best Cover Ever )',
                creator: 'Sabrina Carpenter',
              },
            ],
          },
        };
      }
      if (url.includes('/metadata/cover')) {
        return {
          metadata: {
            title: 'Soundcloudaud.com Espresso Sabrina Carpenter ( Best Cover Ever )',
            creator: 'Sabrina Carpenter',
          },
          files: [
            {
              name: 'espresso.mp3',
              format: 'VBR MP3',
              title: 'Espresso',
              artist: 'Sabrina Carpenter',
              length: '2:56',
            },
          ],
        };
      }
      throw new Error(`unexpected URL ${url}`);
    });

    const source = await findArchiveSource(track('Espresso', 'Sabrina Carpenter', 175_000));

    expect(source).toBeNull();
  });
});
