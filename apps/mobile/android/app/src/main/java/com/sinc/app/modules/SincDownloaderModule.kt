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
      val expectedMs = metadata?.getDouble("expectedDurationMs")?.takeIf { it > 0 }?.toLong()

      // A resume continues from an existing `.part` with an HTTP Range request;
      // a fresh start drops stale partials (their server-side source may have
      // changed, which otherwise fails with HTTP 416 forever).
      val part = File(dir, "$fileName.part")
      if (!resumePart) part.delete()
      enqueue(jobId, url, headers, target, part, publicName, metaTitle, metaArtist, metaAlbum, resumePart, promise)
    } catch (e: Exception) {
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
        releaseSelf()
        SincDownloads.end(jobId)
        clearSpeedSample(jobId)
        Log.w(LOG_TAG, "download failed jobId=$jobId: $code $message")
        promise.reject(code, message ?: "Download failed")
      }

      /** Range refused or the part is corrupt: start over exactly once. */
      private fun restartFromZero() {
        releaseSelf()
        part.delete()
        enqueue(jobId, url, headers, target, part, publicName, metaTitle, metaArtist, metaAlbum, false, promise)
      }

      override fun onFailure(call: Call, e: IOException) {
        // The `.part` survives so a resume/retry continues from the same
        // offset instead of restarting the whole transfer.
        releaseSelf()
        SincDownloads.end(jobId)
        clearSpeedSample(jobId)
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
            SincDownloads.end(jobId)
            clearSpeedSample(jobId)
            val drained = target.exists() && target.delete()
            if (!part.renameTo(target)) {
              part.copyTo(target, overwrite = true)
              part.delete()
            }
            if (drained) Log.d(LOG_TAG, "overwrote existing target for jobId=$jobId")
            // Real duration of the saved file: JS validates it against the
            // expected track length and falls back to the yt-dlp path when a
            // provider handed over a preview/compilation segment.
            val durationMs = SincAudioProbe.probeDuration(target)
            publishToPublicStorage(target, publicName, metaTitle, metaArtist, metaAlbum)
            promise.resolve(
              Arguments.createMap().apply {
                putString("localUri", "file://${target.absolutePath}")
                putDouble("sizeBytes", written.toDouble())
                putDouble("durationMs", durationMs.toDouble())
              },
            )
          } catch (e: Exception) {
            releaseSelf()
            SincDownloads.end(jobId)
            clearSpeedSample(jobId)
            promise.reject("DOWNLOAD_ERROR", e.message ?: "Download failed")
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
