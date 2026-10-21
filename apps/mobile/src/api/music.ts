/**
 * Music data access for screens. The local build re-exports the on-device
 * implementation (`services/local/musicApi.ts`), which talks directly to
 * third-party providers — iTunes, Deezer, LRCLIB, the bundled yt-dlp engine,
 * Internet Archive — with no backend in between.
 */
export * from '../services/local/musicApi';
