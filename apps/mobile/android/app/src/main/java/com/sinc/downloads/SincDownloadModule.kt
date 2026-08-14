package com.sinc.downloads

import android.app.DownloadManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.StatFs
import androidx.core.app.NotificationCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File

/**
 * Download bridge (M3.3/M4.2). Delegates background downloads to the system
 * DownloadManager: no custom headers are needed because stream URLs are
 * query-signed by the backend. Files land in the app-scoped music dir so no
 * storage permission is required. State changes are reported to JS via the
 * DownloadReceiver broadcast and progress is polled by the JS service.
 */
class SincDownloadModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val context: ReactApplicationContext get() = reactContext
  private val prefs = reactContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  override fun getName(): String = "SincDownloads"

  // ---------------------------------------------------------------- helpers

  private fun fileFor(trackId: String): File {
    val dir = context.getExternalFilesDir(Environment.DIRECTORY_MUSIC)
        ?: context.filesDir
    return File(dir, "sinc_$trackId.mp3")
  }

  private fun downloadIdFor(trackId: String): Long =
      prefs.getLong(PREFS_KEY_PREFIX + trackId, -1L)

  private fun manager(): DownloadManager =
      context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager

  private fun emit(trackId: String, payload: WritableMap) {
    payload.putString("trackId", trackId)
    context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(EVENT_NAME, payload)
  }

  private fun statusPayload(trackId: String): WritableMap? {
    val downloadId = downloadIdFor(trackId)
    if (downloadId < 0) return null
    val cursor = manager().query(
        DownloadManager.Query().setFilterById(downloadId),
    )
    try {
      if (!cursor.moveToFirst()) return null
      val bytesDownloaded = cursor.getLong(
          cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
      val bytesTotal = cursor.getLong(
          cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
      val status = cursor.getInt(
          cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
      val payload = Arguments.createMap()
      payload.putDouble("bytesDownloaded", bytesDownloaded.toDouble())
      payload.putDouble("bytesTotal", bytesTotal.toDouble())
      when (status) {
        DownloadManager.STATUS_SUCCESSFUL -> {
          payload.putString("state", "completed")
          payload.putString("localUri", fileFor(trackId).absolutePath)
        }
        DownloadManager.STATUS_FAILED -> {
          val reason = cursor.getInt(
              cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))
          payload.putString("state", "failed")
          payload.putString("errorCode", "DM_$reason")
        }
        else -> payload.putString("state", "downloading")
      }
      return payload
    } finally {
      cursor.close()
    }
  }

  // ---------------------------------------------------------------- methods

  /** Enqueues a signed stream URL with the system DownloadManager. */
  @ReactMethod
  fun enqueueDownload(trackId: String, url: String, title: String, promise: Promise) {
    try {
      val existing = downloadIdFor(trackId)
      if (existing >= 0) {
        manager().remove(existing)
      }
      val request = DownloadManager.Request(Uri.parse(url))
          .setTitle(title)
          .setDescription(title)
          .setDestinationUri(Uri.fromFile(fileFor(trackId)))
          .setNotificationVisibility(DownloadManager.Request.VISIBILITY_HIDDEN)
          .setAllowedOverMetered(true)
          .setAllowedOverRoaming(true)
      val downloadId = manager().enqueue(request)
      prefs.edit().putLong(PREFS_KEY_PREFIX + trackId, downloadId).apply()
      promise.resolve(downloadId)
    } catch (e: Exception) {
      promise.reject("ENQUEUE_FAILED", e.message ?: "Download enqueue failed", e)
    }
  }

  /** Cancels a download; the partial file is removed. */
  @ReactMethod
  fun cancelDownload(trackId: String, promise: Promise) {
    try {
      val downloadId = downloadIdFor(trackId)
      if (downloadId >= 0) manager().remove(downloadId)
      prefs.edit().remove(PREFS_KEY_PREFIX + trackId).apply()
      fileFor(trackId).delete()
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("CANCEL_FAILED", e.message ?: "Download cancel failed", e)
    }
  }

  /**
   * Current system state for a track:
   * { state: 'unknown'|'downloading'|'completed'|'failed', ... }.
   */
  @ReactMethod
  fun queryProgress(trackId: String, promise: Promise) {
    try {
      val payload = statusPayload(trackId)
      if (payload == null) {
        val missing = Arguments.createMap()
        missing.putString("state", "unknown")
        promise.resolve(missing)
        return
      }
      promise.resolve(payload)
    } catch (e: Exception) {
      promise.reject("QUERY_FAILED", e.message ?: "Download query failed", e)
    }
  }

  /** Local file path of a completed download, or null. */
  @ReactMethod
  fun getLocalUri(trackId: String, promise: Promise) {
    try {
      val file = fileFor(trackId)
      if (file.exists() && file.length() > 0) {
        promise.resolve(file.absolutePath)
      } else {
        promise.resolve(null)
      }
    } catch (e: Exception) {
      promise.reject("LOCAL_URI_FAILED", e.message ?: "Local uri lookup failed", e)
    }
  }

  @ReactMethod
  fun deleteFile(trackId: String, promise: Promise) {
    try {
      prefs.edit().remove(PREFS_KEY_PREFIX + trackId).apply()
      promise.resolve(fileFor(trackId).delete())
    } catch (e: Exception) {
      promise.reject("DELETE_FAILED", e.message ?: "File delete failed", e)
    }
  }

  /** Free bytes on the storage hosting the downloads dir. */
  @ReactMethod
  fun getFreeBytes(promise: Promise) {
    try {
      val path = context.getExternalFilesDir(null)?.absolutePath
          ?: context.filesDir.absolutePath
      promise.resolve(StatFs(path).availableBytes.toDouble())
    } catch (e: Exception) {
      promise.reject("STORAGE_FAILED", e.message ?: "Storage query failed", e)
    }
  }

  /** Aggregate completion notification for a finished batch. */
  @ReactMethod
  fun notifyBatchComplete(count: Int) {
    try {
      val notificationManager =
          context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        notificationManager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "Downloads",
                NotificationManager.IMPORTANCE_DEFAULT,
            ),
        )
      }
      val launchIntent =
          context.packageManager.getLaunchIntentForPackage(context.packageName)!!.addFlags(
              Intent.FLAG_ACTIVITY_SINGLE_TOP,
          )
      val openApp =
          PendingIntent.getActivity(context, 0, launchIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      val notification = NotificationCompat.Builder(context, CHANNEL_ID)
          .setSmallIcon(android.R.drawable.stat_sys_download_done)
          .setContentTitle("Downloads finished")
          .setContentText("$count track${if (count == 1) "" else "s"} downloaded")
          .setContentIntent(openApp)
          .setAutoCancel(true)
          .build()
      notificationManager.notify(NOTIFICATION_ID, notification)
    } catch (ignored: Exception) {
      // Notification is best-effort; downloads already succeeded.
    }
  }

  /** Forced state refresh after the system broadcast (DownloadReceiver). */
  fun onDownloadBroadcast(downloadId: Long) {
    val trackId = prefs.all.entries
        .firstOrNull { it.value == downloadId }
        ?.key
        ?.removePrefix(PREFS_KEY_PREFIX)
        ?: return
    val payload = statusPayload(trackId) ?: return
    emit(trackId, payload)
  }

  companion object {
    const val EVENT_NAME = "SincDownloadEvent"
    private const val PREFS_NAME = "sinc_downloads"
    private const val PREFS_KEY_PREFIX = "download_id_"
    private const val CHANNEL_ID = "sinc_downloads"
    private const val NOTIFICATION_ID = 4242
  }
}
