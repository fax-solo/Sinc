package com.sinc.app.modules

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Bridge between React Native and the playback service. Playback state lives in
 * [PlaybackService] so it survives JS reloads and keeps running in the
 * background; this module only forwards commands and routes events.
 */
class SincPlayerModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "SincPlayer"

  companion object {
    /** Id of the track the process-wide player is (or was last) loaded with. */
    @Volatile var sharedTrackId: String? = null
  }

  private val mainHandler = Handler(Looper.getMainLooper())

  init {
    // A fresh module means the React context was rebuilt (JS reload / unmount).
    // The service owns the single player, so we only re-point event routing at
    // this instance — the audio keeps playing uninterrupted.
    PlaybackService.activeModule = this
  }

  private fun isHls(uri: String, mimeType: String?): Boolean {
    return uri.contains(".m3u8") || mimeType?.contains("mpegurl") == true || mimeType?.contains("m3u8") == true
  }

  private val progressRunnable = object : Runnable {
    override fun run() {
      if (this@SincPlayerModule !== PlaybackService.activeModule) return
      val p = PlaybackService.playerOrNull()
      if (sharedTrackId != null && p != null) {
        emit(
          "SincPlayerProgress",
          Arguments.createMap().apply {
            putString("trackId", sharedTrackId)
            putDouble("positionMs", p.currentPosition.toDouble())
            putDouble("durationMs", if (p.duration >= 0) p.duration.toDouble() else 0.0)
            putBoolean("isPlaying", p.isPlaying)
          },
        )
      }
      mainHandler.postDelayed(this, 500)
    }
  }

  @ReactMethod
  fun load(
    trackId: String,
    uri: String,
    mimeType: String?,
    headers: ReadableMap?,
    metadata: ReadableMap?,
    promise: Promise,
  ) {
    // Exactly one progress loop: a previous load's runnable keeps re-posting
    // itself, so it must be removed before starting a new one.
    mainHandler.removeCallbacks(progressRunnable)
    mainHandler.post {
      try {
        sharedTrackId = trackId
        PlaybackService.start(reactApplicationContext)
        val exo = PlaybackService.getPlayer(reactApplicationContext)
        Log.i("SincPlayer", "load track=$trackId hls=${isHls(uri, mimeType)} mime=$mimeType uri=${uri.take(120)}")

        val mediaMetadata =
          MediaMetadata.Builder()
            .apply {
              metadata?.getString("title")?.let { setTitle(it) }
              metadata?.getString("artist")?.let { setArtist(it) }
              metadata?.getString("artworkUrl")?.let { setArtworkUri(Uri.parse(it)) }
            }
            .build()
        val item = MediaItem.Builder().setUri(uri).setMediaMetadata(mediaMetadata).build()

        // Remote streams go through the shared disk cache (instant replays,
        // offline-friendly repeats); local files bypass it.
        val upstream = DefaultDataSource.Factory(reactApplicationContext)
        val dataSourceFactory = if (uri.startsWith("http://") || uri.startsWith("https://")) {
          CacheDataSource.Factory()
            .setCache(StreamCache.get(reactApplicationContext))
            .setUpstreamDataSourceFactory(upstream)
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)
        } else {
          upstream
        }
        val source: MediaSource =
          if (isHls(uri, mimeType)) {
            HlsMediaSource.Factory(dataSourceFactory).createMediaSource(item)
          } else {
            ProgressiveMediaSource.Factory(dataSourceFactory).createMediaSource(item)
          }
        exo.setMediaSource(source)
        exo.prepare()
        exo.playWhenReady = true
        mainHandler.post(progressRunnable)
        Log.i("SincPlayer", "load ok via PlaybackService")
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("PLAYER_LOAD_ERROR", e.message)
      }
    }
  }

  @ReactMethod
  fun addListener(eventName: String) {}

  @ReactMethod
  fun removeListeners(count: Int) {}

  @ReactMethod
  fun play(promise: Promise) {
    mainHandler.post {
      PlaybackService.playerOrNull()?.playWhenReady = true
      promise.resolve(null)
    }
  }

  @ReactMethod
  fun pause(promise: Promise) {
    mainHandler.post {
      PlaybackService.playerOrNull()?.playWhenReady = false
      promise.resolve(null)
    }
  }

  @ReactMethod
  fun seekTo(positionMs: Double, promise: Promise) {
    mainHandler.post {
      PlaybackService.playerOrNull()?.seekTo(positionMs.toLong())
      promise.resolve(null)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    // Stop the progress loop too — otherwise it wakes every 500ms forever.
    mainHandler.removeCallbacks(progressRunnable)
    mainHandler.post {
      sharedTrackId = null
      PlaybackService.stop()
      promise.resolve(null)
    }
  }

  @ReactMethod
  fun requestNotificationPermission(promise: Promise) {
    mainHandler.post {
      try {
        val activity = currentActivity
        if (activity != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          val granted =
            ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) ==
              PackageManager.PERMISSION_GRANTED
          if (!granted) {
            activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1001)
          }
        }
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("PERMISSION_ERROR", e.message)
      }
    }
  }

  /** Called from [PlaybackService] when lock-screen/notification next/prev is pressed. */
  fun emitCommand(command: String) {
    mainHandler.post {
      emit("SincPlayerCommand", Arguments.createMap().apply { putString("command", command) })
    }
  }

  /** Called from [PlaybackService] when the current track finishes. */
  fun emitCompletion(trackId: String?) {
    mainHandler.post {
      emit("SincPlayerCompletion", Arguments.createMap().apply { putString("trackId", trackId) })
    }
  }

  /** Called from [PlaybackService] when the player hits an error. */
  fun emitError(message: String?) {
    mainHandler.post { emit("SincPlayerError", Arguments.createMap().apply { putString("message", message) }) }
  }

  override fun onCatalystInstanceDestroy() {
    // Do not stop the audio — playback belongs to the service and continues in
    // the background. Just detach event routing from this dying context.
    if (PlaybackService.activeModule === this) {
      PlaybackService.activeModule = null
    }
    Log.i("SincPlayer", "onCatalystInstanceDestroy detached module (playback continues)")
    super.onCatalystInstanceDestroy()
  }

  private fun emit(event: String, data: WritableMap) {
    try {
      reactApplicationContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        ?.emit(event, data)
    } catch (_: RuntimeException) {
      // Context may already be torn down; nothing to emit to.
    }
  }
}