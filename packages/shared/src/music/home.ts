/**
 * Home feed aggregation model shared by client and server.
 *
 * The server assembles ordered sections from per-section sources; a section
 * with no items is omitted. Section titles/localization are a client concern,
 * driven by `type`.
 */

export type HomeSectionType =
  | 'continue_listening'
  | 'recently_played'
  | 'downloaded'
  | 'favorites'
  | 'playlists'
  | 'recommended';

export type HomeItemKind = 'track' | 'artist' | 'album' | 'playlist' | 'editorial';

export interface HomeFeedItem {
  kind: HomeItemKind;
  /** Canonical entity id (provider ids for now — see provider id note). */
  id: string;
  title: string;
  subtitle?: string;
  artworkUrl?: string;
}

export interface HomeSection {
  id: string;
  type: HomeSectionType;
  items: HomeFeedItem[];
}

export interface HomeFeed {
  sections: HomeSection[];
  generatedAt: string;
}
