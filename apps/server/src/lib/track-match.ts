/**
 * Track matching helpers. Used wherever a search result or provider must be
 * matched against a requested track: download source selection, stream
 * resolution and lyrics lookup. Matching is deliberately variant-aware so a
 * remix/live/lyrics upload is not picked when the user asked for the original.
 */

export interface MatchCandidate {
  title: string;
  artist?: string | null;
  durationMs?: number | null;
  /** Arbitrary payload carried back to the caller (e.g. a URL or provider id). */
  ref?: unknown;
}

export interface MatchQuery {
  title: string;
  artist?: string | null;
  durationMs?: number | null;
}

const VARIANT_TAGS = [
  'remix',
  'remaster',
  'live',
  'lyrics',
  'karaoke',
  'instrumental',
  'acoustic',
  'cover',
  'mashup',
  'sped up',
  'slowed',
  'dance',
  'reverb',
  '8d',
  'loop',
  'edit',
  'version',
  'mix',
  'official video',
  'official audio',
  'official',
  'audio',
  'video',
  'mv',
  'music video',
] as const;

const VARIANT_PENALTY: Record<string, number> = {
  remix: -45,
  mashup: -45,
  'sped up': -45,
  slowed: -45,
  dance: -40,
  reverb: -40,
  '8d': -40,
  loop: -40,
  karaoke: -35,
  instrumental: -35,
  cover: -35,
  lyrics: -30,
  live: -30,
  remaster: -20,
  edit: -25,
  version: -25,
  mix: -25,
  'official video': -15,
  'music video': -15,
  mv: -15,
  video: -15,
  acoustic: -25,
  'official audio': 0,
  official: 0,
  audio: 0,
};

/** Lowercases, removes diacritics and punctuation, collapses whitespace. */
export function normalizeText(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Splits a title into its normalized core by stripping parenthetical tags. */
export function stripVariantTags(title: string): string {
  const withoutParens = title.replace(/\(([^)]*)\)/g, ' $1 ');
  const words = withoutParens
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/gu)
    .filter(Boolean);

  const kept: string[] = [];
  for (const word of words) {
    if ((VARIANT_TAGS as readonly string[]).includes(word)) continue;
    kept.push(word);
  }
  return kept.join(' ');
}

/** Lowercase alphanumeric only — "OT$HA", "OT-SHA" and "ot sha" all match. */
export function compactText(input: string): string {
  return normalizeText(input).replace(/\s+/g, '');
}

/**
 * The "base" title for comparison: every parenthetical is dropped (alternative
 * titles, qualifiers) and variant words removed. Two uploads of the same song
 * share a base even when one adds "(كان فيا شئ جميل وضاع)" or "(Remix)".
 */
export function baseTitle(title: string): string {
  return stripVariantTags(title.replace(/\([^)]*\)/g, ' '));
}

/**
 * Title for search engines. Alternative-title parentheses (which differ per
 * upload and only hurt matching) are dropped, but variant tags like
 * "(Remix)"/"(Live)" are kept so yt-dlp still finds the intended version.
 */
export function searchTitle(title: string): string {
  const variantSet = new Set<string>(VARIANT_TAGS);
  return title
    .replace(/\(([^)]*)\)/g, (match, inner: string) => {
      const words = inner
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean);
      return words.some((w) => variantSet.has(w)) ? match : ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** Token Jaccard similarity between two normalized strings. */
export function tokenSimilarity(a: string, b: string): number {
  const ta = new Set(a.split(' ').filter(Boolean));
  const tb = new Set(b.split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const token of ta) if (tb.has(token)) intersection += 1;
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface ScoredCandidate {
  candidate: MatchCandidate;
  score: number;
  titleScore: number;
  durationScore: number;
}

const MIN_ACCEPT_SCORE = 45;

/**
 * Picks the best-matching candidate for a requested track. Scores are biased
 * toward exact title matches and duration proximity, and penalize uploads that
 * are clearly a different version (remix, live, lyrics, cover, ...) unless the
 * requested title itself asks for that version.
 */
export function pickBestMatch(
  query: MatchQuery,
  candidates: MatchCandidate[]
): ScoredCandidate | null {
  if (candidates.length === 0) return null;

  const qTitleNorm = normalizeText(query.title);
  const qTitleBase = baseTitle(query.title);
  const qArtistNorm = normalizeText(query.artist ?? '');
  const qArtistCompact = compactText(query.artist ?? '');

  const scored: ScoredCandidate[] = candidates.map((candidate) => {
    const cTitleNorm = normalizeText(candidate.title);
    const cTitleBase = baseTitle(candidate.title);

    let titleScore = 0;
    if (cTitleBase && qTitleBase) {
      if (cTitleBase === qTitleBase) titleScore = 100;
      else if (cTitleBase.includes(qTitleBase) || qTitleBase.includes(cTitleBase)) titleScore = 82;
      else titleScore = Math.round(tokenSimilarity(cTitleBase, qTitleBase) * 75);
    } else if (cTitleNorm === qTitleNorm) {
      titleScore = 100;
    }

    let artistScore = 0;
    const cArtistNorm = normalizeText(candidate.artist ?? '');
    const cArtistCompact = compactText(candidate.artist ?? '');
    if (qArtistCompact && cArtistCompact) {
      if (cArtistCompact === qArtistCompact) artistScore = 25;
      else if (cArtistCompact.includes(qArtistCompact) || qArtistCompact.includes(cArtistCompact))
        artistScore = 18;
      else if (tokenSimilarity(cArtistNorm, qArtistNorm) >= 0.5) artistScore = 10;
    }

    let durationScore = 0;
    if (
      query.durationMs &&
      query.durationMs > 0 &&
      candidate.durationMs &&
      candidate.durationMs > 0
    ) {
      const ratio = Math.abs(candidate.durationMs - query.durationMs) / query.durationMs;
      durationScore = Math.max(0, Math.round(25 * (1 - Math.min(ratio, 0.15) / 0.15)));
    }

    let penalty = 0;
    const lowerCandidate = cTitleNorm;
    for (const tag of VARIANT_TAGS) {
      const inCandidate = lowerCandidate.includes(tag);
      const inQuery = qTitleNorm.includes(tag);
      if (inCandidate && !inQuery) penalty += VARIANT_PENALTY[tag] ?? 0;
    }
    // Co-credit separators not present in the requested title signal a
    // mashup/duet upload (e.g. "bloodline x pony").
    const coCredit = /\+|&|\bx\b|,|\bfeat\b|\bft\.?\b|\bwith\b|\bduet\b/i;
    if (coCredit.test(lowerCandidate) && !coCredit.test(qTitleNorm)) penalty -= 40;
    // A different artist's upload gets a hard penalty even if titles coincide.
    if (
      qArtistNorm &&
      cArtistNorm &&
      artistScore === 0 &&
      tokenSimilarity(cArtistNorm, qArtistNorm) < 0.3
    ) {
      penalty -= 50;
    }

    const score = titleScore + artistScore + durationScore + penalty;
    return { candidate, score, titleScore, durationScore };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < MIN_ACCEPT_SCORE) return null;
  return best;
}
