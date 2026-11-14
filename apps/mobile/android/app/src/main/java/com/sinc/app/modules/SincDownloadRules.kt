package com.sinc.app.modules

/**
 * Pure rules shared by the two download paths (OkHttp direct sources and the
 * yt-dlp engine).
 *
 * The old engine guard accepted anything from 0.5x to 2x the catalog
 * duration, so a wrong upload that happened to be roughly song-length was
 * saved and tagged as the requested track. A download must now be within a
 * few seconds of the chosen track; the direct path already matches candidates
 * on title/artist before transfer, and the engine matches them from its
 * search result metadata.
 *
 * [resolveCacheKey] is the other half of the wrong-song fix: playback and
 * prefetch resolve leniently (covers are allowed when nothing better exists),
 * while downloads resolve strictly. Sharing one cache entry let a lenient
 * prefetch satisfy a strict download. The strictness + duration are part of
 * the key so the two modes can never cross-contaminate.
 */
object SincDownloadRules {
  const val MIN_FULL_LENGTH_MS = 45_000L
  const val MAX_UNKNOWN_LENGTH_MS = 20 * 60 * 1000L
  const val MIN_TOLERANCE_MS = 5_000L
  const val TOLERANCE_RATIO = 0.03

  fun durationToleranceMs(expectedMs: Long): Long =
    maxOf(MIN_TOLERANCE_MS, (expectedMs * TOLERANCE_RATIO).toLong())

  fun isDurationAcceptable(actualMs: Long, expectedMs: Long?): Boolean {
    // Zero is a failed probe, not "unknown". The engine always has ffmpeg, so
    // an unreadable result is not safe to tag and publish.
    if (actualMs < MIN_FULL_LENGTH_MS) return false
    if (expectedMs == null || expectedMs <= 0L) return actualMs <= MAX_UNKNOWN_LENGTH_MS
    return kotlin.math.abs(actualMs - expectedMs) <= durationToleranceMs(expectedMs)
  }

  fun resolveCacheKey(normalizedQuery: String, durationMs: Long?, strict: Boolean): String =
    "$normalizedQuery|${durationMs ?: 0L}|${if (strict) "s" else "l"}"
}
