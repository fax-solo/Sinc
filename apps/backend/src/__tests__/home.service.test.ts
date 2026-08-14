import { describe, it, expect } from 'vitest';
import type { HomeFeedItem } from '@sinc/shared';
import {
  HOME_SECTION_ORDER,
  HomeFeedService,
  NoopHomeFeedSourceProvider,
  type HomeFeedSourceProvider,
} from '../domain/home/home.service.js';

function item(overrides: Partial<HomeFeedItem> = {}): HomeFeedItem {
  return { kind: 'track', id: 't1', title: 'Song', ...overrides };
}

function sources(overrides: Partial<HomeFeedSourceProvider> = {}): HomeFeedSourceProvider {
  return {
    continueListening: async () => [],
    recentlyPlayed: async () => [],
    downloaded: async () => [],
    favorites: async () => [],
    playlists: async () => [],
    recommended: async () => [],
    ...overrides,
  };
}

describe('home feed service', () => {
  it('returns no sections when every source is empty', async () => {
    const service = new HomeFeedService(new NoopHomeFeedSourceProvider());
    const feed = await service.build('user-1');
    expect(feed.sections).toEqual([]);
    expect(feed.generatedAt).toBeTruthy();
  });

  it('assembles sections in the canonical order', async () => {
    const service = new HomeFeedService(
      sources({
        recentlyPlayed: async () => [item({ id: 'rp1' })],
        continueListening: async () => [item({ id: 'cl1' })],
        recommended: async () => [item({ id: 'rec1' })],
      }),
    );
    const feed = await service.build('user-1');
    expect(feed.sections.map((s) => s.type)).toEqual([
      'continue_listening',
      'recently_played',
      'recommended',
    ]);
  });

  it('omits empty sections', async () => {
    const service = new HomeFeedService(
      sources({
        favorites: async () => [item({ id: 'f1' })],
        playlists: async () => [],
      }),
    );
    const feed = await service.build('user-1');
    expect(feed.sections.map((s) => s.type)).toEqual(['favorites']);
  });

  it('caps each section at 20 items', async () => {
    const many = Array.from({ length: 25 }, (_, i) => item({ id: `t${i}` }));
    const service = new HomeFeedService(sources({ downloaded: async () => many }));
    const feed = await service.build('user-1');
    expect(feed.sections[0]?.items).toHaveLength(20);
  });

  it('isolates a failing source instead of failing the whole feed', async () => {
    const service = new HomeFeedService(
      sources({
        continueListening: async () => {
          throw new Error('history unavailable');
        },
        favorites: async () => [item({ id: 'f1' })],
      }),
    );
    const feed = await service.build('user-1');
    expect(feed.sections.map((s) => s.type)).toEqual(['favorites']);
  });

  it('section order matches the documented contract', () => {
    expect(HOME_SECTION_ORDER).toEqual([
      'continue_listening',
      'recently_played',
      'downloaded',
      'favorites',
      'playlists',
      'recommended',
    ]);
  });
});
