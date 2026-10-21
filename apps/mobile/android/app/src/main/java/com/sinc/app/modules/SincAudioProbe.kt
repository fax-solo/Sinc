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
 * produced it. Returns 0 when unconfigured or unreadable — callers treat 0 as
 * "unknown", not as a failure.
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

  fun probeDuration(file: File): Long {
    val ffmpeg = ffmpegBinary ?: return 0L
    val libs = libDir ?: return 0L
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
        // The header dump is small, but read off-thread so a chatty stderr can
        // never deadlock the probe against a full pipe buffer.
        val stderr = StringBuilder()
        val reader = Thread {
          process.errorStream.bufferedReader().use { reader ->
            var line = reader.readLine()
            while (line != null) {
              stderr.append(line).append('\n')
              line = reader.readLine()
            }
          }
        }.apply { isDaemon = true; start() }
        val finished = process.waitFor(60_000, TimeUnit.MILLISECONDS)
        if (!finished) {
          process.destroyForcibly()
          return 0L
        }
        reader.join(5000)
        val hms = Regex("Duration:\\s*(\\d+):(\\d+):([0-9.]+)").find(stderr) ?: return 0L
        val h = hms.groupValues[1].toLongOrNull() ?: 0L
        val m = hms.groupValues[2].toLongOrNull() ?: 0L
        val s = hms.groupValues[3].toDoubleOrNull() ?: 0.0
        ((h * 3600L) + (m * 60L) + s.toLong()).coerceAtLeast(0L) * 1000L
      } finally {
        gate.release()
      }
    } catch (e: InterruptedException) {
      Thread.currentThread().interrupt()
      0L
    } catch (e: Exception) {
      Log.w(LOG_TAG, "duration probe failed: ${e.message}")
      0L
    }
  }
}
