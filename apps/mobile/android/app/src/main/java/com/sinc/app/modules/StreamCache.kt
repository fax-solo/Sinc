package com.sinc.app.modules

import android.content.Context
import android.util.Log
import androidx.media3.database.ExoDatabaseProvider
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import java.io.File

/**
 * Shared on-disk cache for streamed audio (100 MB LRU in app cache storage).
 * Replays read bytes from disk instead of the network: repeat plays start
 * instantly, survive expired stream URLs (fully-cached songs need no
 * network at all), and cost nothing on metered connections. Local files are
 * never routed through it. Eviction is strict LRU — the cache cannot grow
 * past its budget.
 */
object StreamCache {
  private const val LOG_TAG = "SincStreamCache"
  private const val MAX_BYTES = 100L * 1024 * 1024
  private const val DIR_NAME = "sinc_stream_cache"

  @Volatile private var cache: SimpleCache? = null

  fun get(context: Context): SimpleCache {
    cache?.let { return it }
    return synchronized(this) {
      cache?.let { return it }
      val dir = File(context.cacheDir, DIR_NAME).apply { mkdirs() }
      SimpleCache(
        dir,
        LeastRecentlyUsedCacheEvictor(MAX_BYTES),
        ExoDatabaseProvider(context),
      ).also {
        cache = it
        Log.i(LOG_TAG, "cache ready at ${dir.absolutePath}")
      }
    }
  }
}
