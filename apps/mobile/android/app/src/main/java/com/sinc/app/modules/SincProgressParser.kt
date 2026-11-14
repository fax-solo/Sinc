package com.sinc.app.modules

import org.json.JSONObject

/**
 * One honest progress sample from either the bundled yt-dlp engine or the
 * plain-HTTPS downloader.
 *
 * yt-dlp's human-oriented `[download]` lines are not a contract: their wording
 * and destination stream have changed between releases. When supported we ask
 * for a structured JSON template on stdout instead. The legacy parser remains
 * only as a compatibility fallback for older engine builds.
 */
data class DownloadProgressUpdate(
  /** 0..99, or null when the total size is genuinely unknown. */
  val percent: Int?,
  val bytesDownloaded: Long?,
  val bytesTotal: Long?,
  val speedBytesPerSec: Double?,
  val speedText: String?,
  val finished: Boolean,
)

/** Pure parser so malformed/mixed output can be regression-tested off-device. */
object SincProgressParser {
  const val PREFIX = "SINC_PROGRESS "
  private const val MAX_PERCENT = 99

  /**
   * Matches the old human line:
   * `[download]  12.4% of 8.32MiB at 214.55KiB/s ETA 00:34`
   * It only supplies a percentage/speed; byte counts stay unknown.
   */
  private val legacyPattern = Regex(
    "\\[download\\]\\s+([0-9]+(?:\\.[0-9]+)?)%" +
      "(?:\\s+of\\s+(\\S+))?" +
      "(?:\\s+at\\s+(\\S+))?",
    RegexOption.IGNORE_CASE,
  )

  fun parse(line: String): DownloadProgressUpdate? {
    val trimmed = line.trim()
    if (trimmed.isEmpty()) return null
    if (trimmed.startsWith(PREFIX)) {
      return parseStructured(trimmed.removePrefix(PREFIX).trim())
    }
    return parseLegacy(trimmed)
  }

  private fun parseStructured(payload: String): DownloadProgressUpdate? {
    return try {
      val root = JSONObject(payload)
      val status = root.optString("status", "").lowercase()
      val downloaded = root.optLong("downloaded_bytes", -1L).takeIf { it >= 0L }
      val total = totalBytes(root)
      val rawPercent = root.optDouble("_percent", Double.NaN)
      val computedPercent = when {
        rawPercent.isFinite() && rawPercent >= 0.0 -> rawPercent
        downloaded != null && total != null && total > 0L ->
          (downloaded.toDouble() / total.toDouble()) * 100.0
        else -> null
      }
      val percent = computedPercent
        ?.takeIf { it.isFinite() }
        ?.toInt()
        ?.coerceIn(0, MAX_PERCENT)
      val speed = root.optDouble("speed", Double.NaN)
        .takeIf { it.isFinite() && it > 0.0 }
      val speedText = root.optString("_speed_str", "")
        .trim()
        .takeIf { it.isNotEmpty() && !it.contains("unknown", ignoreCase = true) }

      // A payload with no usable fields (e.g. an error object) must not clear
      // an existing bar or produce a bogus 0%.
      if (percent == null && downloaded == null && total == null && speed == null &&
        speedText == null && status != "finished"
      ) {
        return null
      }
      DownloadProgressUpdate(
        percent = percent,
        bytesDownloaded = downloaded,
        bytesTotal = total,
        speedBytesPerSec = speed,
        speedText = speedText,
        finished = status == "finished" || (computedPercent ?: 0.0) >= 100.0,
      )
    } catch (_: Exception) {
      // Truncated/partial stdout lines are expected during teardown.
      null
    }
  }

  private fun totalBytes(root: JSONObject): Long? {
    if (!root.isNull("total_bytes")) {
      val direct = root.optLong("total_bytes", -1L)
      if (direct > 0L) return direct
    }
    if (!root.isNull("total_bytes_estimate")) {
      val estimate = root.optDouble("total_bytes_estimate", -1.0)
      if (estimate.isFinite() && estimate > 0.0) return estimate.toLong()
    }
    return null
  }

  private fun parseLegacy(line: String): DownloadProgressUpdate? {
    val match = legacyPattern.find(line) ?: return null
    val rawPercent = match.groupValues.getOrNull(1)?.toDoubleOrNull() ?: return null
    if (!rawPercent.isFinite()) return null
    val percent = rawPercent.toInt().coerceIn(0, MAX_PERCENT)
    val speedText = match.groupValues.getOrNull(3)
      ?.trim()
      ?.takeIf { it.isNotEmpty() && !it.contains("unknown", ignoreCase = true) }
    return DownloadProgressUpdate(
      percent = percent,
      bytesDownloaded = null,
      bytesTotal = null,
      speedBytesPerSec = null,
      speedText = speedText,
      finished = rawPercent >= 100.0,
    )
  }
}
