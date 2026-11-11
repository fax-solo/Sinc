package com.sinc.app.modules

import android.util.Log
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit

/**
 * Runs the bundled ffmpeg with the Termux-style library environment. Shared by
 * the yt-dlp post-processor and the direct-source tagger; ffmpeg is not a
 * python zipapp, so the yt-dlp `run()` helper cannot be used for it.
 */
object SincFfmpeg {
  private const val LOG_TAG = "SincFfmpeg"
  private const val MAX_STREAM_BYTES = 512 * 1024

  data class Result(val stdout: String, val stderr: String, val code: Int)

  @Volatile
  private var binary: File? = null

  @Volatile
  private var libDir: File? = null

  @Volatile
  private var pathDir: File? = null

  fun configure(binary: File, libDir: File, pathDir: File) {
    this.binary = binary
    this.libDir = libDir
    this.pathDir = pathDir
  }

  fun run(args: List<String>, timeoutMs: Long, gate: Semaphore): Result {
    val first = runOnce(args, timeoutMs, gate, preloadShim = false)
    val stderr = first.stderr.trim()
    if (first.code != 0 && stderr.contains("CANNOT LINK")) {
      Log.w(LOG_TAG, "ffmpeg link partial; retrying with platform-ns shim: ${stderr.take(300)}")
      val second = runOnce(args, timeoutMs, gate, preloadShim = true)
      if (second.code == 0) return second
      Log.w(LOG_TAG, "shim retry failed; retrying with app-libdir-only LD_LIBRARY_PATH")
      return runOnce(args, timeoutMs, gate, preloadShim = false, appLibDirOnly = true)
    }
    return first
  }

  private fun runOnce(
    args: List<String>,
    timeoutMs: Long,
    gate: Semaphore,
    preloadShim: Boolean,
    appLibDirOnly: Boolean = false,
  ): Result {
    val ffmpeg = binary ?: return Result("", "ffmpeg is not configured", -1)
    val libs = libDir ?: return Result("", "ffmpeg libs are not configured", -1)
    gate.acquire()
    return try {
      val processBuilder = ProcessBuilder(listOf(ffmpeg.absolutePath) + args)
      processBuilder.redirectErrorStream(false)
      processBuilder.environment().apply {
        put(
          "LD_LIBRARY_PATH",
          if (appLibDirOnly) libs.absolutePath else
            "${libs.absolutePath}:/system/lib64:/system_ext/lib64:/vendor/lib64",
        )
        if (preloadShim) {
          put("LD_PRELOAD", File(libs, "libtermux-platform-ns.so").absolutePath)
        }
        put("PATH", "${pathDir?.absolutePath ?: ""}:/system/bin:/system/xbin")
      }
      val process = processBuilder.start()
      var stdout = ""
      var stderr = ""
      val stdoutReader = Thread {
        stdout = readLimited(process.inputStream)
      }.apply { start() }
      val stderrReader = Thread {
        stderr = readLimited(process.errorStream)
      }.apply { start() }
      val finished = process.waitFor(timeoutMs, TimeUnit.MILLISECONDS)
      if (!finished) {
        process.destroyForcibly()
        throw IllegalStateException("ffmpeg timed out")
      }
      stdoutReader.join(2_000)
      stderrReader.join(2_000)
      Result(stdout, stderr, process.exitValue())
    } catch (e: InterruptedException) {
      Thread.currentThread().interrupt()
      throw IllegalStateException("ffmpeg interrupted")
    } finally {
      gate.release()
    }
  }

  private fun readLimited(input: InputStream): String {
    val out = ByteArrayOutputStream()
    val buffer = ByteArray(8 * 1024)
    var total = 0
    while (true) {
      val read = input.read(buffer)
      if (read < 0) break
      if (total < MAX_STREAM_BYTES) {
        val take = minOf(read, MAX_STREAM_BYTES - total)
        out.write(buffer, 0, take)
        total += take
      }
    }
    return out.toString(Charsets.UTF_8.name())
  }
}
