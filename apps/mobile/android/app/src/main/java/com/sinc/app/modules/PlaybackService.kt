package com.sinc.app.modules

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import androidx.core.app.ServiceCompat
import androidx.media3.common.AudioAttributes
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.CommandButton
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionCommands
import androidx.media3.session.SessionResult
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.sinc.app.MainActivity

/**
 * Foreground media service that owns the single process-wide ExoPlayer and its
 * MediaSession. The module never creates players itself; it talks to this
 * service so playback keeps running (and stays controllable from the lock
 * screen / notification shade) while the app is backgrounded.
 */
class PlaybackService : MediaSessionService() {

  private var mediaSession: MediaSession? = null

  companion object {
    /** Module currently owning the React context; receives events + commands. */
    @Volatile var activeModule: SincPlayerModule? = null

    @Volatile private var serviceInstance: PlaybackService? = null
    @Volatile private var exoPlayer: ExoPlayer? = null

    private const val NEXT_CUSTOM_ACTION = "com.sinc.app.command.next"
    private const val COMPACT_VIEW_INDEX = "androidx.media3.session.command.COMPACT_VIEW_INDEX"

    /** The process-wide player, created on first use. */
    fun getPlayer(context: Context): ExoPlayer {
      exoPlayer?.let { return it }
      return ExoPlayer.Builder(context)
        .setAudioAttributes(AudioAttributes.DEFAULT, true)
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
      }

      override fun onIsPlayingChanged(isPlaying: Boolean) {
        Log.i("SincPlayer", "isPlaying=$isPlaying track=${SincPlayerModule.sharedTrackId}")
      }

      override fun onPlayerError(error: PlaybackException) {
        Log.i("SincPlayer", "error code=${error.errorCode} msg=${error.message}")
        activeModule?.emitError(error.message)
      }
    }
  }

  override fun onCreate() {
    super.onCreate()
    serviceInstance = this
    val player = getPlayer(this)

    val sessionActivity =
      PendingIntent.getActivity(
        this,
        0,
        Intent(this, MainActivity::class.java).apply { flags = Intent.FLAG_ACTIVITY_SINGLE_TOP },
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )

    val nextButton =
      CommandButton.Builder(CommandButton.ICON_UNDEFINED)
        .setIconResId(android.R.drawable.ic_media_next)
        .setSessionCommand(SessionCommand(NEXT_CUSTOM_ACTION, Bundle.EMPTY))
        .setDisplayName("Skip to next item")
        .setExtras(Bundle().apply { putInt(COMPACT_VIEW_INDEX, 2) })
        .build()

    mediaSession =
      MediaSession.Builder(this, player)
        .setSessionActivity(sessionActivity)
        .setCustomLayout(listOf(nextButton))
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
                    add(SessionCommand(NEXT_CUSTOM_ACTION, Bundle.EMPTY))
                  }
                  .build()
              return MediaSession.ConnectionResult.AcceptedResultBuilder(mediaSession)
                .setAvailableSessionCommands(sessionCommands)
                .setAvailablePlayerCommands(MediaSession.ConnectionResult.DEFAULT_PLAYER_COMMANDS)
                .build()
            }

            override fun onPlayerCommandRequest(
              mediaSession: MediaSession,
              controller: MediaSession.ControllerInfo,
              command: Int,
            ): Int {
              return when (command) {
                Player.COMMAND_SEEK_TO_PREVIOUS,
                Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM,
                -> {
                  emitCommand("previous")
                  SessionResult.RESULT_ERROR_PERMISSION_DENIED
                }
                Player.COMMAND_SEEK_TO_NEXT,
                Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
                -> {
                  emitCommand("next")
                  SessionResult.RESULT_ERROR_PERMISSION_DENIED
                }
                else -> SessionResult.RESULT_SUCCESS
              }
            }

            override fun onCustomCommand(
              mediaSession: MediaSession,
              controller: MediaSession.ControllerInfo,
              sessionCommand: SessionCommand,
              args: Bundle,
            ): ListenableFuture<SessionResult> {
              return when (sessionCommand.customAction) {
                NEXT_CUSTOM_ACTION -> {
                  emitCommand("next")
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
    // Intentionally left blank.
  }

  override fun onDestroy() {
    mediaSession?.release()
    mediaSession = null
    serviceInstance = null
    releasePlayer()
    Log.i("SincPlayer", "PlaybackService destroyed")
    super.onDestroy()
  }

  private fun emitCommand(command: String) {
    activeModule?.emitCommand(command)
  }
}