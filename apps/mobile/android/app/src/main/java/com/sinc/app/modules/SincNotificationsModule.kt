package com.sinc.app.modules

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.sinc.app.R

/**
 * Local update notifications. There is no backend in the local app, so a new
 * APK release is surfaced with a one-shot System notification ("Sinc X is
 * available") instead of a remote push. Tapping it opens the release page in
 * the browser. Reminders are de-duplicated in JS (once per release); this
 * module only posts the notification.
 */
class SincNotificationsModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "SincNotifications"

  /** Posts a one-shot update notification; resolves false when notifications are denied. */
  @ReactMethod
  fun showUpdateAvailable(versionName: String, releaseUrl: String, promise: Promise) {
    try {
      // Android 13+ gates notifications behind POST_NOTIFICATIONS. Media
      // playback already requests it, so users who opted out simply get no
      // update notification (the in-app banner still shows).
      if (
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
        reactApplicationContext.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) !=
        android.content.pm.PackageManager.PERMISSION_GRANTED
      ) {
        promise.resolve(false)
        return
      }

      val channelId = "sinc_updates"
      // NotificationChannel exists only on API 26+ (minSdk 23): referencing the
      // class below O throws NoClassDefFoundError, which `catch (Exception)`
      // cannot intercept — guard the SDK level before anything touches it.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val channel =
          NotificationChannel(channelId, "Sinc updates", NotificationManager.IMPORTANCE_DEFAULT)
        reactApplicationContext.getSystemService(NotificationManager::class.java)
          .createNotificationChannel(channel)
      }

      val intent = Intent(Intent.ACTION_VIEW, android.net.Uri.parse(releaseUrl))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      val pendingIntent = PendingIntent.getActivity(
        reactApplicationContext,
        0,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )

      val notification =
        NotificationCompat.Builder(reactApplicationContext, channelId)
          .setSmallIcon(R.mipmap.ic_launcher)
          .setContentTitle("Sinc $versionName is available")
          .setContentText("Tap to download the update.")
          .setContentIntent(pendingIntent)
          .setAutoCancel(true)
          .build()

      NotificationManagerCompat.from(reactApplicationContext)
        .notify(UPDATE_NOTIFICATION_ID, notification)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("NOTIFICATION_ERROR", e.message)
    }
  }

  private companion object {
    const val UPDATE_NOTIFICATION_ID = 4011
  }
}