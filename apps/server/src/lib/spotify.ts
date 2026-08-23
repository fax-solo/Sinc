import { AppError, NotFoundError } from '@sinc/shared';

/**
 * No-auth Spotify playlist importer (M9.x feature).
 *
 * Spotify's Web API no longer exposes playlist items for arbitrary public
 * links (Feb 2026 change) and requires OAuth for everything else, so we use
 * the same unauthenticated path the public web player uses:
 *
 *  1. Bootstrap a short-lived anonymous access token from a public embed page
 *     (`open.spotify.com/embed/track/{id}`), which embeds the session token in
 *     its `__NEXT_DATA__` payload.
 *  2. Call Spotify's internal GraphQL endpoint (`api-partner.spotify.com/
 *     pathfinder/v1/query`) with the persisted `fetchPlaylist` query hash,
 *     paging by offset/limit (100 per page). This returns the FULL playlist,
 *     including the real `totalCount`, so the 100-track embed cap is bypassed.
 *
 * If the pathfinder route breaks (hash rotation, 401) we fall back to parsing
 * the public embed page's `__NEXT_DATA__` entity, which is capped at 100.
 */

export interface SpotifyRawTrack {
  uri: string;
  title: string;
  artists: string[];
  durationMs: number;
}

export interface SpotifyPlaylistImport {
  id: string;
  name: string;
  owner: string;
  artworkUrl: string | null;
  /** Spotify's reported track total (may include non-track items). */
  totalCount: number | null;
  /** True when the pathfinder route failed and we fell back to the 100-cap embed. */
  truncated: boolean;
  tracks: SpotifyRawTrack[];
}

const EMBED_URL = 'https://open.spotify.com/embed/playlist/';
const TRACK_EMBED_URL = 'https://open.spotify.com/embed/track/';
const PATHFINDER_URL = 'https://api-partner.spotify.com/pathfinder/v1/query';
const FETCH_PLAYLIST_HASH = 'a65e12194ed5fc443a1cdebed5fabe33ca5b07b987185d63c72483867ad13cb4';
const BOOTSTRAP_TRACK_ID = '4uLU6hMCjMI75M1A2tKUQC';
/** Safety cap: never fetch more than this many tracks from one playlist. */
const MAX_TRACKS = 2000;
const PAGE_SIZE = 100;
/** Refresh the anonymous token 60s before it expires. */
const TOKEN_SKEW_MS = 60_000;

const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** Parses a Spotify playlist URL/URI into its playlist id, or null. */
export function parsePlaylistId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const idMatch = trimmed.match(/spotify:playlist:([A-Za-z0-9]{22})/);
  if (idMatch) return idMatch[1];
  const urlMatch = trimmed.match(/open\.spotify\.com\/(?:embed\/)?playlist\/([A-Za-z0-9]{22})/);
  return urlMatch ? urlMatch[1] : null;
}

async function fetchWithTimeout(
  url: string,
  ms = 20_000,
  headers?: Record<string, string>
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml', ...headers },
    });
  } finally {
    clearTimeout(timer);
  }
}

interface AnonymousSession {
  accessToken: string;
  expiresAtMs: number;
}

/** Cached short-lived anonymous token bootstrapped from a public embed page. */
let anonymousSession: AnonymousSession | null = null;

