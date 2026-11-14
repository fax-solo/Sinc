package com.sinc.app.modules

import android.util.Log
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * Content-level download verification.
 *
 * The catalog's short preview is the trusted reference. Both it and the
 * finished file are decoded by the bundled ffmpeg and reduced to landmark
 * hashes by [SincFingerprint]. A strong match at one time offset means the
 * download really contains the selected recording; otherwise the caller
 * deletes it instead of publishing an unverified/wrong file.
 *
 * This is deliberately independent of titles, artwork and duration: a source
 * can lie convincingly about all three.
 */
object SincAudioFingerprint {
  private const val LOG_TAG = "SincAudioFingerprint"
  private const val PREVIEW_MAX_BYTES = 12L * 1024 * 1024
  private const val PREVIEW_MAX_SECONDS = 60
  private const val FULL_MAX_SECONDS = 20 * 60
  private const val DECODE_TIMEOUT_MS = 180_000L
  private const val MAX_CACHED_PREVIEWS = 32
  private const val USER_AGENT =
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Sinc/1.0"

  enum class Status {
    /** The finished file contains the preview recording. */
    MATCH,
    /** The finished file is a different recording. */
    MISMATCH,
    /** There is no usable reference (no preview, or a silent preview). */
    NO_REFERENCE,
    /** A preview URL was supplied but could not be downloaded/decoded. */
    UNAVAILABLE,
  }

  data class Verification(
    val status: Status,
    val reason: String = "",
    val matches: Int = 0,
    val referenceHashes: Int = 0,
    val offsetFrames: Int = 0,
  )

  @Volatile
  private var ffmpegBinary: File? = null

  @Volatile
  private var libDir: File? = null

  @Volatile
  private var previewDir: File? = null

  private val gate = Semaphore(1)
  private val client = OkHttpClient.Builder()
    .connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(30, TimeUnit.SECONDS)
    .followRedirects(true)
    .build()

  /** Called by the yt-dlp module during init (it owns the bundled binaries). */
  fun configure(ffmpeg: File, libs: File, cacheRoot: File) {
    ffmpegBinary = ffmpeg
    libDir = libs
    previewDir = File(cacheRoot, "sinc_previews")
  }

  fun verify(file: File, previewUrl: String?): Verification {
    val url = previewUrl?.trim().orEmpty()
    if (url.isEmpty()) return Verification(Status.NO_REFERENCE, "no preview URL")
    val ffmpeg = ffmpegBinary ?: return Verification(Status.UNAVAILABLE, "verifier not configured")
    val libs = libDir ?: return Verification(Status.UNAVAILABLE, "verifier not configured")
    val cache = previewDir ?: return Verification(Status.UNAVAILABLE, "preview cache unavailable")

    return try {
      gate.acquire()
      try {
        val preview = downloadPreview(url, cache)
          ?: return Verification(Status.UNAVAILABLE, "preview download failed")
        // A stale/truncated cache entry is recoverable; a genuinely bad URL is
        // reported as unavailable below on the second attempt.
        val reference = decodeSamples(ffmpeg, libs, preview, PREVIEW_MAX_SECONDS)
          ?: run {
            preview.delete()
            val fresh = downloadPreview(url, cache)
              ?: return Verification(Status.UNAVAILABLE, "preview download failed")
            decodeSamples(ffmpeg, libs, fresh, PREVIEW_MAX_SECONDS)
              ?: return Verification(Status.UNAVAILABLE, "preview decode failed")
          }

        val referenceHashes = SincFingerprint.fingerprint(reference)
        if (referenceHashes.size < SincFingerprint.MIN_REFERENCE_HASHES) {
          return Verification(
            Status.NO_REFERENCE,
            "preview has too little audio detail",
            referenceHashes = referenceHashes.size,
          )
        }

        // Release the reference PCM before decoding the full track: long files
        // can be ~20 MB of PCM and the hashes are all that is needed.
        val full = decodeSamples(ffmpeg, libs, file, FULL_MAX_SECONDS)
          ?: return Verification(
            Status.MISMATCH,
            "downloaded audio could not be decoded",
            referenceHashes = referenceHashes.size,
          )
        val fullHashes = SincFingerprint.fingerprint(full)
        val match = SincFingerprint.match(referenceHashes, fullHashes)
        val accepted = SincFingerprint.isMatch(match)
        val result = Verification(
          status = if (accepted) Status.MATCH else Status.MISMATCH,
          reason = if (accepted) "matched catalog preview" else "audio does not match catalog preview",
          matches = match.matches,
          referenceHashes = match.referenceHashes,
          offsetFrames = match.offsetFrames,
        )
        Log.i(
          LOG_TAG,
          "verify ${result.status} file=${file.name} score=${result.matches}/" +
            "${result.referenceHashes} offset=${result.offsetFrames}",
        )
        result
      } finally {
        gate.release()
      }
    } catch (e: InterruptedException) {
      Thread.currentThread().interrupt()
      Verification(Status.UNAVAILABLE, "verification interrupted")
    } catch (e: Exception) {
      Log.w(LOG_TAG, "verification failed: ${e.message}")
      Verification(Status.UNAVAILABLE, "verification failed")
    }
  }

