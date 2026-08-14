import type { HomeFeed, HomeFeedItem, HomeSectionType } from '@sinc/shared';

/**
 * Per-section data sources for the home feed. Each section is a vertical
 * slice: the source owns how it finds items (playback history, favorites,
 * recommendations, ...). Sources arrive with their owning milestones
 * (M3.x history/downloads/favorites, M6.1 recommendations); until then the
 * default returns no items and the section is omitted.
 */
export interface HomeFeedSourceProvider {
  continueListening(): Promise<HomeFeedItem[]>;
  recentlyPlayed(): Promise<HomeFeedItem[]>;
  downloaded(): Promise<HomeFeedItem[]>;
  favorites(): Promise<HomeFeedItem[]>;
  playlists(): Promise<HomeFeedItem[]>;
  recommended(): Promise<HomeFeedItem[]>;
}

export class NoopHomeFeedSourceProvider implements HomeFeedSourceProvider {
  continueListening(): Promise<HomeFeedItem[]> {
    return Promise.resolve([]);
  }
  recentlyPlayed(): Promise<HomeFeedItem[]> {
    return Promise.resolve([]);
  }
  downloaded(): Promise<HomeFeedItem[]> {
    return Promise.resolve([]);
  }
  favorites(): Promise<HomeFeedItem[]> {
    return Promise.resolve([]);
  }
  playlists(): Promise<HomeFeedItem[]> {
    return Promise.resolve([]);
  }
  recommended(): Promise<HomeFeedItem[]> {
    return Promise.resolve([]);
  }
}

export const HOME_SECTION_ORDER: HomeSectionType[] = [
  'continue_listening',
  'recently_played',
  'downloaded',
  'favorites',
  'playlists',
  'recommended',
];

/** HomeSectionType (wire) -> HomeFeedSourceProvider method (code). */
const SECTION_LOADER: Record<HomeSectionType, keyof HomeFeedSourceProvider> = {
  continue_listening: 'continueListening',
  recently_played: 'recentlyPlayed',
  downloaded: 'downloaded',
  favorites: 'favorites',
  playlists: 'playlists',
  recommended: 'recommended',
};

const MAX_ITEMS_PER_SECTION = 20;

/**
 * Assembles the home feed: every section source is polled in parallel and
 * isolated — a failing source yields an empty section instead of taking the
 * whole feed down. Sections without items are omitted; the rest keep the
 * canonical order.
 */
export class HomeFeedService {
  constructor(
    private readonly sources: HomeFeedSourceProvider = new NoopHomeFeedSourceProvider(),
  ) {}

  async build(_userId: string): Promise<HomeFeed> {
    const loaded = await Promise.all(
      HOME_SECTION_ORDER.map(async (type) => {
        try {
          const items = await this.sources[SECTION_LOADER[type]]();
          return { type, items: items.slice(0, MAX_ITEMS_PER_SECTION) };
        } catch {
          return { type, items: [] };
        }
      }),
    );

    return {
      sections: loaded
        .filter((section) => section.items.length > 0)
        .map((section) => ({ id: section.type, type: section.type, items: section.items })),
      generatedAt: new Date().toISOString(),
    };
  }
}
