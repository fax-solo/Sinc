package com.sinc.app.modules

import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.IBinder

/**
 * Foreground service that keeps download transfers alive while the app is
 * backgrounded. It owns no work of its own: [SincDownloads] starts it on the
 * first job, feeds it progress, and stops it once every job has finished.
 */
class SincDownloadService : Service() {

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    val ctx = applicationContext
    SincDownloads.ensureChannel(ctx)
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
    try {
      getSystemService(NotificationManager::class.java).cancel(SincDownloads.NOTIF_ID)
    } catch (_: Exception) {
      // Notification already gone.
    }
    super.onDestroy()
  }
}