async function getAnonymousToken(): Promise<string> {
  if (anonymousSession && Date.now() < anonymousSession.expiresAtMs - TOKEN_SKEW_MS) {
    return anonymousSession.accessToken;
  }

  let html: string;
  try {
    const res = await fetchWithTimeout(`${TRACK_EMBED_URL}${BOOTSTRAP_TRACK_ID}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch {
    throw new AppError('SPOTIFY_ERROR', 'Could not reach Spotify', 502);
  }

  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!match) throw new AppError('SPOTIFY_ERROR', 'Spotify embed returned unreadable data', 502);

  let json: unknown;
  try {
    json = JSON.parse(match[1]);
  } catch {
    throw new AppError('SPOTIFY_ERROR', 'Spotify embed returned unreadable data', 502);
  }

  const session = (
    json as {
      props?: { pageProps?: { state?: { settings?: { session?: unknown } } } };
    }
  )?.props?.pageProps?.state?.settings?.session as
    { accessToken?: unknown; accessTokenExpirationTimestampMs?: unknown } | undefined;

  if (!session || typeof session.accessToken !== 'string' || !session.accessToken) {
    throw new AppError('SPOTIFY_ERROR', 'Spotify embed returned no session token', 502);
  }

  anonymousSession = {
    accessToken: session.accessToken,
    expiresAtMs:
      typeof session.accessTokenExpirationTimestampMs === 'number'
        ? session.accessTokenExpirationTimestampMs
        : Date.now() + 60 * 60 * 1000,
  };
  return anonymousSession.accessToken;
}

/** One page (≤100 tracks) of a playlist from the pathfinder GraphQL endpoint. */
async function fetchPlaylistPage(
  id: string,
  token: string,
  offset: number
): Promise<SpotifyPlaylistImport | null> {
  const params = new URLSearchParams({
    operationName: 'fetchPlaylist',
    variables: JSON.stringify({
      uri: `spotify:playlist:${id}`,
      offset,
      limit: PAGE_SIZE,
      enableWatchFeedEntrypoint: false,
    }),
    extensions: JSON.stringify({ persistedQuery: { version: 1, sha256Hash: FETCH_PLAYLIST_HASH } }),
  });

  const res = await fetchWithTimeout(`${PATHFINDER_URL}?${params}`, 20_000, {
    Authorization: `Bearer ${token}`,
    'app-platform': 'WebPlayer',
    Accept: 'application/json',
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new AppError('SPOTIFY_ERROR', `Spotify pathfinder returned ${res.status}`, 502);
  }

  let body: { data?: { playlistV2?: unknown } } | null = null;
  try {
    body = (await res.json()) as { data?: { playlistV2?: unknown } };
  } catch {
    throw new AppError('SPOTIFY_ERROR', 'Spotify returned an unreadable response', 502);
  }

  const pv = body?.data?.playlistV2 as
    | {
        name?: unknown;
        ownerV2?: unknown;
        images?: unknown;
        content?: unknown;
      }
    | undefined;
  if (!pv) throw new NotFoundError('Spotify playlist');

  const content = (pv.content ?? {}) as {
    totalCount?: unknown;
    items?: unknown;
  };
  const items = Array.isArray(content.items) ? content.items : [];
  const tracks = items
    .map((raw) => {
      const data = (raw as { itemV2?: { data?: unknown } })?.itemV2?.data as
        | {
            __typename?: unknown;
            uri?: unknown;
            name?: unknown;
            trackDuration?: unknown;
            artists?: unknown;
          }
        | undefined;
      if (!data || data.__typename !== 'Track') return null;
      const title = typeof data.name === 'string' ? data.name.trim() : '';
      if (!title) return null;
      const duration = (data.trackDuration ?? {}) as { totalMilliseconds?: unknown };
      const artistsNode = (data.artists ?? {}) as { items?: unknown };
      const artistItems = Array.isArray(artistsNode.items) ? artistsNode.items : [];
      const artists = artistItems
        .map((a) => (a as { profile?: { name?: unknown } })?.profile?.name)
        .filter((n): n is string => typeof n === 'string' && n.length > 0);
      return {
        uri: typeof data.uri === 'string' ? data.uri : '',
        title,
        artists,
        durationMs: typeof duration.totalMilliseconds === 'number' ? duration.totalMilliseconds : 0,
      };
    })
    .filter((t): t is SpotifyRawTrack => t !== null);

  const ownerV2 = (pv.ownerV2 ?? {}) as { data?: { name?: unknown } };
  const images = (pv.images ?? {}) as { items?: unknown };

  return {
    id,
    name: typeof pv.name === 'string' ? pv.name : 'Spotify playlist',
    owner: typeof ownerV2.data?.name === 'string' ? ownerV2.data.name : '',
    artworkUrl: firstCoverUrl(images.items),
    totalCount: typeof content.totalCount === 'number' ? content.totalCount : null,
    truncated: false,
    tracks,
  };
}

/** Fallback: parse the public embed page (capped at 100 tracks). */
async function fetchPlaylistFromEmbed(id: string): Promise<SpotifyPlaylistImport> {
  let res: Response;
  try {
    res = await fetchWithTimeout(`${EMBED_URL}${id}`);
  } catch {
    throw new AppError('SPOTIFY_ERROR', 'Could not reach Spotify', 502);
  }
  if (res.status === 404) throw new NotFoundError('Spotify playlist');
  if (!res.ok) throw new AppError('SPOTIFY_ERROR', `Spotify embed returned ${res.status}`, 502);

  const html = await res.text();
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!match) throw new NotFoundError('Spotify playlist');

  let json: unknown;
  try {
    json = JSON.parse(match[1]);
  } catch {
    throw new AppError('SPOTIFY_ERROR', 'Spotify embed returned unreadable data', 502);
  }

  const entity = (json as { props?: { pageProps?: { state?: { data?: { entity?: unknown } } } } })
    ?.props?.pageProps?.state?.data?.entity as
    | {
        name?: unknown;
        subtitle?: unknown;
        coverArt?: unknown;
        trackList?: unknown;
      }
    | undefined;

  if (!entity) throw new NotFoundError('Spotify playlist');

  const trackList = Array.isArray(entity.trackList) ? entity.trackList : [];
  const tracks: SpotifyRawTrack[] = trackList
    .map((raw) => {
      const item = raw as {
        uri?: unknown;
        title?: unknown;
        subtitle?: unknown;
        duration?: unknown;
      };
      const title = typeof item.title === 'string' ? item.title.trim() : '';
      if (!title) return null;
      const artists =
        typeof item.subtitle === 'string'
          ? item.subtitle
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
      const durationMs = typeof item.duration === 'number' ? item.duration : 0;
      return {
        uri: typeof item.uri === 'string' ? item.uri : '',
        title,
        artists,
        durationMs,
      };
    })
    .filter((t): t is SpotifyRawTrack => t !== null);

  return {
    id,
    name: typeof entity.name === 'string' ? entity.name : 'Spotify playlist',
    owner: typeof entity.subtitle === 'string' ? entity.subtitle : '',
    artworkUrl: coverArtUrl(entity.coverArt),
    totalCount: null,
    truncated: true,
    tracks,
  };
}

/** Fetches a playlist's track list, bypassing Spotify's 100-track embed cap. */
export async function fetchPlaylistTracks(id: string): Promise<SpotifyPlaylistImport> {
  const pages: SpotifyPlaylistImport[] = [];
  let token = '';
  let firstTry = true;

  try {
    token = await getAnonymousToken();
    let offset = 0;
    let collected = 0;
    for (;;) {
      let page: SpotifyPlaylistImport | null;
      try {
        page = await fetchPlaylistPage(id, token, offset);
      } catch (err) {
        // Retry once with a fresh token when the anonymous token is rejected.
        if (firstTry && err instanceof AppError && err.code === 'SPOTIFY_ERROR') {
          anonymousSession = null;
          token = await getAnonymousToken();
          firstTry = false;
          page = await fetchPlaylistPage(id, token, offset);
        } else {
          throw err;
        }
      }
      if (!page) throw new NotFoundError('Spotify playlist');
      pages.push(page);
      collected += page.tracks.length;
      offset += PAGE_SIZE;
      const lastPage = page.tracks.length < PAGE_SIZE;
      const done =
        page.tracks.length === 0 ||
        lastPage ||
        collected >= MAX_TRACKS ||
        (page.totalCount !== null && collected >= page.totalCount);
      if (done) break;
    }
  } catch {
    // The pathfinder route is unavailable (rotated hash, token failure): fall
    // back to the public embed page, which is capped at 100 tracks.
    return fetchPlaylistFromEmbed(id);
  }

  const first = pages[0];
  const allTracks = pages.flatMap((p) => p.tracks);
  return {
    id,
    name: first.name,
    owner: first.owner,
    artworkUrl: first.artworkUrl,
    totalCount: first.totalCount ?? allTracks.length,
    truncated: allTracks.length >= MAX_TRACKS,
    tracks: allTracks,
  };
}

function firstCoverUrl(items: unknown): string | null {
  if (!Array.isArray(items)) return null;
  const first = items[0] as { sources?: unknown } | undefined;
  if (!first) return null;
  if (Array.isArray(first.sources)) {
    const source = first.sources[0] as { url?: unknown } | undefined;
    if (source && typeof source.url === 'string') return source.url;
  }
  return null;
}

function coverArtUrl(coverArt: unknown): string | null {
  if (!coverArt || typeof coverArt !== 'object') return null;
  const art = coverArt as { sources?: unknown[]; uri?: unknown };
  if (Array.isArray(art.sources)) {
    const first = art.sources[0] as { url?: unknown } | undefined;
    if (first && typeof first.url === 'string') return first.url;
  }
  return typeof art.uri === 'string' ? art.uri : null;
}
