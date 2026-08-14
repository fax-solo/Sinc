package com.sinc.downloads

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.app.DownloadManager

/**
 * Receives system download completion broadcasts and forwards the outcome to
 * the JS downloads service so jobs can be finalized without polling.
 */
class DownloadReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != DownloadManager.ACTION_DOWNLOAD_COMPLETE) return
    val downloadId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L)
    if (downloadId < 0) return
    val module = SincDownloadsHolder.module
        ?: return
    module.onDownloadBroadcast(downloadId)
  }
}

/** Static access to the active module instance (set by the package on create). */
object SincDownloadsHolder {
  var module: SincDownloadModule? = null
}
