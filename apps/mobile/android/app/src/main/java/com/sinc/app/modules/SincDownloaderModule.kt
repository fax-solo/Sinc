package com.sinc.app.modules

import android.content.ContentValues
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.MediaStore
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
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
    val resolver = reactApplicationContext.contentResolver
    try {
      val values = ContentValues().apply {
        put(MediaStore.MediaColumns.DISPLAY_NAME, displayName)
        put(MediaStore.MediaColumns.MIME_TYPE, "audio/mpeg")
        put(MediaStore.MediaColumns.SIZE, source.length())
        if (!title.isNullOrBlank()) put(MediaStore.Audio.Media.TITLE, title)
        if (!artist.isNullOrBlank()) put(MediaStore.Audio.Media.ARTIST, artist)
        if (!album.isNullOrBlank()) put(MediaStore.Audio.Media.ALBUM, album)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          put(MediaStore.MediaColumns.RELATIVE_PATH, publicDirectory)
          put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
      }
      val uri = resolver.insert(publicCollection(), values) ?: return
      try {
        resolver.openOutputStream(uri)?.use { out ->
          source.inputStream().use { it.copyTo(out) }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          val done = ContentValues().apply {
            put(MediaStore.MediaColumns.IS_PENDING, 0)
          }
          resolver.update(uri, done, null, null)
        }
      } catch (e: IOException) {
        resolver.delete(uri, null, null)
      }
    } catch (e: Exception) {
      // Ignore: public copy is a convenience, not a requirement.
    }
  }

  /** Deletes the public MediaStore copy for a file name, if one exists. */
  private fun removeFromPublicStorage(fileName: String) {
    val resolver = reactApplicationContext.contentResolver
    for (relativePath in arrayOf(publicDirectory, legacyDirectory)) {
      try {
        val args = mutableListOf(fileName)
        val selection = StringBuilder("${MediaStore.MediaColumns.DISPLAY_NAME}=?")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          selection.append(" AND ${MediaStore.MediaColumns.RELATIVE_PATH}=?")
          args.add(relativePath)
        }
        resolver.delete(publicCollection(), selection.toString(), args.toTypedArray())
      } catch (e: Exception) {
        // Ignore cleanup errors.
      }
    }
  }

  @ReactMethod
  fun download(
    jobId: String,
    url: String,
    headers: ReadableMap?,
    destinationFileName: String?,
    metadata: ReadableMap?,
    promise: Promise,
  ) {
    val dir = File(reactApplicationContext.filesDir, "sinc_downloads").apply { mkdirs() }
    val fileName = destinationFileName?.takeIf { it.isNotBlank() } ?: "$jobId.mp3"
    val target = File(dir, fileName)
    val metaTitle = metadata?.getString("title")
    val metaArtist = metadata?.getString("artist")
    val metaAlbum = metadata?.getString("album")
    // The published copy in Music/ shows just the song name; the app-private
    // file keeps its collision-safe name.
    val publicName = metadata?.getString("publicFileName")?.takeIf { it.isNotBlank() } ?: fileName

    val builder = Request.Builder().url(url)
    if (headers != null) {
      val keys = headers.keySetIterator()
      while (keys.hasNextKey()) {
        val key = keys.nextKey()
        headers.getString(key)?.let { builder.header(key, it) }
      }
    }

    val call = client.newCall(builder.build())
    active[jobId] = call

    call.enqueue(object : Callback {
      override fun onFailure(call: Call, e: IOException) {
        active.remove(jobId)
        promise.reject("DOWNLOAD_ERROR", e.message ?: "Download failed")
      }

      override fun onResponse(call: Call, response: Response) {
        if (!response.isSuccessful) {
          response.close()
          active.remove(jobId)
          promise.reject("HTTP_${response.code}", response.message)
          return
        }
        val total = response.body?.contentLength() ?: -1L
        var written = 0L
        try {
          response.body!!.byteStream().use { input ->
            target.outputStream().use { output ->
              val buf = ByteArray(8 * 1024)
              while (true) {
                val n = input.read(buf)
                if (n == -1) break
                output.write(buf, 0, n)
                written += n
                emitProgress(jobId, written, total)
              }
            }
          }
          active.remove(jobId)
          publishToPublicStorage(target, publicName, metaTitle, metaArtist, metaAlbum)
          promise.resolve(
            Arguments.createMap().apply {
              putString("localUri", "file://${target.absolutePath}")
              putDouble("sizeBytes", written.toDouble())
            },
          )
        } catch (e: Exception) {
          active.remove(jobId)
          promise.reject("DOWNLOAD_ERROR", e.message ?: "Download failed")
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
  fun remove(jobId: String, fileName: String?, promise: Promise) {
    active.remove(jobId)?.cancel()
    val dir = File(reactApplicationContext.filesDir, "sinc_downloads")
    if (!fileName.isNullOrBlank()) {
      File(dir, fileName).delete()
      removeFromPublicStorage(fileName)
    } else {
      dir.listFiles()?.filter { it.name.startsWith("$jobId.") }?.forEach { it.delete() }
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

  private fun emitProgress(jobId: String, bytesDownloaded: Long, bytesTotal: Long) {
    val now = SystemClock.elapsedRealtime()
    val prev = lastEmitAt[jobId] ?: 0L
    if (now - prev < 150) return
    lastEmitAt[jobId] = now
    mainHandler.post {
      reactApplicationContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(
          "SincDownloadProgress",
          Arguments.createMap().apply {
            putString("jobId", jobId)
            putDouble("bytesDownloaded", bytesDownloaded.toDouble())
            putDouble("bytesTotal", if (bytesTotal > 0) bytesTotal.toDouble() else 0.0)
          },
        )
    }
  }
}