  private fun downloadPreview(url: String, cache: File): File? {
    val parsed = url.toHttpUrlOrNull() ?: return null
    if (parsed.scheme != "https" && parsed.scheme != "http") return null
    cache.mkdirs()
    val name = MessageDigest.getInstance("SHA-256")
      .digest(url.toByteArray(Charsets.UTF_8))
      .joinToString("") { "%02x".format(it) }
    val target = File(cache, "$name.audio")
    if (target.exists() && target.length() > 1_024L) return target

    repeat(2) { attempt ->
      if (attempt > 0) {
        try {
          Thread.sleep(500)
        } catch (e: InterruptedException) {
          Thread.currentThread().interrupt()
          return null
        }
      }
      try {
        val request = Request.Builder()
          .url(parsed)
          .header("User-Agent", USER_AGENT)
          .build()
        client.newCall(request).execute().use { response ->
          if (!response.isSuccessful) return@use
          val body = response.body ?: return@use
          val length = body.contentLength()
          if (length > PREVIEW_MAX_BYTES) return@use
          val temp = File(cache, "$name.tmp")
          var total = 0L
          var tooLarge = false
          body.byteStream().use { input ->
            FileOutputStream(temp).use { output ->
              val buffer = ByteArray(64 * 1024)
              while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                total += read
                if (total > PREVIEW_MAX_BYTES) {
                  tooLarge = true
                  break
                }
                output.write(buffer, 0, read)
              }
            }
          }
          if (tooLarge || total < 1_024L) {
            temp.delete()
            return@use
          }
          target.delete()
          if (!temp.renameTo(target)) {
            temp.copyTo(target, overwrite = true)
            temp.delete()
          }
          prunePreviews(cache)
          return target
        }
      } catch (e: Exception) {
        Log.w(LOG_TAG, "preview fetch attempt ${attempt + 1} failed: ${e.message}")
      }
    }
    return null
  }

  /** Bound disk use from repeated preview caching. */
  private fun prunePreviews(dir: File) {
    try {
      val files = dir.listFiles()?.filter {
        it.name.endsWith(".audio") || it.name.endsWith(".tmp")
      } ?: return
      if (files.size <= MAX_CACHED_PREVIEWS) return
      files.sortedBy { it.lastModified() }
        .take(files.size - MAX_CACHED_PREVIEWS)
        .forEach { it.delete() }
    } catch (e: Exception) {
      Log.w(LOG_TAG, "preview cache prune failed: ${e.message}")
    }
  }

  /**
   * Decodes [file] to mono 16-bit PCM at [SincFingerprint.SAMPLE_RATE] using
   * the bundled ffmpeg. Returns null on any failure/timeout; callers treat that
   * as an unverifiable file, never as a pass.
   */
  private fun decodeSamples(ffmpeg: File, libs: File, file: File, maxSeconds: Int): ShortArray? {
    val pb = ProcessBuilder(
      ffmpeg.absolutePath,
      "-nostdin",
      "-v",
      "error",
      "-i",
      file.absolutePath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      SincFingerprint.SAMPLE_RATE.toString(),
      "-t",
      maxSeconds.toString(),
      "-f",
      "s16le",
      "-",
    )
    pb.environment().apply {
      put("LD_LIBRARY_PATH", libs.absolutePath)
      put("PATH", "${libs.parentFile?.absolutePath.orEmpty()}:/system/bin:/system/xbin")
    }
    val process = try {
      pb.start()
    } catch (e: Exception) {
      Log.w(LOG_TAG, "ffmpeg start failed: ${e.message}")
      return null
    }

    // Android's ProcessBuilder has no Redirect.DISCARD; drain stderr so a
    // verbose failure can never fill the pipe and wedge ffmpeg.
    val errorReader = Thread {
      try {
        process.errorStream.use { input ->
          val sink = ByteArray(4_096)
          while (input.read(sink) >= 0) {
            // discard
          }
        }
      } catch (_: Exception) {
        // Process died; the exit status is checked below.
      }
    }.apply {
      isDaemon = true
      start()
    }

    val output = ByteArrayOutputStream()
    val reader = Thread {
      try {
        process.inputStream.use { input -> input.copyTo(output) }
      } catch (_: Exception) {
        // Process kill/timeout closes the pipe; the main thread decides.
      }
    }.apply {
      isDaemon = true
      start()
    }

    val finished = try {
      process.waitFor(DECODE_TIMEOUT_MS, TimeUnit.MILLISECONDS)
    } catch (e: InterruptedException) {
      Thread.currentThread().interrupt()
      process.destroyForcibly()
      return null
    }
    if (!finished) {
      process.destroyForcibly()
      reader.join(2_000)
      errorReader.join(500)
      Log.w(LOG_TAG, "ffmpeg decode timed out for ${file.name}")
      return null
    }
    reader.join(5_000)
    errorReader.join(500)
    if (reader.isAlive) {
      Log.w(LOG_TAG, "ffmpeg decode reader stuck for ${file.name}")
      return null
    }
    val exit = process.exitValue()
    if (exit != 0) {
      Log.w(LOG_TAG, "ffmpeg decode failed (exit=$exit) for ${file.name}")
      return null
    }
    val bytes = output.toByteArray()
    if (bytes.size < 2) return null
    val shorts = ShortArray(bytes.size / 2)
    ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(shorts)
    return shorts
  }
}
