package com.sinc.app.modules

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ContentResolver
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.sinc.app.R
import java.io.File
import java.io.IOException
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Shared registry + ongoing notification for active downloads (both the native
 * HTTP downloader and the on-device yt-dlp engine). Owns each job's process /
 * call handle so "pause" and "cancel" work from the notification or in-app:
 *
 *  - cancel always kills the transfer and drops any partial file.
 *  - pause (yt-dlp engine only) kills the process but keeps the `.part`; JS
 *    resumes the same bytes when the user hits Resume.
 *
 * While any download is in flight [SincDownloadService] runs as a foreground
 * service so the OS doesn't freeze or murder the transfer when the app hides.
 */
object SincDownloads {
  const val LOG_TAG = "SincDownloads"
  const val CHANNEL_ID = "sinc_downloads"
  const val NOTIF_ID = 94000

  private data class Job(
    val title: String,
    val kill: () -> Unit,
    val cleanup: () -> Unit,
  )

  /** Transferring jobs. */
  private val active = ConcurrentHashMap<String, Job>()
  /** Paused (yt-dlp) jobs kept around so resume finds them. */
  private val paused = ConcurrentHashMap<String, Job>()
  private val progress = ConcurrentHashMap<String, Int>()
  /** Post-transfer stage ("processing", "tagging", "validating"). */
  private val stages = ConcurrentHashMap<String, String>()
  /** Jobs whose total byte count is unknown; never render these as a percent. */
  private val indeterminate = Collections.newSetFromMap(ConcurrentHashMap<String, Boolean>())
  private val serviceStarted = AtomicBoolean(false)

  @Volatile
  private var react: ReactApplicationContext? = null

  /** Sets the RN context used for JS progress/action events. */
  fun attach(ctx: ReactApplicationContext) {
    react = ctx
  }

  fun begin(
    jobId: String,
    title: String,
    kill: () -> Unit,
    cleanup: () -> Unit = {},
  ) {
    // A re-entrant start for the same job must stop the old transfer before it
    // replaces the handle; otherwise the old process can keep writing/publish
    // after the new attempt has taken over the job id.
    active.put(jobId, Job(title, kill, cleanup))?.let { previous ->
      try {
        previous.kill()
      } catch (_: Exception) {
      }
    }
    // A resume replaces the paused handle with the new attempt; leaving the
    // old entry behind made a later cancel hit only one of the two maps.
    paused.remove(jobId)
    progress[jobId] = 0
    stages.remove(jobId)
    indeterminate.remove(jobId)
    ensureServiceRunning()
    refresh()
  }

  fun update(jobId: String, percent: Int) {
    if (!active.containsKey(jobId)) return
    indeterminate.remove(jobId)
    progress[jobId] = percent.coerceIn(0, 99)
    refresh()
  }

  /** The transfer is running but the server did not provide a total size. */
  fun updateUnknown(jobId: String) {
    if (!active.containsKey(jobId)) return
    indeterminate.add(jobId)
    refresh()
  }

  fun attachKill(jobId: String, kill: () -> Unit) {
    val job = active[jobId] ?: paused[jobId] ?: return
    if (active.containsKey(jobId)) active[jobId] = job.copy(kill = kill)
    if (paused.containsKey(jobId)) paused[jobId] = job.copy(kill = kill)
  }

  /** Attaches a best-effort cleanup for files created after the job began. */
  fun attachCleanup(jobId: String, cleanup: () -> Unit) {
    val job = active[jobId] ?: paused[jobId] ?: return
    if (active.containsKey(jobId)) active[jobId] = job.copy(cleanup = cleanup)
    if (paused.containsKey(jobId)) paused[jobId] = job.copy(cleanup = cleanup)
  }

  fun pause(jobId: String) {
    val job = active.remove(jobId) ?: return
    paused[jobId] = job
    job.kill()
    postAction(jobId, "paused")
    refresh()
  }

  fun cancel(jobId: String) {
    val job = active.remove(jobId) ?: paused.remove(jobId) ?: return
    progress.remove(jobId)
    stages.remove(jobId)
    indeterminate.remove(jobId)
    job.kill()
    // Cancel means "remove the partial too". Pause deliberately does not run
    // this: its `.part` is what the resume request continues from.
    try {
      job.cleanup()
    } catch (_: Exception) {
    }
    postAction(jobId, "cancelled")
    refresh()
  }

