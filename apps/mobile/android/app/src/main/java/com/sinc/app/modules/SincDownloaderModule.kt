package com.sinc.app.modules

import android.content.ContentValues
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.MediaStore
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response

class SincDownloaderModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "SincDownloader"

  private companion object {
    const val LOG_TAG = "SincDownloader"
  }

  init {
    SincDownloads.attach(reactContext)
  }

  private val client = OkHttpClient.Builder().build()
  private val active = ConcurrentHashMap<String, Call>()
  private val mainHandler = Handler(Looper.getMainLooper())
  private val lastEmitAt = ConcurrentHashMap<String, Long>()

  /** Published copies live in Music/Sinc so they appear in music players. */
  private val publicDirectory = "${Environment.DIRECTORY_MUSIC}/Sinc"
  /** Pre-Q devices used the old Downloads location; kept for cleanup. */
  private val legacyDirectory = "${Environment.DIRECTORY_DOWNLOADS}/Sinc"

  private fun publicCollection(): Uri =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      // The audio collection makes MediaScanner index the file as music.
      MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
    } else {
      MediaStore.Files.getContentUri("external")
    }

  /**
   * Publishes a finished MP3 into the phone's public Music/Sinc folder via
   * MediaStore, tagged with track metadata so it shows up complete in music
   * apps. Best-effort: playback always uses the app-private copy, so a
   * failure here never fails the download.
   */
  private fun publishToPublicStorage(
    source: File,
    displayName: String,
    title: String?,
    artist: String?,
    album: String?,
  ) {
    SincDownloads.publishAudioFile(
      reactApplicationContext,
      reactApplicationContext.contentResolver,
      source,
      displayName,
      title,
      artist,
      album,
    )
  }

  /** Deletes the public MediaStore copy for a file name, if one exists. */
  private fun removeFromPublicStorage(fileName: String) {
    SincDownloads.removePublished(fileName)
  }

  /**
   * A paused or cancelled job must not publish audio after the transfer. The
   * job intentionally stays registered through duration probing and
   * fingerprint verification so these actions can stop it.
   */
  private fun isStopped(jobId: String): Boolean =
    SincDownloads.isPaused(jobId) || !SincDownloads.isActive(jobId)

  @ReactMethod
  fun download(
    jobId: String,
    url: String,
    headers: ReadableMap?,
    destinationFileName: String?,
    metadata: ReadableMap?,
    resumePart: Boolean,
    promise: Promise,
  ) {
    // Bridge argument shapes are not compiled away: a null/absent string field
    // or a corrupt ReadableMap must REJECT the promise, never crash this
    // native thread (an uncaught throw here takes the whole app down).
    try {
      val dir = File(reactApplicationContext.filesDir, "sinc_downloads").apply { mkdirs() }
      val fileName = destinationFileName?.takeIf { it.isNotBlank() } ?: "$jobId.mp3"
      val target = File(dir, fileName)
      val metaTitle = metadata?.getString("title")
      val metaArtist = metadata?.getString("artist")
      val metaAlbum = metadata?.getString("album")
      // The published copy in Music/ shows just the song name; the app-private
      // file keeps its collision-safe name.
      val publicName = metadata?.getString("publicFileName")?.takeIf { it.isNotBlank() } ?: fileName
      // Optional: getDouble throws on a missing/null key, and most short-track
      // sources omit an expected length. Read the type first, then default null.
      val expectedMs = metadata
        ?.takeIf {
          it.hasKey("expectedDurationMs") &&
            it.getType("expectedDurationMs") == ReadableType.Number
        }
        ?.getDouble("expectedDurationMs")
        ?.takeIf { it > 0 }
        ?.toLong()
      // Trusted catalog preview for content-level verification. Optional so
      // legacy/offline callers still get the metadata + duration gates.
      val previewUrl = metadata
        ?.getString("previewUrl")
        ?.trim()
        ?.takeIf { it.isNotEmpty() }

      // A resume continues from an existing `.part` with an HTTP Range request;
      // a fresh start drops stale partials (their server-side source may have
      // changed, which otherwise fails with HTTP 416 forever).
      val part = File(dir, "$fileName.part")
      if (!resumePart) part.delete()
      enqueue(
        jobId,
        url,
        headers,
        target,
        part,
        publicName,
        metaTitle,
        metaArtist,
        metaAlbum,
        expectedMs,
        previewUrl,
        resumePart,
        promise,
      )
    } catch (e: Exception) {
      SincDownloads.end(jobId)
      Log.w("SincDownloader", "download config rejected for $jobId: ${e.message}")
      promise.reject("DOWNLOAD_BAD_CONFIG", e.message ?: "Malformed download request", e)
    }
  }

  /**
   * One transfer attempt. Writes to `part`; on success renames it to `target`
   * (the atomic hand-off — a .part is never playable/publishable), probes the
   * duration and publishes. A Range-rejected (416) attempt restarts once from
   * byte 0 with the same promise; a range-ignored (200) attempt truncates.
   */
  private fun enqueue(
    jobId: String,
    url: String,
    headers: ReadableMap?,
    target: File,
    part: File,
    publicName: String,
    metaTitle: String?,
    metaArtist: String?,
    metaAlbum: String?,
    expectedMs: Long?,
    previewUrl: String?,
    allowResume: Boolean,
    promise: Promise,
  ) {
    val canResume = allowResume && part.isFile && part.length() > 0L
    val builder = Request.Builder().url(url)
    if (canResume) builder.header("Range", "bytes=${part.length()}-")
    if (headers != null) {
      val keys = headers.keySetIterator()
      while (keys.hasNextKey()) {
        val key = keys.nextKey()
        headers.getString(key)?.let { builder.header(key, it) }
      }
    }

    val call = client.newCall(builder.build())
    // Never orphan a previous call for the same job (re-entrant retry would
    // otherwise leave two transfers writing one file).
    active.remove(jobId)?.cancel()
    active[jobId] = call
    SincDownloads.begin(jobId, metaTitle ?: target.nameWithoutExtension, call::cancel)

    call.enqueue(object : Callback {
      /** Only this call may deregister itself — a superseding retry reuses the jobId. */
      private fun releaseSelf() {
        if (active[jobId] === call) active.remove(jobId)
      }

      private fun fail(code: String, message: String?) {
        val stopped = isStopped(jobId)
        releaseSelf()
        SincDownloads.end(jobId)
        clearSpeedSample(jobId)
        if (stopped) {
          Log.i(LOG_TAG, "download cancelled jobId=$jobId")
          promise.reject("DOWNLOAD_CANCELLED", "Download cancelled")
          return
        }
        Log.w(LOG_TAG, "download failed jobId=$jobId: $code $message")
        promise.reject(code, message ?: "Download failed")
      }

      /** Range refused or the part is corrupt: start over exactly once. */
      private fun restartFromZero() {
        if (isStopped(jobId)) {
          releaseSelf()
          SincDownloads.end(jobId)
          clearSpeedSample(jobId)
          promise.reject("DOWNLOAD_CANCELLED", "Download cancelled")
          return
        }
        releaseSelf()
        part.delete()
        enqueue(
          jobId,
          url,
          headers,
          target,
          part,
          publicName,
          metaTitle,
          metaArtist,
          metaAlbum,
          expectedMs,
          previewUrl,
          false,
          promise,
        )
      }

      override fun onFailure(call: Call, e: IOException) {
        // The `.part` survives so a resume/retry continues from the same
        // offset instead of restarting the whole transfer.
        val stopped = isStopped(jobId)
        releaseSelf()
        SincDownloads.end(jobId)
        clearSpeedSample(jobId)
        if (stopped) {
          Log.i(LOG_TAG, "download cancelled jobId=$jobId: ${e.message}")
          promise.reject("DOWNLOAD_CANCELLED", "Download cancelled")
          return
        }
        Log.w(LOG_TAG, "download failed jobId=$jobId: ${e.message}")
        promise.reject("DOWNLOAD_ERROR", e.message ?: "Download failed")
      }

      override fun onResponse(call: Call, response: Response) {
        response.use { resp ->
          if (!resp.isSuccessful) {
            if (resp.code == 416 && canResume) {
              restartFromZero()
              return
            }
            fail("HTTP_${resp.code}", resp.message)
            return
          }
          val contentLen = resp.body?.contentLength() ?: -1L
          // 206 = server honored the range (append); 200 = it ignored it
          // (truncate and download the full body into the same part file).
          val appended = canResume && resp.code == 206
          val rangeTotal = resp.header("Content-Range")
            ?.substringAfterLast('/')?.toLongOrNull()?.takeIf { it > 0 }
          val total = when {
            rangeTotal != null && rangeTotal > 0 -> rangeTotal
            appended && contentLen > 0 -> part.length() + contentLen
            contentLen > 0 -> contentLen
            else -> -1L
          }
          if (total <= 0L) SincDownloads.updateUnknown(jobId)
          var written = if (appended) part.length() else 0L
          try {
            resp.body!!.byteStream().use { input ->
              FileOutputStream(part, appended).use { output ->
                val buf = ByteArray(64 * 1024)
                while (true) {
                  val n = input.read(buf)
                  if (n == -1) break
                  output.write(buf, 0, n)
                  written += n
                  emitProgress(jobId, written, total)
                }
              }
            }
            // A silent truncation (proxy drop, server bug) must never be
            // renamed into place as a "complete" file.
            if (total > 0 && written != total) {
              throw IOException("Truncated download ($written of $total bytes)")
            }
            releaseSelf()
            clearSpeedSample(jobId)
            val drained = target.exists() && target.delete()
            if (!part.renameTo(target)) {
              part.copyTo(target, overwrite = true)
              part.delete()
            }
            if (drained) Log.d(LOG_TAG, "overwrote existing target for jobId=$jobId")
            // The transfer is done, but the user can still pause/cancel while
            // the probe and fingerprint verification run. Never publish a file
            // for a job the user has already stopped.
            if (isStopped(jobId)) {
              target.delete()
              SincDownloads.end(jobId)
              promise.reject("DOWNLOAD_CANCELLED", "Download cancelled")
              return
            }
            // Real duration of the saved file. Reject a preview/compilation
            // segment BEFORE it is published to Music/Sinc or recorded as a
            // completed download. An unreadable probe is not allowed to pass
            // when the catalog length is known — the engine tier can still
            // fetch a verifiable copy. JS keeps a backstop for callers that
            // bypass this module.
            val durationMs = SincAudioProbe.probeDuration(target)
            if (
              expectedMs != null &&
              expectedMs > 0L &&
              !SincDownloadRules.isDurationAcceptable(durationMs, expectedMs)
            ) {
              target.delete()
              SincDownloads.end(jobId)
              Log.w(
                LOG_TAG,
                "download rejected: duration ${durationMs}ms != expected ${expectedMs}ms " +
                  "for jobId=$jobId"
              )
              promise.reject(
                "DOWNLOAD_UNVERIFIED",
                "Downloaded file does not match the requested track length"
              )
              return
            }
            // Length + metadata can still describe the wrong audio (covers,
            // tributes, same-length edits). Match the finished bytes against the
            // trusted catalog preview before publishing. No preview means there
            // is no reference to compare against; every other failure is closed.
            if (!previewUrl.isNullOrBlank()) {
              val fingerprint = SincAudioFingerprint.verify(target, previewUrl)
              when (fingerprint.status) {
                SincAudioFingerprint.Status.MATCH ->
                  Log.i(
                    LOG_TAG,
                    "fingerprint accepted jobId=$jobId score=${fingerprint.matches}/" +
                      "${fingerprint.referenceHashes}"
                  )
                SincAudioFingerprint.Status.MISMATCH -> {
                  target.delete()
                  SincDownloads.end(jobId)
                  Log.w(
                    LOG_TAG,
                    "download rejected: fingerprint ${fingerprint.matches}/" +
                      "${fingerprint.referenceHashes} for jobId=$jobId"
                  )
                  promise.reject(
                    "DOWNLOAD_FINGERPRINT_MISMATCH",
                    "Downloaded audio does not match the selected recording"
                  )
                  return
                }
                SincAudioFingerprint.Status.UNAVAILABLE -> {
                  target.delete()
                  SincDownloads.end(jobId)
                  Log.w(
                    LOG_TAG,
                    "download rejected: fingerprint unavailable (${fingerprint.reason}) " +
                      "for jobId=$jobId"
                  )
                  promise.reject(
                    "DOWNLOAD_FINGERPRINT_UNAVAILABLE",
                    "Could not verify the downloaded audio against the catalog preview"
                  )
                  return
                }
                SincAudioFingerprint.Status.NO_REFERENCE ->
                  Log.w(
                    LOG_TAG,
                    "fingerprint skipped jobId=$jobId reason=${fingerprint.reason}"
                  )
              }
            }
            // The verification can take seconds; a pause/cancel during it must
            // still win over publishing.
            if (isStopped(jobId)) {
              target.delete()
              SincDownloads.end(jobId)
              promise.reject("DOWNLOAD_CANCELLED", "Download cancelled")
              return
            }
            publishToPublicStorage(target, publicName, metaTitle, metaArtist, metaAlbum)
            SincDownloads.end(jobId)
            promise.resolve(
              Arguments.createMap().apply {
                putString("localUri", "file://${target.absolutePath}")
                putDouble("sizeBytes", written.toDouble())
                putDouble("durationMs", durationMs.toDouble())
              },
            )
          } catch (e: Exception) {
            val stopped = isStopped(jobId)
            releaseSelf()
            SincDownloads.end(jobId)
            clearSpeedSample(jobId)
            if (stopped) {
              Log.i(LOG_TAG, "download cancelled jobId=$jobId: ${e.message}")
              promise.reject("DOWNLOAD_CANCELLED", "Download cancelled")
            } else {
              promise.reject("DOWNLOAD_ERROR", e.message ?: "Download failed")
            }
          }
        }
      }
    })
  }

  @ReactMethod
  fun cancel(jobId: String, promise: Promise) {
    active.remove(jobId)?.cancel()
    promise.resolve(null)
  }

  @ReactMethod
  fun remove(jobId: String, fileName: String?, publicFileName: String?, promise: Promise) {
    active.remove(jobId)?.cancel()
    val dir = File(reactApplicationContext.filesDir, "sinc_downloads")
    if (!fileName.isNullOrBlank()) {
      // Confine to the downloads dir — fileName arrives from JS/localUri.
      val target = File(dir, fileName)
      try {
        if (target.canonicalPath.startsWith(dir.canonicalPath + File.separator)) {
          target.delete()
          // The partial from an interrupted transfer must go too, or the next
          // resume for this track would append a removed song's bytes.
          File(dir, "$fileName.part").delete()
          removeFromPublicStorage(fileName)
          // The public copy may have been published under the song title.
          if (!publicFileName.isNullOrBlank() && publicFileName != fileName) {
            removeFromPublicStorage(publicFileName)
          }
        }
      } catch (_: Exception) {
      }
    } else {
      dir.listFiles()
        ?.filter { it.name.startsWith("$jobId.") }
        ?.forEach { it.delete() }
    }
    promise.resolve(null)
  }

  @ReactMethod
  fun addListener(eventName: String) {}

  @ReactMethod
  fun removeListeners(count: Int) {}

  @ReactMethod
  fun getLocalUri(jobId: String, promise: Promise) {
    val dir = File(reactApplicationContext.filesDir, "sinc_downloads")
    val file = dir.listFiles()?.firstOrNull { it.name.startsWith("$jobId.") && it.length() > 0 }
    promise.resolve(file?.let { "file://${it.absolutePath}" })
  }

  /** Last (timestamp, bytes) per job, so emits can carry a live speed. */
  private val lastSpeedSample = ConcurrentHashMap<String, Pair<Long, Long>>()

  fun clearSpeedSample(jobId: String) {
    lastEmitAt.remove(jobId)
    lastSpeedSample.remove(jobId)
  }

  private fun emitProgress(jobId: String, bytesDownloaded: Long, bytesTotal: Long) {
    val now = SystemClock.elapsedRealtime()
    val prev = lastEmitAt[jobId] ?: 0L
    if (now - prev < 150) return
    lastEmitAt[jobId] = now
    // Instantaneous speed from the previous emit sample (first emit: unknown).
    val prevSample = lastSpeedSample[jobId]
    lastSpeedSample[jobId] = now to bytesDownloaded
    val speedBytesPerSec = if (prevSample != null && now > prevSample.first) {
      val dtSec = (now - prevSample.first) / 1000.0
      if (dtSec > 0) (bytesDownloaded - prevSample.second) / dtSec else 0.0
    } else {
      0.0
    }
    if (bytesTotal > 0) {
      SincDownloads.update(jobId, (bytesDownloaded.toDouble() / bytesTotal * 100).toInt())
    } else {
      // No Content-Length and no Content-Range total. Reporting 99% (the old
      // `total = 1` JS fallback) is a lie; keep the notification/UI
      // indeterminate until the transfer actually completes.
      SincDownloads.updateUnknown(jobId)
    }
    mainHandler.post {
      try {
        reactApplicationContext
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          ?.emit(
            "SincDownloadProgress",
            Arguments.createMap().apply {
              putString("jobId", jobId)
              putDouble("bytesDownloaded", bytesDownloaded.toDouble())
              putDouble("bytesTotal", if (bytesTotal > 0) bytesTotal.toDouble() else 0.0)
              putBoolean("indeterminate", bytesTotal <= 0L)
              putDouble("speedBytesPerSec", speedBytesPerSec.coerceAtLeast(0.0))
            },
          )
      } catch (_: RuntimeException) {
        // Catalyst torn down mid-download: progress events after death are
        // meaningless, so swallow instead of crashing the handler thread.
      }
    }
  }
}
