package com.sinc.app.modules

import android.annotation.SuppressLint
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.os.PowerManager

/**
 * Foreground service that keeps download transfers alive while the app is
 * backgrounded. It owns no work of its own: [SincDownloads] starts it on the
 * first job, feeds it progress, and stops it once every job has finished.
 *
 * Besides the FGS priority, a partial wake lock is held for the service's
 * lifetime: the data-sync FGS keeps the process alive, but without a CPU lock
 * the device can still deep-sleep in the middle of a long yt-dlp/ffmpeg run.
 */
class SincDownloadService : Service() {

  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  @SuppressLint("WakelockTimeout")
  override fun onCreate() {
    super.onCreate()
    val ctx = applicationContext
    SincDownloads.ensureChannel(ctx)
    acquireWakeLock(ctx)
    startForeground(SincDownloads.NOTIF_ID, SincDownloads.buildNotification(ctx))
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val ctx = applicationContext
    SincDownloads.ensureChannel(ctx)
    startForeground(SincDownloads.NOTIF_ID, SincDownloads.buildNotification(ctx))
    if (SincDownloads.count() == 0) {
      stopSelf()
      return START_NOT_STICKY
    }
    return START_STICKY
  }

  override fun onDestroy() {
    releaseWakeLock()
    try {
      getSystemService(NotificationManager::class.java).cancel(SincDownloads.NOTIF_ID)
    } catch (_: Exception) {
      // Notification already gone.
    }
    super.onDestroy()
  }

  private fun acquireWakeLock(ctx: android.content.Context) {
    if (wakeLock?.isHeld == true) return
    try {
      val power = ctx.getSystemService(POWER_SERVICE) as PowerManager
      wakeLock = power
        .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Sinc:downloads")
        .apply {
          setReferenceCounted(false)
          acquire()
        }
    } catch (_: Exception) {
      // Denied/absent PowerManager must not take the transfer down.
    }
  }

  private fun releaseWakeLock() {
    try {
      wakeLock?.let { if (it.isHeld) it.release() }
    } catch (_: Exception) {
    }
    wakeLock = null
  }
}
