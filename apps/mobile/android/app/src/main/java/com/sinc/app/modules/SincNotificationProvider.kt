package com.sinc.app.modules

import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.CommandButton
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaNotification
import androidx.media3.session.MediaSession
import com.google.common.collect.ImmutableList
import com.sinc.app.MainActivity
import com.sinc.app.R

/**
 * Wraps Media3's default media notification.
 *
 * Why: when "Show lyrics" is delivered as a session custom command, the service
 * calls `PendingIntent.send()` itself. The app is then a background process
 * (foreground-service state only), and Android 14 blocks the activity launch
 * ("Background activity launch blocked"). A notification action whose
 * PendingIntent targets the activity is instead sent by SystemUI, which is
 * allowed to launch activities — so the lyrics screen opens reliably from the
 * notification and the lockscreen media player.
 *
 * The platform's `Notification.Builder.recoverBuilder` (API 24+) restores the
 * MediaStyle from the notification extras, so the transport/lockscreen
 * treatment is preserved while the extra action is appended.
 */
@OptIn(UnstableApi::class)
class SincNotificationProvider(
  private val context: Context,
  private val base: DefaultMediaNotificationProvider,
) : MediaNotification.Provider {

  override fun createNotification(
    mediaSession: MediaSession,
    customLayout: ImmutableList<CommandButton>,
    actionFactory: MediaNotification.ActionFactory,
    onNotificationChangedCallback: MediaNotification.Provider.Callback,
  ): MediaNotification {
    val baseNotification =
      base.createNotification(
        mediaSession,
        customLayout,
        actionFactory,
        onNotificationChangedCallback,
      )
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return baseNotification
    return try {
      val builder = Notification.Builder.recoverBuilder(context, baseNotification.notification)
      builder.addAction(
        Notification.Action.Builder(
          Icon.createWithResource(context, R.drawable.ic_sinc_lyrics),
          "Lyrics",
          lyricsPendingIntent(),
        ).build()
      )
      MediaNotification(baseNotification.notificationId, builder.build())
    } catch (e: Exception) {
      // Never let the extra action break the media notification.
      baseNotification
    }
  }

  override fun handleCustomCommand(
    session: MediaSession,
    action: String,
    extras: Bundle,
  ): Boolean = base.handleCustomCommand(session, action, extras)

  private fun lyricsPendingIntent(): PendingIntent =
    PendingIntent.getActivity(
      context,
      LYRICS_REQUEST_CODE,
      Intent(context, MainActivity::class.java).apply {
        this.action = Intent.ACTION_VIEW
        data = Uri.parse("sinc://lyrics")
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
      },
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

  private companion object {
    const val LYRICS_REQUEST_CODE = 4201
  }
}
