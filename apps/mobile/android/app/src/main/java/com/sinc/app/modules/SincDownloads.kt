package com.sinc.app.modules

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ContentResolver
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
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
import com.sinc.app.MainActivity
import com.sinc.app.R
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.Collections
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

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
  const val RESULTS_CHANNEL_ID = "sinc_download_results"
  const val NOTIF_ID = 94000

  const val OUTCOME_COMPLETED = "completed"
  const val OUTCOME_FAILED = "failed"
  const val OUTCOME_CANCELLED = "cancelled"

  private const val PREFS = "sinc_download_notifications"
  private const val KEY_IDS = "progress_ids"

  private data class Job(
    val title: String,
    val artist: String?,
    val artworkUrl: String?,
    /** Stable start order, so the foreground card never jumps between jobs. */
    val order: Long,
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
  private val bytesDone = ConcurrentHashMap<String, Long>()
  private val bytesTotal = ConcurrentHashMap<String, Long>()
  private val serviceStarted = AtomicBoolean(false)
  private val nextOrder = AtomicInteger(0)

  /** Notification ids, allocated per job attempt so retries never collide. */
  private val progressNotifIds = ConcurrentHashMap<String, Int>()
  private val resultNotifIds = ConcurrentHashMap<String, Int>()
  private val nextProgressNotifId = AtomicInteger(95000)
  private val nextResultNotifId = AtomicInteger(1_000_000)

  /** Artwork is prefetched once per URL for the notification's large icon. */
  private val artworkCache = ConcurrentHashMap<String, Bitmap>()
  private val artworkLoading = Collections.newSetFromMap(ConcurrentHashMap<String, Boolean>())
  private val artworkFailed = Collections.newSetFromMap(ConcurrentHashMap<String, Boolean>())
  private val artworkExecutor = Executors.newFixedThreadPool(2)

  @Volatile
  private var react: ReactApplicationContext? = null

  /** Notification ids currently posted for progress, mirrored to disk so a
   *  process killed mid-download does not leave undismissable stale cards. */
  private var persistedIds: Set<Int> = emptySet()
  private val staleCardsCleaned = AtomicBoolean(false)

  /** Sets the RN context used for JS progress/action events. */
  fun attach(ctx: ReactApplicationContext) {
    react = ctx
    // First attach in a process: any progress card we persisted belongs to a
    // dead transfer (the in-memory registry starts empty). Cancel it.
    if (staleCardsCleaned.compareAndSet(false, true)) {
      val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val stale = prefs.getStringSet(KEY_IDS, null) ?: emptySet()
      val nm = NotificationManagerCompat.from(ctx)
      (stale + NOTIF_ID.toString()).forEach { raw ->
        raw.toIntOrNull()?.let { id ->
          try {
            nm.cancel(id)
          } catch (_: SecurityException) {
          }
        }
      }
      prefs.edit().remove(KEY_IDS).apply()
    }
  }

  private fun persistProgressIds() {
    val ctx = react ?: return
    val ids = progressNotifIds.values.toSet() + NOTIF_ID
    if (ids == persistedIds) return
    persistedIds = ids
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putStringSet(KEY_IDS, ids.mapTo(HashSet()) { it.toString() })
      .apply()
  }

  private fun clearPersistedIds() {
    persistedIds = emptySet()
    val ctx = react ?: return
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY_IDS).apply()
  }

  fun begin(
    jobId: String,
    title: String,
    artist: String? = null,
    artworkUrl: String? = null,
    kill: () -> Unit,
    cleanup: () -> Unit = {},
  ) {
    // A re-entrant start for the same job must stop the old transfer before it
    // replaces the handle; otherwise the old process can keep writing/publish
    // after the new attempt has taken over the job id.
    active.put(
      jobId,
      Job(title, artist, artworkUrl, nextOrder.getAndIncrement().toLong(), kill, cleanup),
    )?.let { previous ->
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
    bytesDone.remove(jobId)
    bytesTotal.remove(jobId)
    // A retry reuses the job id: the previous result card must not linger
    // beside the new progress card (it still gets the same id back on end).
    cancelNotification(resultNotifIds[jobId])
    loadArtwork(artworkUrl)
    mainHandler.removeCallbacks(serviceStopRunnable)
    ensureServiceRunning()
    refresh()
  }

  fun update(jobId: String, percent: Int) {
    if (!active.containsKey(jobId)) return
    indeterminate.remove(jobId)
    progress[jobId] = percent.coerceIn(0, 99)
    refresh()
  }

  /** HTTP transfers know real byte counts; yt-dlp only some of the time. */
  fun updateBytes(jobId: String, percent: Int?, bytesDownloaded: Long, totalBytes: Long) {
    if (!active.containsKey(jobId)) return
    if (percent != null) {
      indeterminate.remove(jobId)
      progress[jobId] = percent.coerceIn(0, 99)
    }
    if (bytesDownloaded > 0) bytesDone[jobId] = bytesDownloaded else bytesDone.remove(jobId)
    if (totalBytes > 0) bytesTotal[jobId] = totalBytes else bytesTotal.remove(jobId)
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
    bytesDone.remove(jobId)
    bytesTotal.remove(jobId)
    job.kill()
    // Cancel means "remove the partial too". Pause deliberately does not run
    // this: its `.part` is what the resume request continues from.
    try {
      job.cleanup()
    } catch (_: Exception) {
    }
    cancelNotification(progressNotifIds.remove(jobId))
    postResult(jobId, job, OUTCOME_CANCELLED)
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
    bytesDone.remove(jobId)
    bytesTotal.remove(jobId)
    try {
      job.kill()
    } catch (_: Exception) {
    }
    try {
      job.cleanup()
    } catch (_: Exception) {
    }
    // Deleting/abandoning a download cancels its live progress card. Finished
    // result cards are left alone: they are auto-dismissable and must survive
    // the cleanup that follows a notification Cancel.
    cancelNotification(progressNotifIds.remove(jobId))
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

  /**
   * Called when a transfer genuinely ends. Posts a result card for the real
   * outcome ("completed", "failed", "cancelled") unless the end was caused by
   * a pause (a pause keeps the job resumable and must not look like a failure).
   */
  fun end(
    jobId: String,
    outcome: String = OUTCOME_COMPLETED,
    message: String? = null,
  ) {
    val wasActive = active.containsKey(jobId)
    val wasPaused = paused.containsKey(jobId)
    val job = active.remove(jobId) ?: paused.remove(jobId)
    paused.remove(jobId)
    progress.remove(jobId)
    stages.remove(jobId)
    indeterminate.remove(jobId)
    bytesDone.remove(jobId)
    bytesTotal.remove(jobId)
    cancelNotification(progressNotifIds.remove(jobId))
    // The transport aborts when the user pauses, so the module reports a
    // cancellation; that is not a user-visible result.
    val pauseAbort = outcome == OUTCOME_CANCELLED && wasPaused && !wasActive
    if (job != null && !pauseAbort) postResult(jobId, job, outcome, message)
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

  private val serviceStopRunnable = Runnable {
    synchronized(this) {
      if (count() == 0 && serviceStarted.get()) {
        val ctx = react ?: return@Runnable
        serviceStarted.set(false)
        cancelNotification(NOTIF_ID)
        clearPersistedIds()
        try {
          ctx.stopService(Intent(ctx, SincDownloadService::class.java))
        } catch (_: Exception) {
        }
      }
    }
  }

  fun scheduleStopServiceIfIdle(delayMs: Long = 10_000L) {
    mainHandler.removeCallbacks(serviceStopRunnable)
    if (count() == 0 && serviceStarted.get()) {
      mainHandler.postDelayed(serviceStopRunnable, delayMs)
    }
  }

  fun stopServiceIfIdle() {
    mainHandler.removeCallbacks(serviceStopRunnable)
    if (!serviceStarted.get()) return
    val ctx = react ?: return
    if (count() == 0) {
      serviceStarted.set(false)
      cancelNotification(NOTIF_ID)
      clearPersistedIds()
      try {
        ctx.stopService(Intent(ctx, SincDownloadService::class.java))
      } catch (_: Exception) {
      }
    }
  }

  // ---------------------------------------------------------------------
  // Notifications
  //
  // Two kinds, deliberately split:
  //  - the foreground notification (NOTIF_ID, bound to SincDownloadService)
  //    is also the primary job's card, so a single download produces exactly
  //    one card — never a summary plus a duplicate progress card. Concurrent
  //    jobs get their own card (95000+);
  //  - one result card per job (1,000,000+) on a separate results channel for
  //    completed / failed / cancelled, so a finished download does not
  //    overwrite the next transfer's progress.
  // ---------------------------------------------------------------------

  private data class JobView(
    val jobId: String,
    val title: String,
    val artist: String?,
    val artworkUrl: String?,
    val order: Long,
    val pct: Int,
    val paused: Boolean,
    val indeterminate: Boolean,
    val stage: String?,
    val doneBytes: Long,
    val totalBytes: Long,
  )

  private fun orderedJobs(): List<JobView> =
    (active.keys + paused.keys).distinct().mapNotNull { id ->
      val job = active[id] ?: paused[id] ?: return@mapNotNull null
      JobView(
        jobId = id,
        title = job.title,
        artist = job.artist,
        artworkUrl = job.artworkUrl,
        order = job.order,
        pct = progress[id] ?: 0,
        paused = paused.containsKey(id),
        indeterminate = indeterminate.contains(id),
        stage = stages[id],
        doneBytes = bytesDone[id] ?: 0L,
        totalBytes = bytesTotal[id] ?: 0L,
      )
    }.sortedBy { it.order }

  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      nm.createNotificationChannel(
        NotificationChannel(
          CHANNEL_ID,
          "Downloads",
          NotificationManager.IMPORTANCE_LOW,
        ).apply { description = "Progress for active Sinc downloads" }
      )
      nm.createNotificationChannel(
        NotificationChannel(
          RESULTS_CHANNEL_ID,
          "Download results",
          NotificationManager.IMPORTANCE_LOW,
        ).apply {
          description = "Completed, failed and cancelled Sinc downloads"
          setShowBadge(false)
        }
      )
    }
  }

  /** The foreground notification the service is bound to (works before RN is up). */
  fun buildNotification(context: Context): Notification =
    buildPrimary(context, orderedJobs().firstOrNull())

  @Synchronized
  fun refresh() {
    val ctx = react ?: return
    val jobs = orderedJobs()
    val primaryId = jobs.firstOrNull()?.jobId
    val live = jobs.mapTo(HashSet()) { it.jobId }
    // Cancel cards whose job vanished without an end() (defensive; end/cancel
    // normally remove their own card).
    for ((jobId, id) in progressNotifIds.toMap()) {
      if (jobId !in live) {
        cancelNotification(id)
        progressNotifIds.remove(jobId)
      }
    }
    jobs.forEach { job ->
      if (job.jobId == primaryId) {
        // The primary job owns the stable foreground id. If it was secondary
        // before (the previous primary ended), drop its second card first.
        cancelNotification(progressNotifIds.remove(job.jobId))
        notifySafe(ctx, NOTIF_ID, buildProgress(ctx, job))
      } else {
        val id =
          progressNotifIds.computeIfAbsent(job.jobId) { nextProgressNotifId.getAndIncrement() }
        notifySafe(ctx, id, buildProgress(ctx, job))
      }
    }
    if (jobs.isEmpty()) {
      // Grace period before tearing down the foreground service so consecutive
      // queued tasks do not cause service churn or notification flickering.
      scheduleStopServiceIfIdle(10_000L)
    } else {
      mainHandler.removeCallbacks(serviceStopRunnable)
      persistProgressIds()
    }
  }

  private fun notifySafe(ctx: Context, id: Int, notification: Notification) {
    try {
      NotificationManagerCompat.from(ctx).notify(id, notification)
    } catch (_: SecurityException) {
      // POST_NOTIFICATIONS denied: the transfer still runs in the foreground.
    }
  }

  private fun cancelNotification(id: Int?) {
    val ctx = react ?: return
    if (id == null) return
    try {
      NotificationManagerCompat.from(ctx).cancel(id)
    } catch (_: SecurityException) {
    }
  }

  private fun postResult(
    jobId: String,
    job: Job,
    outcome: String,
    message: String? = null,
  ) {
    val ctx = react ?: return
    val id = resultNotifIds.computeIfAbsent(jobId) { nextResultNotifId.getAndIncrement() }
    loadArtwork(job.artworkUrl)
    notifySafe(ctx, id, buildResult(ctx, job, outcome, message))
  }

  private fun buildProgress(context: Context, job: JobView): Notification {
    ensureChannel(context)
    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
      .setContentTitle(job.title)
      .setContentText(progressText(job))
      .setSubText(job.artist)
      .setLargeIcon(job.artworkUrl?.let { artworkCache[it] })
      .setSmallIcon(R.drawable.ic_sinc_notification)
      .setContentIntent(openDownloadsIntent(context))
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setProgress(
        100,
        if (job.paused) 0 else job.pct,
        job.paused || job.indeterminate || job.stage != null,
      )
    addActions(builder, context, job.jobId)
    return builder.build()
  }

  /** Foreground card: the primary job, or a placeholder during service start. */
  private fun buildPrimary(context: Context, job: JobView?): Notification {
    if (job != null) return buildProgress(context, job)
    ensureChannel(context)
    return NotificationCompat.Builder(context, CHANNEL_ID)
      .setContentTitle("Sinc downloads")
      .setContentText("Preparing download…")
      .setSmallIcon(R.drawable.ic_sinc_notification)
      .setContentIntent(openDownloadsIntent(context))
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setProgress(0, 0, true)
      .build()
  }

  private fun buildResult(
    context: Context,
    job: Job,
    outcome: String,
    message: String?,
  ): Notification {
    ensureChannel(context)
    val text = when (outcome) {
      OUTCOME_COMPLETED -> "Download complete · saved to Music/Sinc"
      OUTCOME_CANCELLED -> "Download cancelled"
      else ->
        if (message.isNullOrBlank()) "Download failed"
        else "Download failed — ${message.take(160)}"
    }
    return NotificationCompat.Builder(context, RESULTS_CHANNEL_ID)
      .setContentTitle(job.title)
      .setContentText(text)
      .setStyle(NotificationCompat.BigTextStyle().bigText(text))
      .setSubText(job.artist)
      .setLargeIcon(job.artworkUrl?.let { artworkCache[it] })
      .setSmallIcon(R.drawable.ic_sinc_notification)
      .setContentIntent(openDownloadsIntent(context))
      .setAutoCancel(true)
      .setOnlyAlertOnce(true)
      .setCategory(NotificationCompat.CATEGORY_STATUS)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()
  }

  private fun progressText(job: JobView): String {
    val stageText = when (job.stage) {
      "processing" -> "Processing audio…"
      "tagging" -> "Writing tags…"
      "validating" -> "Verifying audio…"
      else -> null
    }
    val size = sizeText(job.doneBytes, job.totalBytes)
    return when {
      job.paused -> "Paused · tap Resume"
      stageText != null -> stageText
      job.indeterminate || (job.pct <= 0 && job.totalBytes <= 0L) ->
        if (job.doneBytes > 0) "Downloading · ${formatBytes(job.doneBytes)}" else "Downloading…"
      else -> buildString {
        append("Downloading · ${job.pct}%")
        if (size.isNotEmpty()) {
          append(" · ")
          append(size)
        }
      }
    }
  }

  private fun sizeText(done: Long, total: Long): String =
    if (done > 0 && total > 0) "${formatBytes(done)} of ${formatBytes(total)}"
    else if (done > 0) formatBytes(done)
    else ""

  private fun formatBytes(bytes: Long): String {
    if (bytes <= 0) return ""
    if (bytes < 1024) return "$bytes B"
    val kb = bytes / 1024.0
    if (kb < 1024) return String.format(Locale.US, "%.0f KB", kb)
    val mb = kb / 1024.0
    if (mb < 1024) return String.format(Locale.US, "%.1f MB", mb)
    return String.format(Locale.US, "%.2f GB", mb / 1024.0)
  }

  private fun addActions(builder: NotificationCompat.Builder, context: Context, jobId: String) {
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    val action = { action: String, label: String ->
      NotificationCompat.Action.Builder(
        0,
        label,
        PendingIntent.getBroadcast(
          context,
          // The request code must be unique per (job, action): keying only on
          // the action overwrote Pause/Cancel across concurrent downloads, so
          // tapping a button could hit the wrong transfer.
          "$jobId:$action".hashCode(),
          Intent(context, DownloadActionReceiver::class.java)
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

  /** Opens the in-app Downloads screen (deep link mirrors the playback actions). */
  private fun openDownloadsIntent(ctx: Context): PendingIntent =
    PendingIntent.getActivity(
      ctx,
      5,
      Intent(ctx, MainActivity::class.java).apply {
        action = Intent.ACTION_VIEW
        data = Uri.parse("sinc://downloads")
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
      },
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

  private fun loadArtwork(url: String?) {
    val clean = url?.trim()?.takeIf { it.startsWith("http://") || it.startsWith("https://") }
      ?: return
    if (artworkCache.containsKey(clean) || artworkFailed.contains(clean)) return
    if (!artworkLoading.add(clean)) return
    artworkExecutor.execute {
      try {
        val bitmap = fetchArtwork(clean)
        if (bitmap != null) {
          if (artworkCache.size >= 64) artworkCache.clear()
          artworkCache[clean] = bitmap
          refresh()
        } else {
          artworkFailed.add(clean)
        }
      } catch (_: Exception) {
        artworkFailed.add(clean)
      } finally {
        artworkLoading.remove(clean)
      }
    }
  }

  private fun fetchArtwork(url: String): Bitmap? {
    val connection = (URL(url).openConnection() as? HttpURLConnection) ?: return null
    connection.connectTimeout = 8_000
    connection.readTimeout = 8_000
    connection.instanceFollowRedirects = true
    return try {
      if (connection.responseCode !in 200..299) return null
      val bytes = connection.inputStream.use { input ->
        val out = ByteArrayOutputStream()
        val buffer = ByteArray(16 * 1024)
        var total = 0
        while (true) {
          val read = input.read(buffer)
          if (read < 0) break
          total += read
          if (total > 6 * 1024 * 1024) return null
          out.write(buffer, 0, read)
        }
        out.toByteArray()
      }
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
      var sample = 1
      while (bounds.outWidth / sample > 512 || bounds.outHeight / sample > 512) sample *= 2
      BitmapFactory.decodeByteArray(
        bytes,
        0,
        bytes.size,
        BitmapFactory.Options().apply { inSampleSize = sample },
      )
    } catch (_: Exception) {
      null
    } finally {
      connection.disconnect()
    }
  }

  const val ACTION_CANCEL = "com.sinc.app.DL_CANCEL"
  const val ACTION_PAUSE = "com.sinc.app.DL_PAUSE"
  const val ACTION_RESUME = "com.sinc.app.DL_RESUME"
  const val EXTRA_JOB = "extra_job"
}
