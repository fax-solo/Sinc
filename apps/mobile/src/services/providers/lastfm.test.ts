import { describe, expect, it, vi } from 'vitest';
import { lastFm } from './lastfm';
import * as http from './http';

describe('lastfm provider', () => {
  it('returns null if no API key is provided', async () => {
    const res = await lastFm.getArtistInfo('Coldplay', '');
    expect(res).toBeNull();
  });

  it('parses artist information and cleans HTML from bio summary', async () => {
    vi.spyOn(http, 'providerFetchJson').mockResolvedValueOnce({
      artist: {
        name: 'Coldplay',
        stats: {
          listeners: '5600000',
          playcount: '240000000',
        },
        bio: {
          summary: 'Coldplay are a British rock band formed in London in 1997. <a href="https://www.last.fm/music/Coldplay">Read more on Last.fm</a>',
        },
        tags: {
          tag: [{ name: 'rock' }, { name: 'alternative' }],
        },
        similar: {
          artist: [{ name: 'Keane' }, { name: 'Snow Patrol' }],
        },
        url: 'https://www.last.fm/music/Coldplay',
      },
    });

    const res = await lastFm.getArtistInfo('Coldplay', 'fake_test_key');
    expect(res).not.toBeNull();
    expect(res?.name).toBe('Coldplay');
    expect(res?.listeners).toBe(5600000);
    expect(res?.playCount).toBe(240000000);
    expect(res?.bioSummary).toBe('Coldplay are a British rock band formed in London in 1997.');
    expect(res?.tags).toEqual(['rock', 'alternative']);
    expect(res?.similarArtists).toEqual(['Keane', 'Snow Patrol']);
    expect(res?.url).toBe('https://www.last.fm/music/Coldplay');
  });

  it('handles provider failures gracefully', async () => {
    vi.spyOn(http, 'providerFetchJson').mockRejectedValueOnce(new Error('Rate limited'));
    const res = await lastFm.getArtistInfo('ErrorBand', 'fake_key');
    expect(res).toBeNull();
  });
});
