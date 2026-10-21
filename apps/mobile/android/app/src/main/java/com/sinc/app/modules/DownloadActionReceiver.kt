package com.sinc.app.modules

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Routes the notification's Pause / Resume / Cancel buttons into
 * [SincDownloads]. The JS store reacts to the emitted
 * `SincDownloadAction` events (e.g. a Resume re-issues the download so the
 * yt-dlp `.part` continues where it stopped).
 */
class DownloadActionReceiver : BroadcastReceiver() {

  override fun onReceive(context: Context, intent: Intent) {
    val jobId = intent.getStringExtra(SincDownloads.EXTRA_JOB) ?: return
    when (intent.action) {
      SincDownloads.ACTION_CANCEL -> SincDownloads.cancel(jobId)
      SincDownloads.ACTION_PAUSE -> SincDownloads.pause(jobId)
      SincDownloads.ACTION_RESUME -> SincDownloads.resume(jobId)
    }
  }
}