  /**
   * Stops a job and deletes its artifacts without emitting a user action.
   * Used for internal fallbacks (e.g. a rejected direct match) where the JS
   * orchestration must continue to the next tier instead of treating the job
   * as user-cancelled.
   */
  fun discard(jobId: String) {
    val job = active.remove(jobId) ?: paused.remove(jobId) ?: return
    progress.remove(jobId)
    stages.remove(jobId)
    indeterminate.remove(jobId)
    try {
      job.kill()
    } catch (_: Exception) {
    }
    try {
      job.cleanup()
    } catch (_: Exception) {
    }
    refresh()
  }

  fun resume(jobId: String) {
    val job = paused.remove(jobId) ?: return
    progress[jobId] = progress[jobId] ?: 0
    stages.remove(jobId)
    active[jobId] = job.copy(kill = {})
    postAction(jobId, "resume")
    refresh()
  }

  /** Called when a transfer genuinely completes (success or hard failure). */
  fun end(jobId: String) {
    active.remove(jobId)
    paused.remove(jobId)
    progress.remove(jobId)
    stages.remove(jobId)
    indeterminate.remove(jobId)
    refresh()
  }

  /**
   * Publishes a finished audio file into the phone's public Music/Sinc folder
   * via MediaStore, tagged with track metadata so it shows up complete
   * (title, artist, album, artwork when embedded) in other music players.
   * Best-effort: playback always uses the app-private copy, so a failure here
   * never fails the download — but every failure is LOGGED now: a silently
   * missing public copy is how "the other players lost my songs" happened.
   */
  fun publishAudioFile(
    context: Context,
    resolver: ContentResolver,
    source: File,
    displayName: String,
    title: String?,
    artist: String?,
    album: String?,
    mimeType: String? = null,
  ) {
    val mime = mimeType?.takeIf { it.isNotBlank() } ?: mimeForFileName(displayName)
    try {
      if (!source.isFile || source.length() == 0L) {
        Log.w(LOG_TAG, "publish refused: source missing or empty: ${source.path}")
        return
      }
      val collection: Uri =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        } else {
          MediaStore.Files.getContentUri("external")
        }
      val values = ContentValues().apply {
        put(MediaStore.MediaColumns.DISPLAY_NAME, displayName)
        put(MediaStore.MediaColumns.MIME_TYPE, mime)
        put(MediaStore.MediaColumns.SIZE, source.length())
        if (!title.isNullOrBlank()) put(MediaStore.Audio.Media.TITLE, title)
        if (!artist.isNullOrBlank()) put(MediaStore.Audio.Media.ARTIST, artist)
        if (!album.isNullOrBlank()) put(MediaStore.Audio.Media.ALBUM, album)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          put(MediaStore.MediaColumns.RELATIVE_PATH, "${Environment.DIRECTORY_MUSIC}/Sinc")
          put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
      }
      val uri = resolver.insert(collection, values)
      if (uri == null) {
        Log.w(LOG_TAG, "publish: MediaStore insert returned null for '$displayName' (mime=$mime)")
        return
      }
      try {
        resolver.openOutputStream(uri)?.use { out ->
          source.inputStream().use { it.copyTo(out) }
        } ?: Log.w(LOG_TAG, "publish: output stream null for '$displayName'")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          resolver.update(
            uri,
            ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) },
            null,
            null,
          )
        }
        val storedPath = resolver.query(
          uri,
          arrayOf(MediaStore.MediaColumns.DATA),
          null,
          null,
          null,
        )?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
        if (!storedPath.isNullOrBlank()) {
          // Belt and braces: some players grep the media-scanner broadcast
          // rather than watching MediaStore; the insert already indexed the
          // row, this just guarantees the scan notification as well.
          MediaScannerConnection.scanFile(context, arrayOf(storedPath), arrayOf(mime), null)
        }
        Log.d(LOG_TAG, "published '$displayName' ($mime, ${source.length()}B) -> $storedPath")
      } catch (e: IOException) {
        Log.w(LOG_TAG, "publish copy failed for '$displayName': ${e.message}")
        resolver.delete(uri, null, null)
      }
    } catch (e: Exception) {
      Log.w(LOG_TAG, "publish failed for '$displayName': ${e.message}")
    }
  }

  private fun mimeForFileName(name: String): String =
    SincAudioContainer.mimeForExtension(File(name).extension)

  /**
   * Deletes a previously published Music/Sinc (or legacy Downloads/Sinc)
   * MediaStore copy by display name. Shared by both downloader modules so a
   * removed download cannot leave a ghost entry behind for other players.
   */
  fun removePublished(displayName: String?) {
    val ctx = react ?: return
    if (displayName.isNullOrBlank()) return
    val resolver = ctx.contentResolver
    val collection: Uri =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
      } else {
        MediaStore.Files.getContentUri("external")
      }
    for (relativePath in arrayOf(
      "${Environment.DIRECTORY_MUSIC}/Sinc",
      "${Environment.DIRECTORY_DOWNLOADS}/Sinc",
    )) {
      try {
        val args = mutableListOf(displayName)
        val selection = StringBuilder("${MediaStore.MediaColumns.DISPLAY_NAME}=?")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          selection.append(" AND ${MediaStore.MediaColumns.RELATIVE_PATH}=?")
          args.add(relativePath)
        }
        resolver.delete(collection, selection.toString(), args.toTypedArray())
      } catch (_: Exception) {
        // Cleanup is best-effort.
      }
    }
  }

  fun isPaused(jobId: String): Boolean = paused.containsKey(jobId)

  fun isActive(jobId: String): Boolean = active.containsKey(jobId) || paused.containsKey(jobId)

  fun count(): Int = active.size + paused.size

  private fun postAction(jobId: String, action: String) {
    emit(
      "SincDownloadAction",
      Arguments.createMap().apply {
        putString("jobId", jobId)
        putString("action", action)
      },
    )
  }

  fun emitYtProgress(
    jobId: String,
    percent: Int?,
    speedText: String? = null,
    bytesDownloaded: Long? = null,
    bytesTotal: Long? = null,
    indeterminate: Boolean = percent == null,
  ) {
    emit(
      "SincYtProgress",
      Arguments.createMap().apply {
        putString("jobId", jobId)
        if (percent != null) putDouble("percent", percent.toDouble())
        putBoolean("indeterminate", indeterminate)
        if (!speedText.isNullOrBlank()) putString("speed", speedText)
        if (bytesDownloaded != null) putDouble("bytesDownloaded", bytesDownloaded.toDouble())
        if (bytesTotal != null && bytesTotal > 0L) putDouble("bytesTotal", bytesTotal.toDouble())
      },
    )
  }

  /** Signals the JS store that an engine transfer began, before the first %
   * line arrives, so the download row flips from "resolving" to a ticking
   * progress bar right at `download start` instead of after up to several
   * buffered seconds of stderr output. */
  fun postTransferStarted(jobId: String) {
    stages.remove(jobId)
    postAction(jobId, "transfer")
  }

  /**
   * Reports real post-transfer work so JS and the notification can say
   * "Processing audio…", "Writing tags…" or "Verifying audio…" instead of a
   * frozen / misleading 100% download bar.
   */
  fun postStage(jobId: String, stage: String) {
    if (!active.containsKey(jobId)) return
    if (stage != "processing" && stage != "tagging" && stage != "validating") return
    stages[jobId] = stage
    emit(
      "SincDownloadStage",
      Arguments.createMap().apply {
        putString("jobId", jobId)
        putString("stage", stage)
      },
    )
    refresh()
  }

  private val mainHandler = Handler(Looper.getMainLooper())

  private fun emit(name: String, payload: WritableMap) {
    // Callers include yt-dlp stderr-reader threads — the RN emitter must run
    // on the main thread. The emitter dies with the Catalyst instance during
    // teardown; RuntimeException there is "nothing to emit to", not a crash.
    val target = react ?: return
    val send = {
      try {
        target
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          ?.emit(name, payload)
      } catch (_: RuntimeException) {
        // Context already torn down.
      }
    }
    if (Looper.myLooper() == Looper.getMainLooper()) {
      send()
    } else {
      mainHandler.post { send() }
    }
  }

  private fun ensureServiceRunning() {
    val ctx = react ?: return
    val intent = Intent(ctx, SincDownloadService::class.java)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        ctx.startForegroundService(intent)
      } else {
        ctx.startService(intent)
      }
    } catch (e: Exception) {
      // Android 12+ denies foreground-service starts while the app is in the
      // background (and Samsung battery management pauses them more eagerly).
      // That must NOT kill the transfer: yt-dlp keeps running while Sinc is
      // open; it simply isn't protected from process death until a later
      // service start succeeds.
      Log.w(
        "SincDownloads",
        "foreground service denied (${e.message}); download runs without background protection"
      )
    }
    serviceStarted.set(true)
  }

  fun stopServiceIfIdle() {
    if (!serviceStarted.get()) return
    val ctx = react ?: return
    if (count() == 0) {
      serviceStarted.set(false)
      ctx.stopService(Intent(ctx, SincDownloadService::class.java))
    }
  }

  // ---------------------------------------------------------------------
  // Foreground notification
  // ---------------------------------------------------------------------

  private data class NotifInfo(
    val title: String,
    val jobId: String?,
    val pct: Int,
    val paused: Boolean,
    val indeterminate: Boolean,
    val stage: String?,
  )

  private fun describe(): NotifInfo {
    if (count() == 0) return NotifInfo("Downloads", null, 0, false, false, null)
    val ids = active.keys + paused.keys
    val jobId = ids.last()
    val isPaused = paused.containsKey(jobId)
    val label = if (isPaused) paused[jobId]?.title else active[jobId]?.title
    return NotifInfo(
      label ?: "Downloading",
      jobId,
      progress[jobId] ?: 0,
      isPaused,
      indeterminate.contains(jobId),
      stages[jobId],
    )
  }

  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      val channel = NotificationChannel(
        CHANNEL_ID,
        "Downloads",
        NotificationManager.IMPORTANCE_LOW,
      ).apply { description = "Progress for active Sinc downloads" }
      nm.createNotificationChannel(channel)
    }
  }

  /** The foreground notification the service is bound to (works before RN is up). */
  fun buildNotification(context: Context): Notification = build(context, describe())

  fun refresh() {
    val ctx = react ?: return
    if (count() == 0) {
      NotificationManagerCompat.from(ctx).cancel(NOTIF_ID)
      stopServiceIfIdle()
      return
    }
    try {
      NotificationManagerCompat.from(ctx).notify(NOTIF_ID, buildNotification(ctx))
    } catch (e: SecurityException) {
      // POST_NOTIFICATIONS denied: the transfer still runs in the foreground.
    }
  }

  private fun build(context: Context, info: NotifInfo): Notification {
    ensureChannel(context)
    val stageText = when (info.stage) {
      "processing" -> "Processing audio…"
      "tagging" -> "Writing tags…"
      "validating" -> "Verifying audio…"
      else -> null
    }
    val text = when {
      info.paused -> "Paused ${info.pct}% — tap Resume"
      stageText != null -> stageText
      info.indeterminate -> "Downloading…"
      else -> "Downloading ${info.pct}%"
    }
    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
      .setContentTitle(info.title)
      .setContentText(text)
      .setOngoing(true)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .setOnlyAlertOnce(true)
      .setProgress(
        100,
        if (info.paused) 0 else info.pct,
        info.paused || info.indeterminate,
      )
      .setContentIntent(openAppIntent(context))
      .setPriority(NotificationCompat.PRIORITY_LOW)
    info.jobId?.let { addActions(builder, it) }
    return builder.build()
  }

  private fun addActions(builder: NotificationCompat.Builder, jobId: String) {
    val ctx = react ?: return
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    val action = { action: String, label: String ->
      NotificationCompat.Action.Builder(
        0,
        label,
        PendingIntent.getBroadcast(
          ctx,
          // The request code must be unique per (job, action): keying only on
          // the action overwrote Pause/Cancel across concurrent downloads, so
          // tapping a button could hit the wrong transfer.
          "$jobId:$action".hashCode(),
          Intent(ctx, DownloadActionReceiver::class.java)
            .setAction(action)
            .putExtra(EXTRA_JOB, jobId),
          flags,
        ),
      ).build()
    }
    if (paused.containsKey(jobId)) {
      builder.addAction(action(ACTION_RESUME, "Resume"))
    } else {
      builder.addAction(action(ACTION_PAUSE, "Pause"))
    }
    builder.addAction(action(ACTION_CANCEL, "Cancel"))
  }

  private fun openAppIntent(ctx: Context): PendingIntent? {
    val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: return null
    return PendingIntent.getActivity(
      ctx,
      4,
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  const val ACTION_CANCEL = "com.sinc.app.DL_CANCEL"
  const val ACTION_PAUSE = "com.sinc.app.DL_PAUSE"
  const val ACTION_RESUME = "com.sinc.app.DL_RESUME"
  const val EXTRA_JOB = "extra_job"
}