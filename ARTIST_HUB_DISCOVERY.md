# Sinc Artist Hub, Music Discovery & Playlist Search Architecture

## 1. System Overview

Sinc's **Artist Hub & Music Discovery System** provides a comprehensive, local-first discovery experience without requiring Spotify API credentials, Spotify Client IDs, Client Secrets, or mandatory account authentication.

The architecture connects:
1. **Artist Discovery & Rich Profiles**: Verified identity, origin/country, genres, high-resolution artwork, biographies, and real statistics.
2. **Comprehensive Discography**: Partitioned releases into Albums, Singles & EPs, and Compilations with multiple sorting options (Newest, Oldest, A-Z).
3. **Multi-Provider Metadata Aggregation**: Legitimate, public data from Deezer, MusicBrainz, iTunes, and optional Last.fm.
4. **Spotify Integration Without API Keys**: URL recognition for Spotify artists, albums, tracks, and playlists, official oEmbed metadata extraction, "Open in Spotify" deep linking, and integration with Sinc's anonymous playlist importer.
5. **Playlist Discovery**: Search and explore public playlists from Deezer, iTunes, and user library associations with "Open in Provider", "Play in Sinc", and "Download to Library" actions.

---

## 2. Provider Architecture & Multi-Factor Identity Resolution

```
                  ┌──────────────────────────────────────────────┐
                  │              Sinc Application                │
                  └──────┬───────────────────────┬───────────────┘
                         │                       │
           ┌─────────────▼──────────┐ ┌──────────▼───────────────┐
           │   musicApi / Search    │ │    artistHubService      │
           └─────────────┬──────────┘ └──────────┬───────────────┘
                         │                       │
      ┌──────────────────┼───────────────────────┼──────────────────┐
      │                  │                       │                  │
┌─────▼───────┐   ┌──────▼──────┐         ┌──────▼───────┐   ┌──────▼───────┐
│   Deezer    │   │   iTunes    │         │ MusicBrainz  │   │   Last.fm    │
│ Public API  │   │ Search API  │         │ WS/2 (1 req/s│   │  (Optional)  │
│ (Keyless)   │   │  (Keyless)  │         │  Keyless)    │   │  Attributed  │
└─────────────┘   └─────────────┘         └──────────────┘   └──────────────┘
```

### Identity Resolution Engine (`artistIdentity.ts`)
To prevent inaccurate artist merging (e.g. distinct artists with common names):
1. **Provider Identifiers**: Exact match on Deezer ID, MusicBrainz MBID, or iTunes ID.
2. **Relationship Links**: Matches artists sharing authoritative external URLs (e.g. MusicBrainz relations pointing to the same Spotify artist URI or Deezer artist page).
3. **Known Aliases**: Checks official aliases recorded in MusicBrainz.
4. **Disambiguation Guards**: If disambiguation strings conflict (e.g., "English rock band" vs "US hip-hop producer"), the engine strictly **refuses** to merge.
5. **Country & Genre Collision Guard**: If artists have different countries of origin and completely disjoint genre token sets, they remain separate candidate entities.

---

## 3. Metadata Providers & Licensing Compliance

| Provider | Authentication | Endpoints Used | Attribution & Compliance |
| :--- | :--- | :--- | :--- |
| **Deezer** | Keyless / Public | `/artist/{id}`, `/top`, `/albums`, `/related`, `/playlists`, `/search/artist`, `/search/album`, `/search/playlist` | Fans count (`nb_fan`), top tracks, categorized discography, and public playlists. Labeled explicitly as Deezer. |
| **MusicBrainz** | Keyless / Open Data | `/ws/2/artist/`, `/ws/2/release-group` | Rate limited to $\le 1\text{ req/sec}$ via an internal queue. Custom User-Agent header `Sinc/1.0.0 ( https://github.com/fax-solo/Sinc )`. Provides MBID, origin country, life-span, aliases, and external link relationships. |
| **iTunes** | Keyless / Public | `/search?entity=musicArtist`, `/search?entity=album`, `/lookup` | Track and album metadata fallback with 300x300 artwork resizing. |
| **Last.fm** | Optional API Key | `artist.getinfo` | Optional secondary enrichment (bio summary, listeners, play count). **Never labeled as Spotify streams or monthly listeners.** All metrics clearly indicate Last.fm. |

---

## 4. Spotify Integration Without Credentials

Sinc provides deep Spotify compatibility without violating Spotify API terms or requiring user credentials:

1. **URL Validation & Normalization (`spotifyUrl.ts`)**:
   - Accurately parses both web URLs (`open.spotify.com/(track|album|artist|playlist)/{id}`) and URIs (`spotify:(track|album|artist|playlist):{id}`).
2. **Official Public oEmbed**:
   - Retrieves playlist, album, and artist title and cover art from `https://open.spotify.com/oembed?url=...` without scraping or private APIs.
3. **Deep Linking ("Open in Spotify")**:
   - Opens the native Spotify app or browser directly via `Linking.openURL`.
4. **Spotify Playlist Importer**:
   - When a Spotify playlist link is entered in Search, Sinc detects the link and offers a 1-tap "Import to Sinc Library" action routed directly to `SpotifyImportScreen`.
5. **Artist Profile Association**:
   - Verified Spotify artist links identified through MusicBrainz relations are presented in the Artist Hub external links bar.
   - Any local playlists containing tracks by the artist are dynamically linked under the artist's playlists section.

---

## 5. Caching & Offline Experience

- **Multi-Tier Caching**:
  - In-memory LRU cache for active UI navigation.
  - Persistent MMKV storage (`hub:artist_hub_v2:{id}`) with a 24-hour retention period.
- **Offline Resiliency**:
  - Saved and downloaded artist releases, popular tracks, and local playlists remain completely accessible and playable when network access is unavailable.

---

## 6. Configuration

Optional Last.fm integration can be enabled by setting `lastFmApiKey` in `config.ts` or passing it dynamically:

```typescript
export const config = {
  githubRepo: 'fax-solo/Sinc',
  githubReleasePageUrl: 'https://github.com/fax-solo/Sinc/releases/latest',
  jamendoClientId: '',
  fmaApiKey: '',
  lastFmApiKey: '', // Optional: Free Last.fm developer key
} as const;
```
If left blank, Last.fm queries are automatically bypassed without warnings or errors.
