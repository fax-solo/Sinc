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
import org.json.JSONObject

object SincDownloadRules {
  const val MIN_FULL_LENGTH_MS = 45_000L
  const val MAX_UNKNOWN_LENGTH_MS = 20 * 60 * 1000L
  const val MIN_TOLERANCE_MS = 8_000L
  const val MAX_TOLERANCE_MS = 15_000L
  const val TOLERANCE_RATIO = 0.04
  const val TRUNCATED_RATIO = 0.50

  data class ValidationDiagnostic(
    val status: String,
    val reason: String?,
    val sourceDuration: Double?,
    val downloadedDuration: Double?,
    val difference: Double?,
    val differencePercentage: Double?,
    val validationPolicy: String,
    val fileReadable: Boolean,
    val hasAudioStream: Boolean = true,
    val message: String? = null,
  ) {
    val isValid: Boolean get() = status == "validation_passed"

    fun toJsonObject(): JSONObject = JSONObject().apply {
      put("status", status)
      reason?.let { put("reason", it) }
      sourceDuration?.let { put("sourceDuration", it) }
      downloadedDuration?.let { put("downloadedDuration", it) }
      difference?.let { put("difference", it) }
      differencePercentage?.let { put("differencePercentage", it) }
      put("validationPolicy", validationPolicy)
      put("fileReadable", fileReadable)
      put("hasAudioStream", hasAudioStream)
      message?.let { put("message", it) }
    }

    fun toJson(): String = toJsonObject().toString()
  }

  fun durationToleranceMs(expectedMs: Long): Long {
    val calculated = (expectedMs * TOLERANCE_RATIO).toLong()
    return calculated.coerceIn(MIN_TOLERANCE_MS, MAX_TOLERANCE_MS)
  }

