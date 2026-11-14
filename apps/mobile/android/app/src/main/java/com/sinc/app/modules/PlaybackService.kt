package com.sinc.app.modules

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.app.ServiceCompat
import androidx.media3.common.AudioAttributes
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.CommandButton
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionCommands
import androidx.media3.session.SessionResult
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.sinc.app.MainActivity
import com.sinc.app.R

/**
 * Foreground media service that owns the single process-wide ExoPlayer and its
 * MediaSession. The module never creates players itself; it talks to this
 * service so playback keeps running (and stays controllable from the lock
 * screen / notification shade) while the app is backgrounded.
 *
 * Transport authority: this ExoPlayer (position, playing/paused, buffering).
 * Queue/user intent authority: the JS player store. The routing player and the
 * state snapshot keep those two layers synchronized without duplicating state.
 */
class PlaybackService : MediaSessionService() {

  private var mediaSession: MediaSession? = null
  private val mainHandler = Handler(Looper.getMainLooper())

  companion object {
    private const val CHANNEL_ID = "sinc_playback"
    private const val NOTIF_ID = 4200
    private const val LYRICS_REQUEST_CODE = 4201

    private const val LYRICS_CUSTOM_ACTION = "com.sinc.app.command.lyrics"
    private const val FAVORITE_CUSTOM_ACTION = "com.sinc.app.command.favorite"

    /** Module currently owning the React context; receives events + commands. */
    @Volatile var activeModule: SincPlayerModule? = null

    @Volatile private var serviceInstance: PlaybackService? = null
    @Volatile private var exoPlayer: ExoPlayer? = null

    /** Mirrored favorite state for the current track, owned by the JS library store. */
    @Volatile var currentFavorite: Boolean = false

    /** Explicitly chosen audio output, `-1`/null means follow the OS default. */
    @Volatile var preferredAudioDeviceId: Int? = null

    /** The process-wide player, created on first use. */
    fun getPlayer(context: Context): ExoPlayer {
      exoPlayer?.let { return it }
      return ExoPlayer.Builder(context)
        .setAudioAttributes(AudioAttributes.DEFAULT, true)
        .setHandleAudioBecomingNoisy(true)
        .build()
        .apply { addListener(playerListener) }
        .also { exoPlayer = it }
    }

    fun playerOrNull(): ExoPlayer? = exoPlayer

    fun releasePlayer() {
      val p = exoPlayer ?: return
      p.stop()
      p.release()
      exoPlayer = null
    }

    fun start(context: Context) {
      val intent = Intent(context, PlaybackService::class.java)
      context.startForegroundService(intent)
    }

    fun stop() {
      releasePlayer()
      serviceInstance?.let { service ->
        ServiceCompat.stopForeground(service, ServiceCompat.STOP_FOREGROUND_REMOVE)
        service.stopSelf()
      }
    }

    /** Mirrors JS-owned favorite state for the current track. */
    fun setFavoriteState(favorite: Boolean) {
      currentFavorite = favorite
      serviceInstance?.refreshCustomLayout()
    }

    fun snapshot(): PlaybackSnapshot {
      val p = exoPlayer ?: return PlaybackSnapshot(
        trackId = SincPlayerModule.sharedTrackId,
        isPlaying = false,
        playbackState = "idle",
        positionMs = 0,
        durationMs = 0,
        bufferedPositionMs = 0,
        favorite = currentFavorite,
        shuffle = false,
        repeat = "off",
      )
      val playbackState = when (p.playbackState) {
        Player.STATE_IDLE -> "idle"
        Player.STATE_BUFFERING -> "buffering"
        Player.STATE_READY -> "ready"
        Player.STATE_ENDED -> "ended"
        else -> "unknown"
      }
      return PlaybackSnapshot(
        trackId = p.currentMediaItem?.mediaId ?: SincPlayerModule.sharedTrackId,
        isPlaying = p.isPlaying,
        playbackState = playbackState,
        positionMs = p.currentPosition.coerceAtLeast(0),
        durationMs = p.duration.takeIf { it >= 0 } ?: 0,
        bufferedPositionMs = p.bufferedPosition.coerceAtLeast(0),
        favorite = currentFavorite,
        shuffle = p.shuffleModeEnabled,
        repeat = when (p.repeatMode) {
          Player.REPEAT_MODE_ONE -> "one"
          Player.REPEAT_MODE_ALL -> "all"
          else -> "off"
        },
      )
    }

    private fun notifyState() {
      activeModule?.emitState(snapshot())
    }

    private val playerListener = object : Player.Listener {
      override fun onPlaybackStateChanged(state: Int) {
        val label =
          when (state) {
            Player.STATE_IDLE -> "idle"
            Player.STATE_BUFFERING -> "buffering"
            Player.STATE_READY -> "ready"
            Player.STATE_ENDED -> "ended"
            else -> "unknown"
          }
        Log.i("SincPlayer", "state=$label track=${SincPlayerModule.sharedTrackId}")
        if (state == Player.STATE_ENDED) {
          activeModule?.emitCompletion(SincPlayerModule.sharedTrackId)
        }
        notifyState()
      }

      override fun onIsPlayingChanged(isPlaying: Boolean) {
        Log.i("SincPlayer", "isPlaying=$isPlaying track=${SincPlayerModule.sharedTrackId}")
        notifyState()
      }

      override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
        notifyState()
      }

      override fun onPlayerError(error: PlaybackException) {
        Log.i("SincPlayer", "error code=${error.errorCode} msg=${error.message}")
        activeModule?.emitError(error.message)
        notifyState()
      }
    }
  }

  override fun onCreate() {
    super.onCreate()
    serviceInstance = this

    val notificationProvider =
      DefaultMediaNotificationProvider.Builder(this)
        .setChannelId(CHANNEL_ID)
        .setChannelName(R.string.notification_channel_playback)
        .setNotificationId(DefaultMediaNotificationProvider.DEFAULT_NOTIFICATION_ID)
        .build()
    notificationProvider.setSmallIcon(R.drawable.ic_sinc_notification)
    setMediaNotificationProvider(SincNotificationProvider(this, notificationProvider))

    val player = getPlayer(this)

    val sessionActivity =
      PendingIntent.getActivity(
        this,
        0,
        Intent(this, MainActivity::class.java).apply { flags = Intent.FLAG_ACTIVITY_SINGLE_TOP },
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )

    mediaSession =
      MediaSession.Builder(this, SincQueueRoutingPlayer(player) { command -> emitCommand(command) })
        .setSessionActivity(sessionActivity)
        .setCustomLayout(customLayout())
        .setCallback(
          object : MediaSession.Callback {
            override fun onConnect(
              mediaSession: MediaSession,
              controller: MediaSession.ControllerInfo,
            ): MediaSession.ConnectionResult {
              val sessionCommands =
                SessionCommands.Builder()
                  .apply {
                    MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.commands.forEach { add(it) }
                    add(SessionCommand(LYRICS_CUSTOM_ACTION, Bundle.EMPTY))
                    add(SessionCommand(FAVORITE_CUSTOM_ACTION, Bundle.EMPTY))
                  }
                  .build()
              return MediaSession.ConnectionResult.AcceptedResultBuilder(mediaSession)
                .setAvailableSessionCommands(sessionCommands)
                .setAvailablePlayerCommands(MediaSession.ConnectionResult.DEFAULT_PLAYER_COMMANDS)
                .build()
            }

            override fun onCustomCommand(
              mediaSession: MediaSession,
              controller: MediaSession.ControllerInfo,
              sessionCommand: SessionCommand,
              args: Bundle,
            ): ListenableFuture<SessionResult> {
              return when (sessionCommand.customAction) {
                LYRICS_CUSTOM_ACTION -> {
                  openLyrics()
                  Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
                }
                FAVORITE_CUSTOM_ACTION -> {
                  // The library store owns favorites; JS applies the toggle and
                  // pushes the new state back through `setFavorite`.
                  activeModule?.emitCommand(
                    "favorite",
                    mediaSession.player.currentMediaItem?.mediaId,
                  )
                  Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
                }
                else ->
                  Futures.immediateFuture(
                    SessionResult(SessionResult.RESULT_ERROR_BAD_VALUE),
                  )
              }
            }
          },
        )
        .build()

    // media3 only wires up its internal notification controller when the
    // service receives a media-button intent or `addSession` is called. Without
    // a controller the manager never posts the notification nor calls
    // `startForeground()`, which makes `startForegroundService()` crash after
    // the timeout. Register the session explicitly so the lock-screen /
    // notification controls appear and the service runs in the foreground.
    mediaSession?.let { addSession(it) }
    Log.i("SincPlayer", "PlaybackService created")
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = mediaSession

  /** Keep playing when the user swipes the app away from recents. */
  override fun onTaskRemoved(rootIntent: Intent?) {
    // media3's default policy is correct: an ongoing session stays alive, an
    // idle/paused one stops the service. Calling super unconditionally paused
    // live playback, so gate it explicitly.
    if (!isPlaybackOngoing) {
      pauseAllPlayersAndStopSelf()
    }
  }

  override fun onDestroy() {
    mediaSession?.release()
    mediaSession = null
    serviceInstance = null
    releasePlayer()
    Log.i("SincPlayer", "PlaybackService destroyed")
    super.onDestroy()
  }

  private fun customLayout(): List<CommandButton> {
    // "Show lyrics" is not a session button on purpose: it is added to the
    // notification as an activity PendingIntent by SincNotificationProvider,
    // because Android 14 blocks activity launches from a background media
    // service. Favorite stays a session command (no activity launch needed).
    val favoriteButton =
      CommandButton.Builder(
        if (currentFavorite) CommandButton.ICON_HEART_FILLED else CommandButton.ICON_HEART_UNFILLED,
      )
        .setDisplayName(
          if (currentFavorite) "Remove from Liked Songs" else "Add to Liked Songs",
        )
        .setEnabled(activeModule != null)
        .setSessionCommand(SessionCommand(FAVORITE_CUSTOM_ACTION, Bundle.EMPTY))
        .build()
    return listOf(favoriteButton)
  }

  private fun refreshCustomLayout() {
    mainHandler.post {
      try {
        mediaSession?.setCustomLayout(customLayout())
      } catch (e: Exception) {
        Log.w("SincPlayer", "custom layout refresh failed: ${e.message}")
      }
    }
  }

  private fun openLyrics() {
    val intent =
      Intent(this, MainActivity::class.java).apply {
        action = Intent.ACTION_VIEW
        data = Uri.parse("sinc://lyrics")
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
      }
    // The media notification action is a user-initiated launch, so Android
    // allows it through its normal PendingIntent path. startActivity is only a
    // fallback for OEMs with aggressive background-activity restrictions.
    try {
      PendingIntent
        .getActivity(
          this,
          LYRICS_REQUEST_CODE,
          intent,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        .send()
    } catch (e: Exception) {
      Log.w("SincPlayer", "lyrics pending intent failed: ${e.message}")
      try {
        startActivity(intent)
      } catch (e2: Exception) {
        Log.w("SincPlayer", "lyrics activity launch failed: ${e2.message}")
      }
    }
  }

  private fun emitCommand(command: String) {
    activeModule?.emitCommand(command, null)
  }
}
