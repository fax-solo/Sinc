package com.sinc.app.modules

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Exposes the device's physical audio outputs and lets the user pick one.
 * Selection is applied to the process-wide ExoPlayer via
 * [ExoPlayer.setPreferredAudioDevice]; `null` (deviceId < 0) restores the OS
 * default route. The module never creates players and only touches the one
 * owned by [PlaybackService].
 */
class SincAudioOutputModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val mainHandler = Handler(Looper.getMainLooper())
  private val audioManager: AudioManager? =
    reactContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

  override fun getName() = "SincAudioOutput"

  @ReactMethod
  fun getOutputs(promise: Promise) {
    mainHandler.post {
      try {
        val manager = audioManager
        val devices = manager?.getDevices(AudioManager.GET_DEVICES_OUTPUTS)?.toList().orEmpty()
        val currentId =
          PlaybackService.preferredAudioDeviceId ?: inferDefaultRoute(devices)
        val array = Arguments.createArray()
        devices
          .sortedBy { deviceTypeName(it.type) }
          .forEach { device ->
            val map = Arguments.createMap()
            map.putInt("id", device.id)
            map.putString("name", deviceTypeName(device.type))
            map.putString("productName", device.productName?.toString().orEmpty())
            map.putBoolean("isCurrent", device.id == currentId)
            array.pushMap(map)
          }
        promise.resolve(array)
      } catch (e: Exception) {
        Log.w("SincAudioOutput", "getOutputs failed: ${e.message}")
        promise.reject("GET_OUTPUTS_ERROR", e.message)
      }
    }
  }

  /**
   * Applies the chosen route to the running session. `deviceId < 0` follows the
   * operating system's default routing again.
   */
  @ReactMethod
  fun setOutput(deviceId: Int, promise: Promise) {
    mainHandler.post {
      try {
        val player = PlaybackService.playerOrNull()
        if (player == null) {
          promise.reject("NO_PLAYER", "Playback service is not running")
          return@post
        }
        if (deviceId < 0) {
          player.setPreferredAudioDevice(null)
          PlaybackService.preferredAudioDeviceId = null
          promise.resolve(true)
          return@post
        }
        val device =
          audioManager
            ?.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
            ?.firstOrNull { it.id == deviceId }
        if (device == null) {
          promise.reject("DEVICE_NOT_FOUND", "Audio output is no longer available")
          return@post
        }
        player.setPreferredAudioDevice(device)
        PlaybackService.preferredAudioDeviceId = deviceId
        promise.resolve(true)
      } catch (e: Exception) {
        Log.w("SincAudioOutput", "setOutput failed: ${e.message}")
        promise.reject("SET_OUTPUT_ERROR", e.message)
      }
    }
  }

  /**
   * Without an explicit preferred device Android follows its normal routing
   * order; approximate that precedence for the UI's "current" highlight.
   */
  private fun inferDefaultRoute(devices: List<AudioDeviceInfo>): Int? {
    val preferredTypes =
      listOf(
        AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
        AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
        AudioDeviceInfo.TYPE_WIRED_HEADSET,
        AudioDeviceInfo.TYPE_USB_HEADSET,
        AudioDeviceInfo.TYPE_USB_DEVICE,
        AudioDeviceInfo.TYPE_USB_ACCESSORY,
        AudioDeviceInfo.TYPE_HDMI,
        AudioDeviceInfo.TYPE_HDMI_ARC,
        AudioDeviceInfo.TYPE_BUILTIN_SPEAKER,
      )
    for (type in preferredTypes) {
      devices.firstOrNull { it.type == type }?.let { return it.id }
    }
    return null
  }

  private fun deviceTypeName(type: Int): String =
    when (type) {
      AudioDeviceInfo.TYPE_BLUETOOTH_A2DP -> "Bluetooth"
      AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "Bluetooth headset"
      AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> "Wired headphones"
      AudioDeviceInfo.TYPE_WIRED_HEADSET -> "Wired headset"
      AudioDeviceInfo.TYPE_USB_HEADSET -> "USB headset"
      AudioDeviceInfo.TYPE_USB_DEVICE -> "USB audio"
      AudioDeviceInfo.TYPE_USB_ACCESSORY -> "USB accessory"
      AudioDeviceInfo.TYPE_HDMI -> "HDMI"
      AudioDeviceInfo.TYPE_HDMI_ARC -> "HDMI ARC"
      AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "Phone speaker"
      AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "Earpiece"
      else -> "Audio output"
    }
}
