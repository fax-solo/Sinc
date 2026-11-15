/**
 * Text normalization and script helpers shared across mobile and server.
 * Handles Unicode NFKD decomposition, diacritics stripping, Arabic letter folding,
 * punctuation normalization, and script detection.
 */

/**
 * Normalizes text for matching and search:
 * - NFKD decomposition
 * - Strips combining diacritical marks (\p{M})
 * - Folds visual variants in Arabic:
 *     teh marbuta (ة) -> heh (ه)
 *     alef maqsura (ى) / farsi yeh (ی) -> yeh (ي)
 *     tatweel / kashida (ـ) -> removed
 * - Lowercases
 * - Strips non-alphanumeric punctuation while collapsing spaces
 */
export function normalizeText(input: string): string {
  if (!input) return '';
  return input
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[\u0629\u06C0\u06C2]/g, '\u0647')
    .replace(/[\u0649\u06CC\u06C1\u06D2]/g, '\u064A')
    .replace(/\u0640/g, '')
    .replace(/\$/g, 's')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Strips whitespace and non-alphanumerics completely for compact comparison.
 * e.g., "OT$HA" -> "otsha", "OT-SHA" -> "otsha".
 */
export function compactText(input: string): string {
  return normalizeText(input).replace(/\s+/g, '');
}

/**
 * Detects whether the string contains non-Latin scripts (Arabic, Hebrew,
 * Devanagari, Hangul, Hiragana, Katakana, Greek, Cyrillic).
 */
export function isNonLatin(query: string): boolean {
  if (!query) return false;
  return /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Devanagari}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Greek}\p{Script=Cyrillic}]/u.test(
    query
  );
}

/**
 * Splits input into normalized tokens for token-based matching.
 */
export function tokenize(input: string): string[] {
  const norm = normalizeText(input);
  return norm ? norm.split(' ').filter(Boolean) : [];
}
