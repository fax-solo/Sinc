package com.sinc.app.modules

import android.util.Log
import java.io.File
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit

/**
 * Reads a finished audio file's real duration by parsing the `Duration:` line
 * from a bundled-ffmpeg `-i` header dump. Shared by the yt module (its
 * post-download guard) and the OkHttp downloader (direct-source validation),
 * so every saved file is length-checked no matter which transfer path
 * produced it. Returns 0 when unconfigured or unreadable. Download callers fail
 * closed on 0 when the catalog length is known rather than publishing an
 * unverified file.
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
    val ffmpeg = ffmpegBinary ?: return AudioProbeResult(
      readable = false,
      hasAudioStream = false,
      durationMs = 0L,
      rawDurationSec = null,
    )
    val libs = libDir ?: return AudioProbeResult(
      readable = false,
      hasAudioStream = false,
      durationMs = 0L,
      rawDurationSec = null,
    )
    return try {
      gate.acquire()
      try {
        val pb = ProcessBuilder(listOf(ffmpeg.absolutePath, "-nostdin", "-i", file.absolutePath))
        pb.redirectErrorStream(false)
        pb.environment().apply {
          put("LD_LIBRARY_PATH", libs.absolutePath)
          put("PATH", "${libs.parentFile?.absolutePath.orEmpty()}:/system/bin:/system/xbin")
        }
        val process = pb.start()
        val stderr = StringBuilder()
        val reader = Thread {
          process.errorStream.bufferedReader().use { r ->
            var line = r.readLine()
            while (line != null) {
              stderr.append(line).append('\n')
              line = r.readLine()
            }
          }
        }.apply { isDaemon = true; start() }
        val finished = process.waitFor(60_000, TimeUnit.MILLISECONDS)
        if (!finished) {
          process.destroyForcibly()
          return AudioProbeResult(
            readable = false,
            hasAudioStream = false,
            durationMs = 0L,
            rawDurationSec = null,
            stderr = "probe timed out",
          )
        }
        reader.join(5000)
        val stderrStr = stderr.toString()
        val hasAudio = Regex("Stream\\s+#\\d+:\\d+.*?:\\s*Audio:").containsMatchIn(stderrStr)
        val hms = Regex("Duration:\\s*(\\d+):(\\d+):([0-9.]+)").find(stderrStr)
        if (hms == null) {
          return AudioProbeResult(
            readable = true,
            hasAudioStream = hasAudio,
            durationMs = 0L,
            rawDurationSec = null,
            stderr = stderrStr,
          )
        }
        val h = hms.groupValues[1].toLongOrNull() ?: 0L
        val m = hms.groupValues[2].toLongOrNull() ?: 0L
        val s = hms.groupValues[3].toDoubleOrNull() ?: 0.0
        val totalSec = (h * 3600.0) + (m * 60.0) + s
        val durationMs = Math.round(totalSec * 1000.0).toLong().coerceAtLeast(0L)
        AudioProbeResult(
          readable = true,
          hasAudioStream = hasAudio,
          durationMs = durationMs,
          rawDurationSec = totalSec,
          stderr = stderrStr,
        )
      } finally {
        gate.release()
      }
    } catch (e: InterruptedException) {
      Thread.currentThread().interrupt()
      AudioProbeResult(
        readable = false,
        hasAudioStream = false,
        durationMs = 0L,
        rawDurationSec = null,
        stderr = "interrupted",
      )
    } catch (e: Exception) {
      Log.w(LOG_TAG, "duration probe failed: ${e.message}")
      AudioProbeResult(
        readable = false,
        hasAudioStream = false,
        durationMs = 0L,
        rawDurationSec = null,
        stderr = e.message.orEmpty(),
      )
    }
  }

  fun probeDuration(file: File): Long = probeAudio(file).durationMs
}