  fun validateAudio(
    actualMs: Long,
    expectedMs: Long?,
    fileReadable: Boolean = true,
    hasAudioStream: Boolean = true,
  ): ValidationDiagnostic {
    val actualSec = actualMs / 1000.0
    val expectedSec = if (expectedMs != null && expectedMs > 0L) expectedMs / 1000.0 else null

    if (!fileReadable) {
      return ValidationDiagnostic(
        status = "validation_failed",
        reason = "invalid_audio",
        sourceDuration = expectedSec,
        downloadedDuration = if (actualMs > 0) actualSec else null,
        difference = null,
        differencePercentage = null,
        validationPolicy = "duration_tolerance_v2",
        fileReadable = false,
        hasAudioStream = false,
        message = "File is not readable audio",
      )
    }

    if (!hasAudioStream) {
      return ValidationDiagnostic(
        status = "validation_failed",
        reason = "invalid_audio",
        sourceDuration = expectedSec,
        downloadedDuration = actualSec,
        difference = null,
        differencePercentage = null,
        validationPolicy = "duration_tolerance_v2",
        fileReadable = true,
        hasAudioStream = false,
        message = "File contains no valid audio stream",
      )
    }

    if (actualMs <= 0L) {
      return ValidationDiagnostic(
        status = "validation_failed",
        reason = "ffprobe_failure",
        sourceDuration = expectedSec,
        downloadedDuration = 0.0,
        difference = expectedSec,
        differencePercentage = 100.0,
        validationPolicy = "duration_tolerance_v2",
        fileReadable = true,
        hasAudioStream = true,
        message = "Failed to probe audio duration",
      )
    }

    if (actualMs < MIN_FULL_LENGTH_MS && (expectedMs == null || expectedMs >= MIN_FULL_LENGTH_MS)) {
      return ValidationDiagnostic(
        status = "validation_failed",
        reason = "truncated_file",
        sourceDuration = expectedSec,
        downloadedDuration = actualSec,
        difference = expectedSec?.let { (it - actualSec).coerceAtLeast(0.0) },
        differencePercentage =
          expectedSec?.let { (((it - actualSec) / it) * 100.0).coerceAtLeast(0.0) },
        validationPolicy = "duration_tolerance_v2",
        fileReadable = true,
        hasAudioStream = true,
        message = "Downloaded audio is shorter than minimum track length (${actualSec}s < 45s)",
      )
    }

    if (expectedMs == null || expectedMs <= 0L) {
      if (actualMs > MAX_UNKNOWN_LENGTH_MS) {
        return ValidationDiagnostic(
          status = "validation_failed",
          reason = "duration_mismatch",
          sourceDuration = null,
          downloadedDuration = actualSec,
          difference = null,
          differencePercentage = null,
          validationPolicy = "duration_tolerance_v2",
          fileReadable = true,
          hasAudioStream = true,
          message = "Audio exceeds maximum duration for unknown length (${actualSec}s > 1200s)",
        )
      }
      return ValidationDiagnostic(
        status = "validation_passed",
        reason = null,
        sourceDuration = null,
        downloadedDuration = actualSec,
        difference = null,
        differencePercentage = null,
        validationPolicy = "duration_tolerance_v2",
        fileReadable = true,
        hasAudioStream = true,
      )
    }

    val validExpectedSec = expectedMs / 1000.0

    // Check truncated relative to expected (< 50%)
    if (actualMs < (expectedMs * TRUNCATED_RATIO).toLong()) {
      val diff = Math.abs(actualSec - validExpectedSec)
      val pct = (diff / validExpectedSec) * 100.0
      return ValidationDiagnostic(
        status = "validation_failed",
        reason = "truncated_file",
        sourceDuration = validExpectedSec,
        downloadedDuration = actualSec,
        difference = Math.round(diff * 100.0) / 100.0,
        differencePercentage = Math.round(pct * 100.0) / 100.0,
        validationPolicy = "duration_tolerance_v2",
        fileReadable = true,
        hasAudioStream = true,
        message = "Downloaded audio is severely truncated (< 50% of expected duration)",
      )
    }

    val diffMs = Math.abs(actualMs - expectedMs)
    val diffSec = diffMs / 1000.0
    val diffPct = (diffSec / validExpectedSec) * 100.0
    val toleranceMs = durationToleranceMs(expectedMs)

    if (diffMs > toleranceMs) {
      val reason = if (diffPct > 20.0 || diffSec > 30.0) "incorrect_version" else "duration_mismatch"
      return ValidationDiagnostic(
        status = "validation_failed",
        reason = reason,
        sourceDuration = validExpectedSec,
        downloadedDuration = actualSec,
        difference = Math.round(diffSec * 100.0) / 100.0,
        differencePercentage = Math.round(diffPct * 100.0) / 100.0,
        validationPolicy = "duration_tolerance_v2",
        fileReadable = true,
        hasAudioStream = true,
        message =
          "Downloaded duration (${actualSec}s) differs from expected (${validExpectedSec}s) by ${Math.round(diffSec * 10.0) / 10.0}s (${Math.round(diffPct * 10.0) / 10.0}%), tolerance is ${toleranceMs / 1000.0}s",
      )
    }

    return ValidationDiagnostic(
      status = "validation_passed",
      reason = null,
      sourceDuration = validExpectedSec,
      downloadedDuration = actualSec,
      difference = Math.round(diffSec * 100.0) / 100.0,
      differencePercentage = Math.round(diffPct * 100.0) / 100.0,
      validationPolicy = "duration_tolerance_v2",
      fileReadable = true,
      hasAudioStream = true,
    )
  }

  fun isDurationAcceptable(actualMs: Long, expectedMs: Long?): Boolean =
    validateAudio(actualMs, expectedMs).isValid

  fun resolveCacheKey(normalizedQuery: String, durationMs: Long?, strict: Boolean): String =
    "$normalizedQuery|${durationMs ?: 0L}|${if (strict) "s" else "l"}"
}
