package com.sinc.app.modules

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * JS entry point to pause / cancel an in-flight download. The actual
 * state lives in [SincDownloads]; this module just forwards the call and lets
 * the JS store react to the resulting `SincDownloadAction` events.
 */
class SincDownloadActionsModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "SincDownloadActions"

  @ReactMethod
  fun pause(jobId: String, promise: Promise) {
    SincDownloads.pause(jobId)
    promise.resolve(null)
  }

  @ReactMethod
  fun cancel(jobId: String, promise: Promise) {
    SincDownloads.cancel(jobId)
    promise.resolve(null)
  }
}