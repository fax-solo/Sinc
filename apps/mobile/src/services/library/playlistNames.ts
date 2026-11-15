/** A new-playlist action should not create a pile of identically named rows. */
export function nextPlaylistName(playlists: Array<{ name: string }>): string {
  const base = 'New playlist';
  if (!playlists.some((playlist) => playlist.name === base)) return base;
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${base} ${index}`;
    if (!playlists.some((playlist) => playlist.name === candidate)) return candidate;
  }
  return `${base} ${Date.now()}`;
}
