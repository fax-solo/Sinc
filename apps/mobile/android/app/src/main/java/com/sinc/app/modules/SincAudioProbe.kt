package com.sinc.app.modules

import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.util.Log
import java.io.File
import java.util.concurrent.Semaphore

/**
 * Reads a finished audio file's real duration and verifies that it contains a
 * valid audio stream.
 *
 * Uses a tiered probing approach:
 * 1. Android platform MediaMetadataRetriever (fast, in-process, zero dependencies)
 * 2. Android platform MediaExtractor (direct container track inspection)
 * 3. Bundled FFmpeg probe via SincFfmpeg (fallback for exotic formats)
 *
 * Shared by the yt module (post-download guard) and the OkHttp downloader
 * (direct-source validation).
 */
object SincAudioProbe {
  private const val LOG_TAG = "SincAudioProbe"

  @Volatile
  private var ffmpegBinary: File? = null

  @Volatile
  private var libDir: File? = null

  private val gate = Semaphore(2)

  /** Called by SincYtModule during module init (it owns the binary paths). */
  fun configure(ffmpegBinary: File, libDir: File) {
    this.ffmpegBinary = ffmpegBinary
    this.libDir = libDir
  }

  data class AudioProbeResult(
    val readable: Boolean,
    val hasAudioStream: Boolean,
    val durationMs: Long,
    val rawDurationSec: Double?,
    val stderr: String = "",
  )

  /** Reads comprehensive probe information from the finished audio file. */
  fun probeAudio(file: File): AudioProbeResult {
    if (!file.isFile || file.length() == 0L) {
      return AudioProbeResult(
        readable = false,
        hasAudioStream = false,
        durationMs = 0L,
        rawDurationSec = null,
      )
    }

    val detectedExt = SincAudioContainer.detectExtension(file)
    val isAudioContainer = detectedExt != null

    // Tier 1: Android native MediaMetadataRetriever (fast, in-process, zero external dependencies)
    var nativeDurationMs = 0L
    var nativeHasAudio = false
    var nativeReadable = false

    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(file.absolutePath)
      nativeReadable = true
      val durationStr = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
      val parsedDuration = durationStr?.toLongOrNull() ?: 0L
      if (parsedDuration > 0L) {
        nativeDurationMs = parsedDuration
      }
      val hasAudioStr = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO)
      val mimeType = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_MIMETYPE)
      if (hasAudioStr?.equals("yes", ignoreCase = true) == true ||
        mimeType?.startsWith("audio/", ignoreCase = true) == true ||
        (isAudioContainer && detectedExt != "m4a") ||
        (parsedDuration > 0L && isAudioContainer)
      ) {
        nativeHasAudio = true
      }
    } catch (e: Exception) {
      Log.d(LOG_TAG, "MediaMetadataRetriever probe skipped: ${e.message}")
    } finally {
      try {
        retriever.release()
      } catch (_: Throwable) {}
    }

    // Tier 2: Android native MediaExtractor (inspects actual track mime types)
    if (nativeDurationMs <= 0L || !nativeHasAudio) {
      val extractor = MediaExtractor()
      try {
        extractor.setDataSource(file.absolutePath)
        nativeReadable = true
        var foundAudio = false
        var maxTrackDurationUs = 0L
        for (i in 0 until extractor.trackCount) {
          val format = extractor.getTrackFormat(i)
          val mime = format.getString(MediaFormat.KEY_MIME)
          if (mime?.startsWith("audio/", ignoreCase = true) == true) {
            foundAudio = true
            if (format.containsKey(MediaFormat.KEY_DURATION)) {
              val trackDur = format.getLong(MediaFormat.KEY_DURATION)
              if (trackDur > maxTrackDurationUs) {
                maxTrackDurationUs = trackDur
              }
            }
          }
        }
        if (foundAudio) {
          nativeHasAudio = true
          if (maxTrackDurationUs > 0L && nativeDurationMs <= 0L) {
            nativeDurationMs = maxTrackDurationUs / 1000L
          }
        }
      } catch (e: Exception) {
        Log.d(LOG_TAG, "MediaExtractor probe skipped: ${e.message}")
      } finally {
        try {
          extractor.release()
        } catch (_: Throwable) {}
      }
    }

    // If native platform probe got both duration and audio stream confirmation, return immediately
    if (nativeReadable && nativeDurationMs > 0L && (nativeHasAudio || isAudioContainer)) {
      return AudioProbeResult(
        readable = true,
        hasAudioStream = true,
        durationMs = nativeDurationMs,
        rawDurationSec = nativeDurationMs / 1000.0,
        stderr = "",
      )
    }

    // Tier 3: Bundled FFmpeg probe (fallback for formats unsupported by native extractor)
    val ffmpeg = ffmpegBinary
    val libs = libDir
    var ffmpegDurationMs = 0L
    var ffmpegHasAudio = false
    var ffmpegStderr = ""

    if (ffmpeg != null && ffmpeg.isFile && libs != null && libs.isDirectory) {
      try {
        val result = SincFfmpeg.run(listOf("-nostdin", "-i", file.absolutePath), 30_000L, gate)
        ffmpegStderr = result.stderr
        ffmpegHasAudio = Regex("Stream\\s+#\\d+.*?:\\s*Audio", RegexOption.IGNORE_CASE).containsMatchIn(ffmpegStderr) ||
          ffmpegStderr.contains("Audio:", ignoreCase = true)
        val hms = Regex("Duration:\\s*(\\d+):(\\d+):([0-9.]+)").find(ffmpegStderr)
        if (hms != null) {
          val h = hms.groupValues[1].toLongOrNull() ?: 0L
          val m = hms.groupValues[2].toLongOrNull() ?: 0L
          val s = hms.groupValues[3].toDoubleOrNull() ?: 0.0
          val totalSec = (h * 3600.0) + (m * 60.0) + s
          val dur = Math.round(totalSec * 1000.0).toLong().coerceAtLeast(0L)
          if (dur > 0L) {
            ffmpegDurationMs = dur
          }
        }
      } catch (e: Exception) {
        Log.w(LOG_TAG, "ffmpeg probe failed: ${e.message}")
      }
    }

    // Tier 4: Fallback to best available info
    val bestDuration = when {
      nativeDurationMs > 0L -> nativeDurationMs
      ffmpegDurationMs > 0L -> ffmpegDurationMs
      else -> 0L
    }

    val hasAudio = nativeHasAudio || ffmpegHasAudio || isAudioContainer
    val readable = nativeReadable || ffmpegDurationMs > 0L || (file.isFile && file.length() > 0L)

    return AudioProbeResult(
      readable = readable,
      hasAudioStream = if (bestDuration > 0L && isAudioContainer) true else hasAudio,
      durationMs = bestDuration,
      rawDurationSec = if (bestDuration > 0L) bestDuration / 1000.0 else null,
      stderr = ffmpegStderr,
    )
  }

  fun probeDuration(file: File): Long = probeAudio(file).durationMs
}
