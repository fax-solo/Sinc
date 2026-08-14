/**
 * Pure text normalization utilities shared by backend (search/dedup) and mobile
 * (local search). Deterministic and fully unit-testable - no I/O.
 */

/** Lowercase, NFKD-normalize, strip diacritics, collapse to word chars. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Normalize an artist name for matching: lowercase, strip diacritics,
 * unify "and" -> "&", drop leading "the" (produces a stable sort/matching key).
 */
export function normalizeArtist(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(and|n)\b/g, '&')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^the\s+/, '')
    .replace(/\s+$/, '');
}

/**
 * Strip version/featured-artist suffixes for loose matching:
 * "Song (Remix)" -> "Song", "Song feat. X" -> "Song".
 * Use for fingerprinting, NOT for display.
 */
export function stripVersion(title: string): string {
  return title
    .replace(/\s*\(.*\)\s*$/, '')
    .replace(/\s*-\s*(remix|acoustic|live|instrumental|extended).*$/i, '')
    .replace(/\s*(feat\.?|ft\.?|featuring)\b.*$/i, '')
    .trim();
}

/** Fuzzy similarity in [0,1] using Levenshtein distance. */
export function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0) return 0;
  if (b.length === 0) return 0;

  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1]! === b[j - 1]! ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev.splice(0, prev.length, ...curr);
  }

  const distance = prev[b.length] ?? Math.max(a.length, b.length);
  return Math.max(0, 1 - distance / Math.max(a.length, b.length));
}

/** Are two durations compatible within a 2s / 5% tolerance window? */
export function durationsCompatible(a: number | undefined, b: number | undefined): boolean {
  if (a == null || b == null || a <= 0 || b <= 0) return true;
  const tolerance = Math.max(2000, Math.min(a, b) * 0.05);
  return Math.abs(a - b) <= tolerance;
}

/** Build a stable dedup fingerprint for a track candidate. */
export function trackFingerprint(title: string, artistNames: readonly string[]): string {
  const t = normalizeTitle(stripVersion(title));
  const artists = [...artistNames].map(normalizeArtist).sort().join('&');
  return `${t}|${artists}`;
}
