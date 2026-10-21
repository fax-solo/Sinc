package com.sinc.app.modules

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class SincPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(
      SincPlayerModule(reactContext),
      SincDownloaderModule(reactContext),
      SincCryptoModule(reactContext),
      SincNotificationsModule(reactContext),
      SincYtModule(reactContext),
      SincDownloadActionsModule(reactContext),
      SincHttpModule(reactContext),
    )

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
