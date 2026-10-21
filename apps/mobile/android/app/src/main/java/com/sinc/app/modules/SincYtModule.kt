package com.sinc.app.modules

import android.os.Build
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.BufferedInputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest
import java.util.zip.ZipInputStream
import java.util.Locale
import com.sinc.app.modules.SincTrackMatch.Candidate
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.Semaphore
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONArray
import org.json.JSONObject

/**
 * On-device yt-dlp / ffmpeg module (`NativeModules.SincYt`).
 *
 * The python3/ffmpeg executables ship as APK native libraries
 * (src/main/jniLibs/<abi>/libsincpython3.so / libsincffmpeg.so) and are run
 * straight from nativeLibraryDir, which is the only app-accessible location
 * SELinux allows exec() on Android 10+. The yt-dlp zipapp, CA bundle and the
 * dlopen()-only shared-library/stdlib tree are extracted into app-private
 * storage by ensureReady() on first use (see scripts/build-mobile-media-binaries.sh).
 * The resolver mirrors the server's
 * `YtdlpResolver` (apps/server/src/lib/ytdlp.ts) so stream resolution, search
 * matching and downloads behave identically between local and server builds:
 * same flags, same matching thresholds, same preview guards.
 */
class SincYtModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  init {
    SincDownloads.attach(reactContext)
    // The probe needs the bundled ffmpeg's location (owned here) before any
    // downloader (OkHttp path) can length-check what it saved.
    SincAudioProbe.configure(ffmpegBinary(), libDir())
  }

  override fun getName(): String = "SincYt"

  private companion object {
    const val LOG_TAG = "SincYt"
    /**
     * Bump to force existing installs to rebuild their extracted engine tree
     * on next use (e.g. after the bundled lib set shrinks, so stale files
     * from older builds don't linger in app storage).
     */
    const val ASSET_REVISION = 3
  }

  /** Streams shorter than this are treated as previews and skipped. */
  private val minFullLengthMs = 45_000L
  /**
   * Retry flags for search invocations (one-shot + candidate listing). Kept
   * deliberately light: the client rotation across [fallbackClients] already
   * IS the retry strategy, and heavy per-process retries are what turned one
   * bad network day into 7-minute resolves.
   */
  // Extractor-request retries: on a flaky link a search request can fail after
  // three default attempts and yt-dlp then yields an EMPTY playlist with exit 0
  // (no output, no error) — the worst failure mode for a resolver. One extra
  // attempt (4) mostly turns those storms back into real results.
  private val searchRetryArgs = listOf("--retries", "2", "--retry-sleep", "1", "--extractor-retries", "4")
  /**
   * Retry flags for direct-URL resolves (the final hop before streaming or a
   * slow-path match). This step has no fallback after it, so it persists
   * longer through transient DNS/throttling blips.
   */
  // Same reasoning as searchRetryArgs: video-page and player-API requests
  // also fail transiently on a flaky link and default to 3 extractor retries.
  private val resolveRetryArgs = listOf("--retries", "5", "--retry-sleep", "2", "--extractor-retries", "4")
  /**
   * Per-connection stall cap for lookups. 5s was Killian Seal's beltway
   * default for desktops; on phone Wi-Fi (2.4GHz, short RTT spikes on a
   * shared AP) large innertube player responses regularly exceed 5s, which
   * makes the youtube extractor SKIP the player response — and with
   * --no-warnings set, all we saw was "Requested format is not available".
   */
  private val lookupNetArgs = listOf("--socket-timeout", "15")
  /** A single song is never longer than this; used when duration is unknown. */
  private val maxUnknownLengthMs = 20 * 60 * 1000L
  /**
   * Audius (decentralized, keyless, no bot walls) as a source tier. Two plain
   * HTTPS calls — search, then a deterministic stream URL — succeed where
   * YouTube/SoundCloud extraction is throttled, typically in ~2s total.
   */
  private val audiusAppName = "Sinc"
  private val audiusBase = "https://discoveryprovider.audius.co"
  private val queryCacheTtlMs = 10 * 60 * 1000L
  private val streamCacheTtlMs = 6 * 60 * 60 * 1000L

  private class CachedEntry<V>(val expiresAtMs: Long, val value: V)

  /**
   * Audio-URL → StreamInfo and query → StreamInfo caches. YouTube's direct
   * audio URLs live a few hours, so the short TTLs make repeat plays (and the
   * JS resolveStream hop right after resolveByQuery) hit zero yt-dlp spawns.
   */
  private val streamCache = ConcurrentHashMap<String, CachedEntry<StreamInfo>>()
  private val queryCache = ConcurrentHashMap<String, CachedEntry<StreamInfo>>()

  private fun queryCacheKey(query: String): String =
    query.trim().lowercase(Locale.ROOT).replace(Regex("\\s+"), " ")

  private fun <V> putCache(map: MutableMap<String, CachedEntry<V>>, key: String, ttlMs: Long, value: V) {
    map[key] = CachedEntry(System.currentTimeMillis() + ttlMs, value)
    scheduleUrlCachePersist()
  }

  private fun <V> lookupCache(map: MutableMap<String, CachedEntry<V>>, key: String): V? {
    val entry = map[key] ?: return null
    if (entry.expiresAtMs < System.currentTimeMillis()) {
      map.remove(key)
      return null
    }
    return entry.value
  }

  // -- Resolve-cache persistence -------------------------------------------
  //
  // Both caches are in-memory only, so every app restart threw away valid
  // still-unexpired googlevideo URLs (~6h lifetime) and restart-play paid a
  // full yt-dlp search again. A JSON snapshot in cacheDir restores them on
  // first engine use; a dead URL that survived persistence is evictable via
  // {@link evictStream} from the JS stale-retry path.

  private val urlCacheFile: File by lazy {
    File(reactApplicationContext.cacheDir, "sinc-yt-url-cache.json")
  }
  @Volatile private var urlCacheLoaded = false
  private val urlCacheDirty = AtomicBoolean(false)
  private val urlCachePersistExecutor: ScheduledExecutorService =
    Executors.newSingleThreadScheduledExecutor { r ->
      Thread(r, "sinc-url-cache").apply { isDaemon = true }
    }
  /** Newest entries kept per map when serializing. */
  private val urlCacheMaxEntries = 200

  private fun scheduleUrlCachePersist() {
    if (!urlCacheDirty.compareAndSet(false, true)) return
    urlCachePersistExecutor.schedule({
      try {
        urlCacheDirty.set(false)
        writeUrlCache()
      } catch (e: Exception) {
        Log.w(LOG_TAG, "url cache persist failed: ${e.message}")
      }
    }, 5, TimeUnit.SECONDS)
  }

  private fun writeUrlCache() {
    val now = System.currentTimeMillis()
    fun serialize(map: ConcurrentHashMap<String, CachedEntry<StreamInfo>>): JSONArray {
      val arr = JSONArray()
      map.entries
        .filter { it.value.expiresAtMs > now }
        .sortedByDescending { it.value.expiresAtMs }
        .take(urlCacheMaxEntries)
        .forEach { (key, entry) ->
          val v = entry.value
          arr.put(
            JSONObject()
              .put("k", key)
              .put("e", entry.expiresAtMs)
              .put("u", v.uri)
              .put("x", v.ext)
              .put("d", v.durationMs)
          )
        }
      return arr
    }
    val file = urlCacheFile
    val root = JSONObject()
      .put("v", 1)
      .put("queries", serialize(queryCache))
      .put("streams", serialize(streamCache))
    val tmp = File(file.parentFile, "${file.name}.tmp")
    tmp.writeText(root.toString())
    if (!tmp.renameTo(file)) {
      file.writeText(root.toString())
      tmp.delete()
    }
  }

  private fun loadUrlCache() {
    if (urlCacheLoaded) return
    urlCacheLoaded = true
    val file = urlCacheFile
    if (!file.isFile) return
    try {
      val root = JSONObject(file.readText())
      val now = System.currentTimeMillis()
      fun hydrate(json: JSONArray, map: ConcurrentHashMap<String, CachedEntry<StreamInfo>>) {
        for (i in 0 until json.length()) {
          val row = json.optJSONObject(i) ?: continue
          val expiresAtMs = row.optLong("e", 0L)
          if (expiresAtMs <= now) continue
          val uri = row.optString("u", "")
          val key = row.optString("k", "")
          if (uri.isEmpty() || key.isEmpty()) continue
          map[key] = CachedEntry(
            expiresAtMs,
            StreamInfo(uri, row.optString("x", "mp4").ifBlank { "mp4" }, row.optLong("d", 0L)),
          )
        }
      }
      hydrate(root.optJSONArray("queries") ?: JSONArray(), queryCache)
      hydrate(root.optJSONArray("streams") ?: JSONArray(), streamCache)
      Log.d(LOG_TAG, "url cache restored: ${queryCache.size} queries, ${streamCache.size} streams")
    } catch (e: Exception) {
      Log.w(LOG_TAG, "url cache load failed: ${e.message}")
    }
  }

  /** Drops every cache entry pointing at `url` (dead/revoked stream handle). */
  @ReactMethod
  fun evictStream(url: String, promise: Promise) {
    val trimmed = url.trim()
    var removed = 0
    if (trimmed.isNotEmpty()) {
      val targets: List<ConcurrentHashMap<String, CachedEntry<StreamInfo>>> =
        listOf(streamCache, queryCache)
      for (target in targets) {
        val iterator = target.entries.iterator()
        while (iterator.hasNext()) {
          val holder: CachedEntry<StreamInfo> = iterator.next().value
          if (holder.value.uri == trimmed) {
            iterator.remove()
            removed += 1
          }
        }
      }
    }
    if (removed > 0) scheduleUrlCachePersist()
    Log.d(LOG_TAG, "evictStream removed=$removed for '${trimmed.take(60)}…'")
    promise.resolve(removed > 0)
  }

  private val executor: ExecutorService = Executors.newFixedThreadPool(2)
  /**
   * Dedicated pool for download jobs. Previously downloads ran on the shared
   * lookup executor: two long transfers (resolve + extract on a weak link can
   * take tens of minutes) occupied both threads and starved every playback
   * lookup queued behind them for the whole duration.
   */
  private val downloadExecutor: ExecutorService = Executors.newFixedThreadPool(2)
  /**
   * Dedicated pool for racing client attempts. Twelve threads: each lookup
   * race submits up to six client attempts that BLOCK inside run()'s
   * lookupGate.acquire(), and two concurrent downloads race at once (playback
   * and a download resolve overlap freely now that the permits raised to
   * five — before, three permits serialized every race into consecutive
   * rounds of spawns, which is what made cold resolves take minutes).
   */
  private val raceExecutor: ExecutorService = Executors.newFixedThreadPool(12)
  /**
   * Audius probes run out-of-band so yt searches never trail behind them.
   * Three threads: playback + two download resolves can all probe at once.
   * Tasks do plain HTTPS (no lookup gate), so no nested-gate deadlock risk.
   */
  private val audiusExecutor: ExecutorService = Executors.newFixedThreadPool(3) { r ->
    Thread(r, "sinc-audius").apply { isDaemon = true }
  }

  private val lookupGate = Semaphore(5)
  private val downloadGate = Semaphore(2)
  private val ready = AtomicBoolean(false)
  private val extractionFailed = AtomicBoolean(false)

  /**
   * jobId → the yt-dlp target a download resolved to. Set on first resolve,
   * reused when a paused/failed run resumes so the `.part` continues against
   * the SAME source (a fresh resolve could pick a different upload), and
   * dropped on success. Never persisted: only active jobs reference it.
   */
  private val resolvedJobTargets = ConcurrentHashMap<String, String>()

  private fun abiSuffix(): String? = when (Build.SUPPORTED_ABIS.firstOrNull()) {
    "arm64-v8a" -> "arm64-v8a"
    "armeabi-v7a" -> "arm64-v8a"
    "x86_64" -> "x86_64"
    else -> null
  }

  private fun abiDir(): File = File(reactApplicationContext.filesDir, "sinc_bin/yt")

  /**
   * Directory the package manager extracts the APK's `lib/<abi>/` files to.
   * On Android 10+ (targetSdk>=29) SELinux forbids an app from exec()'ing
   * files in its own data dir (`execute_no_trans` removed for app_data_file),
   * but DOES allow exec() from the nativeLibraryDir (apk_data_file, read-only,
   * system-owned). The python3/ffmpeg executables are shipped as native libs
   * (libsincpython3.so / libsincffmpeg.so via src/main/jniLibs) precisely so
   * the URLs and libs dir below stay dlopen()-able from app data while the two
   * tiny ELF launchers remain exec()-able.
   */
  private fun nativeBinDir(): File = File(reactApplicationContext.applicationInfo.nativeLibraryDir)

  private fun pythonBinary(): File = File(nativeBinDir(), "libsincpython3.so")

  private fun ytdlpZipapp(): File = File(abiDir(), "yt-dlp.zipapp")

  private fun ffmpegBinary(): File = File(nativeBinDir(), "libsincffmpeg.so")

  private fun libDir(): File = File(abiDir(), "lib")

  private fun sslDir(): File = File(abiDir(), "ssl")

  /**
   * QuickJS-ng shipped as a native lib: YouTube's n/signature challenges are
   * solved out-of-process by yt-dlp's EJS provider, which needs a runtime
   * executable. Without one every client's format list degraded to
   * storyboards ("Requested format is not available") because the challenge
   * answers were unknowable on-device — while identical desktop runs
   * succeeded thanks to an installed Deno. `--no-js-runtimes … quickjs:<path>`
   * is yt-dlp's own switch for a lower-priority runtime at an explicit path.
   */
  private fun jsRuntimeArgs(): List<String> {
    val qjs = File(nativeBinDir(), "libsincqjs.so")
    if (!qjs.exists()) return emptyList()
    return listOf("--no-js-runtimes", "--js-runtimes", "quickjs:${qjs.absolutePath}")
  }

  private fun sslCertFile(): File = File(sslDir(), "cert.pem")

  @ReactMethod
  fun resolveStream(url: String, promise: Promise) {
    executor.execute {
      try {
        if (!ensureReady()) throw IllegalStateException("The on-device yt-dlp module is unavailable")
        val stream = resolve(url) ?: throw IllegalStateException("No playable stream was found")
        promise.resolve(
          Arguments.createMap().apply {
            putString("uri", stream.uri)
            putString("ext", stream.ext)
            putDouble("durationMs", stream.durationMs.toDouble())
          }
        )
      } catch (e: Exception) {
        Log.e(LOG_TAG, "resolve failed: ${e.message}")
        promise.reject("YT_RESOLVE_ERROR", e.message)
      }
    }
  }

  @ReactMethod
  fun resolveByQuery(artist: String, title: String, durationMs: Double, promise: Promise) {
    executor.execute {
      try {
        if (!ensureReady()) throw IllegalStateException("The on-device yt-dlp module is unavailable")
        val url = resolveByQueryInternal(artist, title, if (durationMs > 0) Math.round(durationMs) else null)
        promise.resolve(url)
      } catch (e: Exception) {
        Log.e(LOG_TAG, "resolveByQuery failed: ${e.message}")
        promise.reject("YT_RESOLVE_ERROR", e.message)
      }
    }
  }

  /**
   * Warms the query/stream caches for a track that is about to play, so hitting
   * play (or skipping to it) resolves instantly from cache instead of paying a
   * fresh yt-dlp search. Resolves to whether the stream is now cached.
   */
  @ReactMethod
  fun prefetch(artist: String, title: String, durationMs: Double, promise: Promise) {
    executor.execute {
      try {
        if (!ensureReady()) {
          promise.resolve(false)
          return@execute
        }
        val query = listOf(artist.trim(), searchTitle(title).trim())
          .filter { it.isNotEmpty() }
          .joinToString(" - ")
          .trim()
        if (query.isEmpty()) {
          promise.resolve(false)
          return@execute
        }
        val expected = if (durationMs > 0) Math.round(durationMs) else null
        val started = System.currentTimeMillis()
        // Prefetch stays light on purpose: the cheap Audius tier plus a
        // first-hit-wins race. No slow candidate loop, no deep fallback —
        // prefetch must never burn minutes of CPU/network in the background
        // for a track the user may skip past.
        val cacheKey = queryCacheKey(query)
        val audius = resolveAudius(query, artist, title, expected)
        val stream = if (audius != null) {
          putCache(queryCache, cacheKey, queryCacheTtlMs, audius)
          putCache(streamCache, audius.uri, streamCacheTtlMs, audius)
          audius
        } else {
          raceClients(
            "prefetch",
            query,
            listOf(youtubeClient) + fallbackClients,
            60_000,
          ) { client ->
            when (
              val out = resolveSearchOneShotWithClient(query, artist, title, expected, client)
            ) {
              is OneShotOutcome.Hit -> out.info
              else -> null
            }
          }?.second
        }
        promise.resolve(stream != null)
        Log.d(
          LOG_TAG,
          "prefetch ${if (stream != null) "hit" else "miss"} in " +
            "${System.currentTimeMillis() - started}ms for '$query'"
        )
      } catch (e: Exception) {
        Log.w(LOG_TAG, "prefetch failed for '$artist - $title': ${e.message}")
        promise.resolve(false)
      }
    }
  }

  @ReactMethod
  fun download(
    jobId: String,
    query: String,
    destinationFileName: String,
    expectedDurationMs: Double,
    mediaUrl: String?,
    title: String?,
    resumePart: Boolean,
    artist: String?,
    album: String?,
    artworkUrl: String?,
    publicFileName: String?,
    promise: Promise,
  ) {
    downloadExecutor.execute {
      try {
        Log.i(LOG_TAG, "download entry jobId=$jobId mediaUrl=${mediaUrl?.take(60) ?: "<none>"} resume=$resumePart")
        if (!ensureReady()) throw IllegalStateException("The on-device yt-dlp module is unavailable")
        val expectedMs = if (expectedDurationMs > 0) expectedDurationMs.toLong() else null
        // `mediaUrl` is a direct URL when the catalog knew one; otherwise `query`
        // is a bare "Artist - Title" search string that must be resolved first.
        val rawTarget = if (mediaUrl.isNullOrBlank()) query else mediaUrl
        if (rawTarget.isBlank()) throw IllegalStateException("No source to download")
        var targetUrl = if (mediaUrl.isNullOrBlank()) {
          // Downloads resolve in strict mode: no cover/alteration fall-through.
          // A paused run continues from the SAME resolved source (re-resolving
          // could pick a different upload for the remainder of the transfer).
          val cached = if (resumePart) resolvedJobTargets[jobId] else null
          val resolved = cached ?: run {
            Log.i(LOG_TAG, "download resolving strict target for '$rawTarget'")
            val found = resolveForDownload(rawTarget, expectedMs, strict = true)
            Log.i(LOG_TAG, "download resolved '$rawTarget' -> ${found.take(80)}")
            found
          }
          resolvedJobTargets[jobId] = resolved
          resolved
        } else {
          rawTarget
        }
        val outDir = File(reactApplicationContext.filesDir, "sinc_yt")
        outDir.mkdirs()
        Log.d(LOG_TAG, "download start jobId=$jobId resumePart=$resumePart target=$targetUrl")
        // Tell the JS store the transfer began — the row flips from
        // "resolving" to a ticking bar NOW, not at the first stderr % line.
        SincDownloads.postTransferStarted(jobId)
        val result = try {
          downloadInternal(
            targetUrl,
            File(outDir, destinationFileName),
            jobId,
            title,
            artist,
            album,
            artworkUrl,
            resumePart,
          )
        } catch (first: Exception) {
          // A resolved-stream URL (googlevideo) lives only a few hours; a
          // catalog entry can easily outlive it. Re-resolve by search once —
          // the module already knows title/artist — instead of surfacing a
          // dead-URL failure to the user.
          val staleUrl = targetUrl.contains("googlevideo.com") || isDirectAudioFile(targetUrl)
          val canRecover = !mediaUrl.isNullOrBlank() &&
            !artist.isNullOrBlank() && !title.isNullOrBlank() &&
            (staleUrl || first.message?.contains("403") == true ||
              first.message?.contains("404") == true)
          val reResolved = if (!canRecover) null else try {
            resolveForDownload(
              "$artist - ${searchTitle(title.orEmpty())}",
              expectedMs,
              strict = true,
            )
          } catch (_: Exception) {
            null
          }
          if (reResolved == null || reResolved == targetUrl) throw first
          Log.w(LOG_TAG, "download re-redirected after stale target ($first): $reResolved")
          targetUrl = reResolved
          resolvedJobTargets[jobId] = reResolved
          downloadInternal(
            targetUrl,
            File(outDir, destinationFileName),
            jobId,
            title,
            artist,
            album,
            artworkUrl,
            resumePart,
          )
        }
        // Success: the job is done, drop the cached target. Failures and
        // pauses KEEP it so a resume continues the same .part against the
        // same source instead of silently switching uploads.
        resolvedJobTargets.remove(jobId)
        // Final length guard on the measured file: this is what stops
        // hour-long loops and compilations from being saved as 4-minute songs.
        val finalMs = result.durationMs
        val tooShort = finalMs in 1 until minFullLengthMs
        val tooFarFromExpected = expectedMs != null && expectedMs > 0 && finalMs > 0L &&
          (finalMs < (expectedMs * 0.5).toLong() || finalMs > (expectedMs * 2))
        val overlongUnknown =
          (expectedMs == null || expectedMs <= 0) && finalMs > maxUnknownLengthMs
        if (tooShort || tooFarFromExpected || overlongUnknown) {
          result.file.delete()
          throw IllegalStateException(
            "Downloaded file is too short, too long, or doesn't match the song's length"
          )
        }
        // Tag the file so other music players show title/artist/album/artwork,
        // and publish a copy to the public Music/Sinc collection. The display
        // name keeps its base but adopts the ACTUAL container's extension — a
        // webm/m4a saved as `.mp3` showed no metadata in other players.
        val displayName =
          if (!publicFileName.isNullOrBlank()) {
            publicFileName.replace(Regex("\\.[^.]+$"), "") +
              "." + result.file.extension.lowercase(Locale.ROOT)
          } else {
            result.file.name
          }
        SincDownloads.publishAudioFile(
          reactApplicationContext,
          reactApplicationContext.contentResolver,
          result.file,
          displayName,
          title,
          artist,
          album,
          result.mimeType,
        )
        Log.d(
          LOG_TAG,
          "download done jobId=$jobId out=${result.file.name} " +
            "duration=${result.durationMs}ms mime=${result.mimeType}"
        )
        promise.resolve(
          Arguments.createMap().apply {
            putString("localUri", "file://${result.file.absolutePath}")
            putDouble(
              "durationMs",
              if (result.durationMs > 0L) result.durationMs.toDouble()
              else if (expectedMs != null) expectedMs.toDouble()
              else 0.0
            )
            putString("mimeType", result.mimeType)
            // The published Music/Sinc copy may carry a different extension
            // than publicFileName (m4a/webm container). Removal must target
            // THAT name, so hand it back to the store to remember.
            putString(
              "publishedName",
              if (publicFileName.isNullOrBlank()) result.file.name else displayName
            )
          }
        )
      } catch (e: Exception) {
        Log.e(LOG_TAG, "download failed jobId=$jobId: ${e.message}", e)
        promise.reject("YT_DOWNLOAD_ERROR", e.message)
      }
    }
  }

  /**
   * Deletes a finished download from the app-private `sinc_yt` dir (the
   * `SincDownloader` module only knows its own `sinc_downloads` dir, so JS
   * routes yt-file cleanup here). Also deletes the published Music/Sinc copy
   * by its public name. Best-effort: never rejects. The name is confined to
   * the output dir so a crafted localUri cannot traverse.
   */
  @ReactMethod
  fun remove(fileName: String, publicFileName: String?, promise: Promise) {
    try {
      val outDir = File(reactApplicationContext.filesDir, "sinc_yt")
      val target = File(outDir, fileName)
      if (target.canonicalPath.startsWith(outDir.canonicalPath + File.separator)) {
        target.delete()
        // Drop stale partials for the same stem, if any linger.
        outDir.listFiles()
          ?.filter { it.name.startsWith(fileName) && (it.name.endsWith(".part") || it.name.endsWith(".ytdl")) }
          ?.forEach { it.delete() }
      }
      SincDownloads.removePublished(publicFileName)
      promise.resolve(null)
    } catch (e: Exception) {
      Log.w(LOG_TAG, "remove failed for $fileName: ${e.message}")
      promise.resolve(null)
    }
  }

  // ---------------------------------------------------------------------
  // Extraction + process runner
  // ---------------------------------------------------------------------

  /**
   * The executable launchers (libsincpython3.so / libsincffmpeg.so) ship as
   * APK native libraries in `lib/<abi>/` and are extracted read-only by the
   * package manager (they cannot run from app data on Android 10+). The yt-dlp
   * zipapp, the CA bundle and the shared-library/stdlib tree are copied out of
   * the APK assets into app storage; those are dlopen()-ed/read by python, never
   * execve()-d, so app-data file placement is fine for them. Blocks until done
   * (or failed); cheap after first run. yt-dlp is launched as
   * `python3 yt-dlp.zipapp ...`.
   */
  private fun ensureReady(): Boolean {
    if (ready.get()) return true
    if (extractionFailed.get()) return false
    synchronized(this) {
      if (ready.get()) return true
      if (extractionFailed.get()) return false
      try {
        val abi = abiSuffix() ?: return finishExtraction(false)
        val started = System.currentTimeMillis()
        if (!pythonBinary().isFile) {
          throw IllegalStateException("missing native lib: ${pythonBinary().absolutePath}")
        }
        val marker = assetMarker(abi)
        val markerFile = File(abiDir(), "extract.marker")
        val extracted = markerFile.exists() && markerFile.readText() == marker
        if (!extracted) {
          abiDir().apply { mkdirs() }
          extract("bin/ytdlp.zipapp", ytdlpZipapp())
          runCatching { extract("bin/ca-cert.pem", sslCertFile()) }
          // Wipe a previous partial/incomplete stdlib tree before unpacking so a
          // stale broken layout can never shadow the fresh copy below.
          libDir().deleteRecursively()
          extractLibs(abi)
          markerFile.writeText(marker)
          val pyEntryCount = File(abiDir(), "lib/python3.14").listFiles()?.size ?: -1
          Log.d(LOG_TAG, "extraction done in ${System.currentTimeMillis() - started}ms; python=$pyEntryCount")
        } else {
          Log.d(LOG_TAG, "engine ready (extracted tree verified, marker match)")
        }
        return finishExtraction(true)
      } catch (e: Exception) {
        Log.e(LOG_TAG, "extraction failed", e)
        return finishExtraction(false)
      }
    }
  }

  /**
   * Stable digest over the bundled python asset set so the extracted tree is
   * reused across launches and only re-unpacked when the assets change (new
   * APK build). Every rebuild that touches bin/ assets invalidates the marker.
   */
  private fun assetMarker(abi: String): String {
    return try {
      val assets = reactApplicationContext.assets
      val digest = MessageDigest.getInstance("SHA-256")
      // Revision salt: bumping ASSET_REVISION invalidates every install's
      // marker once, rebuilding the extracted tree from the current assets.
      digest.update("sinc-assets-r$ASSET_REVISION".toByteArray())
      for (name in listOf("bin/libs/$abi/stdlib_extras.zip", "bin/ytdlp.zipapp", "bin/ca-cert.pem")) {
        digest.update(assets.open(name).use { it.readBytes() })
      }
      digest.digest().joinToString("") { "%02x".format(it) }
    } catch (e: Exception) {
      Log.w(LOG_TAG, "assetMarker failed: ${e.message}")
      ""
    }
  }

  /**
   * Recursively copies the ABI-matching python stdlib and shared libraries out
   * of `bin/libs/<abi>/` (a directory tree: a python3.14 subfolder plus shared
   * library `.so` files) into libDir()/ so the python3 launcher's argv0-relative
   * lookup finds `lib/python3.14/os.py` and the linker finds all DT_NEEDED
   * shared libraries. Underscore directories (zipfile/_path, ...) are dropped by
   * the Android asset-merge, so they arrive pre-zipped as stdlib_extras.zip and
   * are inflated here.
   */
  private fun extractLibs(abi: String) {
    val root = "bin/libs/$abi"
    val entries = reactApplicationContext.assets.list(root) ?: return
    for (name in entries) {
      if (name == "stdlib_extras.zip") continue
      copyAssetTree("$root/$name", File(libDir(), name))
    }
    extractStdlibExtras(abi)
  }

  /**
   * Inflates `bin/libs/<abi>/stdlib_extras.zip` into libDir()/. Entries are
   * stored relative to the zip's parent dir (the asset `bin/libs/<abi>/`, which
   * is copied 1:1 to libDir()/), so each entry's path maps directly onto the
   * stdlib tree.
   */
  private fun extractStdlibExtras(abi: String) {
    val assetPath = "bin/libs/$abi/stdlib_extras.zip"
    val exists = try {
      reactApplicationContext.assets.open(assetPath).use { true }
    } catch (e: Exception) {
      false
    }
    if (!exists) {
      Log.d(LOG_TAG, "no stdlib_extras.zip asset (${abi})")
      return
    }
    var inflated = 0
    reactApplicationContext.assets.open(assetPath).use { input ->
      ZipInputStream(BufferedInputStream(input)).use { zip ->
        while (true) {
          val entry = zip.nextEntry ?: break
          val name = entry.name
          if (name.isBlank() || name.startsWith("/") || name.split('/').any { it == ".." }) {
            Log.w(LOG_TAG, "skipping unsafe stdlib_extras entry: $name")
          } else if (entry.isDirectory) {
            File(libDir(), name).mkdirs()
          } else {
            val target = File(libDir(), name)
            target.parentFile?.mkdirs()
            target.outputStream().use { out -> zip.copyTo(out) }
            inflated++
          }
          zip.closeEntry()
        }
      }
    }
    Log.d(LOG_TAG, "inflated $inflated files from stdlib_extras.zip")
  }

  private fun copyAssetTree(assetPath: String, target: File) {
    val isDir = isFileAsset(assetPath).not()
    if (isDir) {
      target.mkdirs()
      val children = reactApplicationContext.assets.list(assetPath.trimEnd('/')) ?: return
      for (child in children) {
        copyAssetTree("$assetPath/$child", File(target, child))
      }
    } else {
      extract(assetPath, target)
    }
  }

  private fun isFileAsset(assetPath: String): Boolean =
    try {
      reactApplicationContext.assets.open(assetPath).use { true }
    } catch (e: Exception) {
      false
    }

  private fun extract(assetPath: String, target: File) {
    target.parentFile?.mkdirs()
    reactApplicationContext.assets.open(assetPath).use { input ->
      target.outputStream().use { output -> input.copyTo(output) }
    }
    if (!target.setExecutable(true, false)) {
      throw IllegalStateException("Failed to make binary executable: ${target.name}")
    }
  }

  private fun finishExtraction(ok: Boolean): Boolean {
    ready.set(ok)
    if (ok) {
      extractionFailed.set(false)
      // Restore persisted resolve caches as soon as the engine is usable so a
      // replayed song starts from a cached URL instead of a fresh search.
      loadUrlCache()
    } else {
      extractionFailed.set(true)
    }
    return ok
  }

  private data class RunResult(val stdout: String, val stderr: String, val code: Int)

  private fun run(
    args: List<String>,
    timeoutMs: Long,
    gate: Semaphore,
    jobId: String? = null,
    onStderrLine: ((String) -> Unit)? = null,
  ): RunResult {
    gate.acquire()
    // Visible to the interrupt handler below so a cancelled race attempt can
    // never leave an orphaned python process burning CPU/battery.
    var process: Process? = null
    return try {
      val executable = pythonBinary()
      val zipapp = ytdlpZipapp()
      // -4 forces IPv4: the bundled Termux Python has no Happy Eyeballs, so on
      // networks with broken IPv6 egress every connection stalls or dies.
      // (This mirrors Seal's default invocation, which works where ours didn't.)
      val pb = ProcessBuilder(
        listOf(executable.absolutePath, zipapp.absolutePath, "-4") + jsRuntimeArgs() + args
      )
      pb.redirectErrorStream(false)
      pb.environment().apply {
        put("LD_LIBRARY_PATH", libDir().absolutePath)
        put("PATH", "${abiDir().absolutePath}:/system/bin:/system/xbin")
        put("PYTHONDONTWRITEBYTECODE", "1")
        // The interpreter now lives in the APK native-lib dir (far from the
        // stdlib), so tell python where its prefix tree was unpacked.
        put("PYTHONHOME", abiDir().absolutePath)
        put("SSL_CERT_FILE", sslCertFile().absolutePath)
        put("SSL_CERT_DIR", sslDir().absolutePath)
      }
      process = pb.start()
      if (jobId != null) {
        SincDownloads.attachKill(jobId) { process?.destroyForcibly() }
        // The job may have been cancelled while queued behind the gate.
        if (!SincDownloads.isActive(jobId)) process?.destroyForcibly()
      }
      val proc = process!!
      val stdout = ProcessStreamReader(proc.inputStream)
      val stderr = ProcessStreamReader(proc.errorStream, onStderrLine)
      val finished = proc.waitFor(timeoutMs, TimeUnit.MILLISECONDS)
      if (!finished) {
        proc.destroyForcibly()
        throw IllegalStateException("yt-dlp timed out")
      }
      val result = RunResult(stdout.read(), stderr.read(), proc.exitValue())
      if (result.code != 0) {
        Log.w(LOG_TAG, "yt-dlp exit ${result.code}: ${result.stderr.trim().take(3000)}")
        if (isNetworkDeadStderr(result.stderr)) {
          lastNetworkDeadAtMs = System.currentTimeMillis()
        }
      } else if (result.stdout.isBlank()) {
        // Exit 0 with no output: a search request failed and yt-dlp turned it
        // into a suppressed warning (empty playlist -> clean exit). Without
        // this the run is completely invisible in logcat and the caller only
        // sees "no formats" with no reason. Surface the stderr tail's cause.
        val tail = result.stderr.trim()
        if (isNetworkDeadStderr(tail)) {
          lastNetworkDeadAtMs = System.currentTimeMillis()
        }
        Log.w(LOG_TAG, "yt-dlp exit 0 with empty stdout: ${tail.take(1200).ifBlank { "(stderr empty too)" }}")
      }
      result
    } catch (e: InterruptedException) {
      // A losing parallel attempt being cancelled: kill its process first.
      try {
        process?.destroyForcibly()
      } catch (_: Exception) {
      }
      Thread.currentThread().interrupt()
      throw IllegalStateException("yt-dlp interrupted")
    } finally {
      gate.release()
    }
  }

  /** Reads a process stream off the caller's thread (stderr can be large). */
  private class ProcessStreamReader(
    stream: java.io.InputStream,
    private val onLine: ((String) -> Unit)? = null,
  ) {
    private val buffer = StringBuilder()
    private val thread = Thread {
      // try/finally instead of `use`: when the yt-dlp process is destroyed
      // underneath a blocked readLine (timeout, cancel, process death), the
      // pipe close surfaces HERE as InterruptedIOException ("read interrupted
      // by close() on another thread"). Uncaught, that exception kills the
      // whole app process — the reader thread's crash handler is the global
      // one. Treated as end-of-stream, it is completely normal.
      val reader = stream.bufferedReader()
      try {
        var line = reader.readLine()
        while (line != null) {
          buffer.append(line).append('\n')
          onLine?.invoke(line)
          line = reader.readLine()
        }
      } catch (_: java.io.IOException) {
        // Pipe closed under us: end-of-stream.
      } catch (_: RuntimeException) {
        // Reader raced with teardown.
      } finally {
        try {
          reader.close()
        } catch (_: java.io.IOException) {
        }
      }
    }.also { it.isDaemon = true }

    init {
      thread.start()
    }

    fun read(): String = try {
      thread.join(5000)
      buffer.toString()
    } catch (e: InterruptedException) {
      Thread.currentThread().interrupt()
      buffer.toString()
    }
  }

  private fun youtubeClientArgs(urlOrQuery: String, client: String = youtubeClient): List<String> =
    if (
      client.isNotBlank() &&
      Regex("youtube|ytsearch|googlevideo", RegexOption.IGNORE_CASE).containsMatchIn(urlOrQuery)
    ) {
      listOf("--extractor-args", "youtube:player_client=$client")
    } else {
      emptyList()
    }

  /**
   * YouTube client to ask for stream formats with. Blank means "no
   * `--extractor-args`": yt-dlp's own default negotiation, which works where
   * forced clients don't (several forced clients now need PO tokens / sign-in
   * on many networks and fail with "Requested format is not available").
   * Individual videos occasionally expose no formats for one client, so
   * lookups retry across the fallback list before giving up. `web`, `tv`,
   * `web_safari` and `ios` are deliberately absent: they require PO tokens on
   * most networks as of 2026.
   */
  private var youtubeClient = ""

  /** Alternate YouTube clients tried when the first one finds no formats. */
  private val fallbackClients =
    listOf("android", "web_embedded", "tv_embedded", "mweb", "android_testsuite")

  // ---------------------------------------------------------------------
  // yt-dlp operations (mirror server ytdlp.ts)
  // ---------------------------------------------------------------------

  private data class StreamInfo(val uri: String, val ext: String, val durationMs: Long)

  /**
   * Container is ACTUALLY audio-only. An "mp4" ext printed by a yt extraction
   * is itag 18/22-style MUXED video (the download then ships a video file —
   * exactly how `song.mp4` files that other players refuse ended up in Music),
   * so it is excluded here. Playback may still use it via the muxed fallback;
   * only downloads must not.
   */
  private fun isAudioContainer(ext: String?): Boolean {
    val e = ext?.lowercase(Locale.ROOT)?.trim().orEmpty()
    return e in setOf("m4a", "m4b", "mp3", "opus", "ogg", "oga", "webm", "flac", "wav", "aac")
  }

  /**
   * Runs one attempt per client concurrently; the first non-null result wins
   * and the losers are cancelled (their yt-dlp processes are destroyed via
   * thread interruption — see run()). Sequential client rotation turned one
   * bad-network day into 7-minute resolves; racing keeps it to the cost of the
   * single fastest success.
   */
  private fun <T> raceClients(
    label: String,
    key: String,
    clients: List<String>,
    budgetMs: Long,
    attempt: (client: String) -> T?,
  ): Pair<String, T>? {
    if (clients.isEmpty()) return null
    if (clients.size == 1) {
      val value = try {
        attempt(clients[0])
      } catch (_: Exception) {
        null
      }
      return if (value != null) clients[0] to value else null
    }
    val started = System.currentTimeMillis()
    val futures = clients.map { client ->
      raceExecutor.submit<Pair<String, T>?> {
        val value = try {
          attempt(client)
        } catch (_: Exception) {
          null
        }
        if (value != null) client to value else null
      }
    }
    try {
      val deadline = started + budgetMs
      while (true) {
        for (future in futures) {
          if (!future.isDone) continue
          val won = try {
            future.get()
          } catch (_: Exception) {
            null
          }
          if (won != null) {
            futures.forEach { if (!it.isDone) it.cancel(true) }
            Log.d(
              LOG_TAG,
              "$label race won by ${won.first.ifBlank { "default" }} in " +
                "${System.currentTimeMillis() - started}ms for $key"
            )
            return won
          }
        }
        if (futures.all { it.isDone }) return null
        if (System.currentTimeMillis() >= deadline) {
          futures.forEach { if (!it.isDone) it.cancel(true) }
          Log.w(LOG_TAG, "$label race timed out for $key")
          return null
        }
        try {
          Thread.sleep(250)
        } catch (_: InterruptedException) {
          Thread.currentThread().interrupt()
          futures.forEach { if (!it.isDone) it.cancel(true) }
          return null
        }
      }
    } finally {
      futures.forEach { if (!it.isDone) it.cancel(true) }
    }
  }

  private fun resolve(urlOrQuery: String, audioOnly: Boolean = false): StreamInfo? {
    val key = urlOrQuery.trim()
    val cached = lookupCache(streamCache, key)
    if (cached != null) {
      if (!audioOnly || isAudioContainer(cached.ext)) return cached
      // A stale playback pick (muxed itag 18/22 mp4) must not satisfy an
      // audio-only request: drop it and re-extract from the clients that do
      // carry audio-only formats (it stays parked as a fallback below).
    }
    val started = System.currentTimeMillis()
    val won = raceClients(
      if (audioOnly) "resolve-audio" else "resolve",
      key,
      listOf(youtubeClient) + fallbackClients,
      if (audioOnly) 45_000 else 90_000,
    ) { client ->
      resolveWithClient(urlOrQuery, client)
        ?.takeIf { !audioOnly || isAudioContainer(it.ext) }
    }
    if (won != null) {
      putCache(streamCache, key, streamCacheTtlMs, won.second)
      Log.d(
        LOG_TAG,
        "${
          if (audioOnly) "resolve-audio" else "resolve"
        } ok client=${won.first.ifBlank { "default" }} in ${
          System.currentTimeMillis() - started
        }ms ext=${won.second.ext} duration=${won.second.durationMs}ms"
      )
      return won.second
    }
    if (audioOnly && cached != null) {
      // No client offered an audio-only format this session (rare): accept
      // the muxed stream rather than failing — the downloader still converts
      // it (the mp4 branch runs retag → mp3 → m4a before giving up).
      Log.w(LOG_TAG, "resolve-audio fell back to the cached muxed stream for $key")
      return cached
    }
    Log.w(LOG_TAG, "resolve found no formats for $key")
    return null
  }

  /**
   * Runs once per process: a verbose yt-dlp extraction of a lookup target
   * whose formats just failed on every client. `-v` surfaces the request-level
   * reason (SABR-only sessions, skipped player responses, throttling, TLS)
   * that masked pre-fix failures looked like a bare "Requested format is not
   * available". The output lands in logcat under SincYtDiag.
   */
  @Volatile
  private var lookupDiagDone = false

  private fun runLookupDiagnosticOnce(url: String) {
    if (lookupDiagDone) return
    lookupDiagDone = true
    try {
      val started = System.currentTimeMillis()
      val completed = run(
        listOf("--no-playlist", "-f", "bestaudio/best", "--print", "DIAG_END", url),
        75_000,
        lookupGate,
      )
      Log.i(
        LOG_TAG,
        "SincYtDiag lookup diagnostic code=${completed.code} url=$url " +
          "in ${System.currentTimeMillis() - started}ms\n" +
          completed.stderr.trim().take(2500).ifBlank { "(no stderr)" },
      )
    } catch (e: Exception) {
      Log.w(LOG_TAG, "SincYtDiag lookup diagnostic failed: ${e.message}")
    }
  }

  private fun resolveWithClient(urlOrQuery: String, client: String): StreamInfo? {
    return try {
      val stdout = run(
        listOf(
          "--no-playlist",
        ) + resolveRetryArgs + lookupNetArgs + youtubeClientArgs(urlOrQuery, client) + listOf(
          "-f",
          "bestaudio/best",
          "--print",
          // ⚠ Separators MUST be raw ASCII Unit Separators (\u001f), NOT "\t":
          // yt-dlp 2026.08.x stopped escaping output templates, so "\t" is
          // printed literally as backslash-t and tab-splitting never matched —
          // every resolve silently came back "no formats".
          "%(url)s\u001f%(ext)s\u001f%(duration)s",
          urlOrQuery,
        ),
        120_000,
        lookupGate,
      ).stdout
      val line = stdout.split('\n').firstOrNull { it.contains('\u001f') } ?: stdout.trim()
      val parts = line.split('\u001f')
      if (parts.size < 2) return null
      val uri = parts[0]
      if (!uri.startsWith("http://") && !uri.startsWith("https://")) return null
      // yt-dlp prints %(duration)s in *seconds* (e.g. "213.456"); convert to ms.
      val durationSec = parts.getOrNull(2)?.toDoubleOrNull() ?: 0.0
      val duration = (durationSec * 1000.0).toLong().coerceAtLeast(0L)
      StreamInfo(uri, parts[1], duration)
    } catch (e: Exception) {
      null
    }
  }

  /**
   * One yt-dlp process that goes from a search query straight to a playable
   * audio URL. The top hit is validated (duration, forbidden variants, title
   * relevance) — an unchecked top-1 is how wrong songs get saved.
   */
  /**
   * Why a one-shot attempt produced nothing. The distinction matters: when
   * every client reports [NoFormats], extraction itself is blocked on this
   * network and the slow fallback would burn minutes failing identically —
   * so it is skipped and the request fails fast. A [Rejected] means formats
   * existed but validation refused them, and deeper candidates may still hit.
   */
  private sealed interface OneShotOutcome {
    data class Hit(val info: StreamInfo) : OneShotOutcome
    data object Rejected : OneShotOutcome
    data object NoFormats : OneShotOutcome
  }

  /**
   * Runs all attempts, waiting for every one (up to the budget), and returns
   * each client's outcome. Unlike [raceClients], a fast failure never beats a
   * slow success — needed when failures carry meaning.
   */
  private fun <T> collectOutcomes(
    label: String,
    key: String,
    clients: List<String>,
    budgetMs: Long,
    attempt: (client: String) -> T,
  ): List<Pair<String, T>> {
    if (clients.isEmpty()) return emptyList()
    val started = System.currentTimeMillis()
    val futures = clients.map { client ->
      raceExecutor.submit<Pair<String, T>?> {
        val value = try {
          attempt(client)
        } catch (_: Exception) {
          null
        }
        if (value != null) client to value else null
      }
    }
    try {
      val deadline = started + budgetMs
      while (true) {
        if (futures.all { it.isDone }) break
        if (System.currentTimeMillis() >= deadline) {
          futures.forEach { if (!it.isDone) it.cancel(true) }
          Log.w(LOG_TAG, "$label collect timed out for $key")
          break
        }
        try {
          Thread.sleep(250)
        } catch (_: InterruptedException) {
          Thread.currentThread().interrupt()
          futures.forEach { if (!it.isDone) it.cancel(true) }
          break
        }
      }
    } finally {
      futures.forEach { if (!it.isDone) it.cancel(true) }
    }
    return futures.mapNotNull { f ->
      try {
        f.get()
      } catch (_: Exception) {
        null
      }
    }
  }

  private fun resolveSearchOneShot(
    query: String,
    artist: String,
    title: String,
    durationMs: Long?,
    strict: Boolean = false,
  ): OneShotOutcome {
    val clients = listOf(youtubeClient) + fallbackClients
    val started = System.currentTimeMillis()
    val hardDeadline = started + 150_000
    var muxedHit: OneShotOutcome.Hit? = null
    // A muxed first hit parks and waits for a client that yields audio-only.
    // WITHOUT a budget that wait ran to the 150 s hard deadline (the android
    // client answers fastest and its formats are muxed-only, so every song
    // stalled "finding a source" for minutes). 15 s beyond the first muxed
    // hit is enough for the audio-capable clients to answer; afterwards the
    // muxed hit is accepted and the downloader converts it (retag→mp3→m4a).
    var audioWaitDeadlineMs = 0L
    val futures = clients.map { client ->
      raceExecutor.submit<OneShotOutcome> {
        try {
          resolveSearchOneShotWithClient(query, artist, title, durationMs, client, strict)
        } catch (_: Exception) {
          OneShotOutcome.NoFormats
        }
      }
    }
    try {
      // Return the first validated hit immediately (fast success); otherwise
      // wait for every client so the outcome classification below is honest.
      while (true) {
        for ((index, future) in futures.withIndex()) {
          if (!future.isDone) continue
          val outcome = try {
            future.get()
          } catch (_: Exception) {
            OneShotOutcome.NoFormats
          }
          if (outcome is OneShotOutcome.Hit) {
            if (strict && !isAudioContainer(outcome.info.ext)) {
              // A muxed 18/22-style result is playable but would SHIP a video
              // file to a download: park it as a last-resort fallback and keep
              // waiting for a client whose formats include audio-only.
              if (muxedHit == null) {
                Log.d(
                  LOG_TAG,
                  "one-shot demoting muxed container (${outcome.info.ext}) to " +
                    "fallback and waiting (15s budget) for audio-only for '$query'"
                )
                muxedHit = outcome
                audioWaitDeadlineMs =
                  Math.min(hardDeadline, System.currentTimeMillis() + 15_000L)
              }
              continue
            }
            futures.forEach { if (!it.isDone) it.cancel(true) }
            putCache(streamCache, "ytsearch1:$query", streamCacheTtlMs, outcome.info)
            Log.d(
              LOG_TAG,
              "one-shot hit via ${clients[index].ifBlank { "default" }} in " +
                "${System.currentTimeMillis() - started}ms for '$query'"
            )
            return outcome
          }
        }
        if (futures.all { it.isDone }) break
        if (muxedHit != null && audioWaitDeadlineMs > 0L &&
          System.currentTimeMillis() >= audioWaitDeadlineMs
        ) {
          Log.d(LOG_TAG, "one-shot audio-wait budget elapsed; accepting the muxed hit for '$query'")
          break
        }
        if (System.currentTimeMillis() >= hardDeadline) {
          futures.forEach { if (!it.isDone) it.cancel(true) }
          Log.w(LOG_TAG, "one-shot collect timed out for '$query'")
          break
        }
        try {
          Thread.sleep(250)
        } catch (_: InterruptedException) {
          Thread.currentThread().interrupt()
          futures.forEach { if (!it.isDone) it.cancel(true) }
          break
        }
      }
    } finally {
      futures.forEach { if (!it.isDone) it.cancel(true) }
    }
    if (muxedHit != null) {
      putCache(streamCache, "ytsearch1:$query", streamCacheTtlMs, muxedHit.info)
      Log.d(LOG_TAG, "one-shot falling back to the muxed hit for '$query'")
      return muxedHit
    }
    val outcomes = futures.mapNotNull { f ->
      try {
        f.get()
      } catch (_: Exception) {
        null
      }
    }
    return if (outcomes.any { it is OneShotOutcome.Rejected }) {
      Log.w(LOG_TAG, "one-shot found only rejected hits for '$query'")
      OneShotOutcome.Rejected
    } else {
      Log.w(LOG_TAG, "one-shot found no formats for '$query'")
      OneShotOutcome.NoFormats
    }
  }

  private fun resolveSearchOneShotWithClient(
    query: String,
    artist: String,
    title: String,
    durationMs: Long?,
    client: String,
    strict: Boolean = false,
  ): OneShotOutcome {
    return try {
      val started = System.currentTimeMillis()
      val completed = run(
        listOf("--no-playlist") + searchRetryArgs + lookupNetArgs + youtubeClientArgs("ytsearch", client) + listOf(
          "-f",
          "bestaudio/best",
          "--print",
          // Same separator rule as resolveWithClient: \u001f survives yt-dlp's
          // un-escaped output templates; "\t" would print literally.
          "%(url)s\u001f%(ext)s\u001f%(duration)s\u001f%(title)s\u001f%(uploader)s",
          "ytsearch1:$query",
        ),
        120_000,
        lookupGate,
      )
      if (completed.code != 0) return OneShotOutcome.NoFormats
      val line = completed.stdout.split('\n').firstOrNull { it.contains('\u001f') }
        ?: return OneShotOutcome.NoFormats
      val parts = line.split('\u001f')
      val uri = parts.getOrNull(0)?.trim().orEmpty()
      if (!uri.startsWith("https://")) return OneShotOutcome.NoFormats
      val durationSec = parts.getOrNull(2)?.toDoubleOrNull() ?: 0.0
      val actualMs = (durationSec * 1000.0).toLong().coerceAtLeast(0L)
      val resultTitle = parts.getOrNull(3)?.trim().orEmpty()
      val uploader = parts.getOrNull(4)?.trim().orEmpty()
      if (durationMs != null && durationMs > 0 && actualMs > 0) {
        val ratio = actualMs.toDouble() / durationMs
        if (ratio < 0.5 || ratio > 1.5) return OneShotOutcome.Rejected
      } else if (actualMs > maxUnknownLengthMs) {
        // No expected length (e.g. an unmatched Spotify row): this is how
        // hour-long loops end up saved as 4-minute songs. Cap it.
        Log.w(LOG_TAG, "one-shot rejects overlong result (${actualMs}ms) for '$query'")
        return OneShotOutcome.Rejected
      }
      if (actualMs in 1 until minFullLengthMs) return OneShotOutcome.Rejected
      // Pitch/speed-altered uploads, non-performances and live recordings
      // (sped up, slowed, reverb, loops, karaoke, covers, live…) can share the
      // song's length, so duration alone can't catch them — match the title
      // instead. The exemption reads the RAW request (not the stripped query)
      // so explicitly-requested live versions still pass.
      if (resultTitle.isNotEmpty() && hasForbiddenVariant("$artist $title", resultTitle)) {
        Log.w(LOG_TAG, "one-shot rejects variant '$resultTitle' for '$query'")
        return OneShotOutcome.Rejected
      }
      // The top hit is not always the song (transliterated queries, generic
      // words): require the title to actually resemble the request, or the
      // uploader to be the artist's own channel.
      val durationTight = durationMs != null && durationMs > 0 && actualMs > 0 &&
        actualMs.toDouble() / durationMs in 0.8..1.25
      if (resultTitle.isNotEmpty() &&
        !passesTitleGate(title, artist, resultTitle, uploader, durationTight, requireEvidence = strict)
      ) {
        Log.w(LOG_TAG, "one-shot rejects off-topic '$resultTitle' for '$query'")
        return OneShotOutcome.Rejected
      }
      // Hard artist gate (the wrong-song fix): an unlabeled cover or re-upload
      // titled exactly like the song passes the title gate with zero artist
      // evidence — the old scoring accepted it (100 + duration - 50 >= 45).
      // Require the uploader to resemble the artist, unless the title matches
      // outright AND the duration is tight (0.8x-1.25x), which keeps
      // "Artist - Topic"-style uploads and compilation channels alive.
      if (artist.isNotBlank() && uploader.isNotBlank()) {
        val artistOk = SincTrackMatch.artistSignal(artist, uploader)
        if (!artistOk) {
          val gate = SincTrackMatch.titleGate(title, artist, resultTitle, uploader)
          // Two honest cross-script cases the raw artist check cannot see:
          // the artist's own channel under another script (وينجى ↔ "Wingii")
          // and regional re-uploads; a NeAR-EXACT re-upload is evidenced by
          // title containment + duration within ±6% (a re-upload keeps the
          // same take). Anything slowed/sped/nightcore — even by NAME only in
          // the channel — cannot ride this escape, which is what keeps the
          // unlabeled-variant leak closed.
          val nearExact = durationMs != null && durationMs > 0 && actualMs > 0 &&
            actualMs.toDouble() / durationMs in 0.94..1.07
          val altered = SincTrackMatch.hasForbiddenVariant("$artist $title", resultTitle) ||
            SincTrackMatch.hasForbiddenVariant("$artist $title", uploader)
          val allowEscape = gate.viaContainment && !altered &&
            if (strict) nearExact else durationTight
          if (!allowEscape) {
            Log.w(
              LOG_TAG,
              "one-shot rejects uploader '$uploader' for '$query' " +
                "(no artist signal${if (strict) ", strict" else ""})"
            )
            return OneShotOutcome.Rejected
          }
        }
      }
      Log.d(
        LOG_TAG,
        "one-shot ok client=${if (client.isBlank()) "default" else client} in ${System.currentTimeMillis() - started}ms " +
          "duration=${actualMs}ms"
      )
      OneShotOutcome.Hit(StreamInfo(uri, parts.getOrNull(1)?.trim().orEmpty(), actualMs))
    } catch (e: Exception) {
      OneShotOutcome.NoFormats
    }
  }

  /**
   * Title-relevance gate for a top search hit. Passes when the hit's title
   * contains the requested title (or vice versa), when the uploader is
   * recognizably the artist's own channel (auto-generated Topic channels
   * included), or when token overlap is strong. Script differences (Latin
   * query vs Arabic title) usually still pass via the channel check.
   */
  private fun passesTitleGate(
    title: String,
    artist: String,
    resultTitle: String,
    uploader: String,
    durationTight: Boolean = false,
    requireEvidence: Boolean = false,
  ): Boolean =
    SincTrackMatch.titleGate(title, artist, resultTitle, uploader, durationTight, requireEvidence).passed

  private data class AudiusHit(
    val id: String,
    val title: String,
    val artist: String,
    val durationMs: Long,
    val plays: Long,
    val artwork: String?,
  )

  private fun audiusGet(path: String, timeoutMs: Int = 8_000): String? {
    return try {
      val conn = (URL("$audiusBase$path").openConnection() as HttpURLConnection).apply {
        requestMethod = "GET"
        // 6s/8s on purpose: this is a BONUS tier. On a collapsed link a 15s
        // connect + 20s read would hold EVERY resolve hostage before the
        // yt-dlp search even began — the tier must fail fast instead.
        connectTimeout = 6_000
        readTimeout = timeoutMs
        instanceFollowRedirects = true
        setRequestProperty("User-Agent", "Sinc/1.0 (music player)")
        setRequestProperty("Accept", "application/json")
      }
      if (conn.responseCode !in 200..299) return null
      conn.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
    } catch (e: Exception) {
      Log.w(LOG_TAG, "audius request failed: ${e.message}")
      null
    }
  }

  private fun audiusSearch(query: String): List<AudiusHit> {
    val body = audiusGet(
      "/v1/tracks/search?query=${URLEncoder.encode(query, "UTF-8")}&app_name=$audiusAppName&limit=10"
    ) ?: return emptyList()
    return try {
      val data = JSONObject(body).optJSONArray("data") ?: JSONArray()
      buildList {
        for (i in 0 until data.length()) {
          val t = data.optJSONObject(i) ?: continue
          val id = t.optString("id", "").trim()
          val title = t.optString("title", "").trim()
          if (id.isEmpty() || title.isEmpty()) continue
          val art = t.optJSONObject("artwork")
          add(
            AudiusHit(
              id = id,
              title = title,
              artist = t.optJSONObject("user")?.optString("name", "")?.trim().orEmpty()
                .ifBlank { "Unknown Artist" },
              durationMs = (t.optDouble("duration", 0.0) * 1000).toLong().coerceAtLeast(0L),
              plays = t.optLong("play_count", 0L),
              artwork = art?.optString("480x480")?.trim()?.ifBlank { null }
                ?: art?.optString("150x150")?.trim()?.ifBlank { null },
            )
          )
        }
      }
    } catch (e: Exception) {
      Log.w(LOG_TAG, "audius parse failed: ${e.message}")
      emptyList()
    }
  }

  private fun audiusStreamUrl(id: String): String =
    "$audiusBase/v1/tracks/$id/stream?app_name=$audiusAppName"

  /**
   * Picks the Audius upload matching the request.
   *
   * Tier 1 excludes re-performances (covers/karaoke/instrumentals) and — the
   * wrong-song fix — in strict (download) mode additionally requires the
   * uploader to evidence the artist: Audius is full of unlabeled re-uploads
   * that match title and length, and the streaming-cache tier wins outright,
   * so a hijack here poisons both playback and downloads.
   *
   * Tier 2 admits labeled covers when the title clearly matches and the length
   * is tight — a cover of the right song beats nothing — but only in lenient
   * (playback) mode; downloads never save an alteration.
   */
  private fun audiusMatch(
    title: String,
    artist: String,
    durationMs: Long?,
    hits: List<AudiusHit>,
    strict: Boolean,
  ): AudiusHit? {
    if (hits.isEmpty()) return null
    val clean = hits.filterNot { h -> hasForbiddenVariant("$artist $title", h.title) }
    val tier1 = if (strict) {
      clean.filter { !artist.isBlank() && SincTrackMatch.artistSignal(artist, it.artist) }
    } else {
      clean
    }
    val strictWin = matchCandidates(title, artist, durationMs, tier1, strict)
    if (strictWin != null) return strictWin
    if (strict) return null
    if (durationMs == null || durationMs <= 0) return null
    val qBase = SincTrackMatch.baseTitle(title).lowercase(Locale.ROOT).trim()
    if (qBase.isEmpty()) return null
    val rawQuery = "$artist $title"
    val lenient = clean.filter { h ->
      val rBase = SincTrackMatch.baseTitle(h.title).lowercase(Locale.ROOT).trim()
      (rBase.contains(qBase) || qBase.contains(rBase)) &&
        h.durationMs > 0 &&
        h.durationMs.toDouble() / durationMs in 0.8..1.25 &&
        !isUnwantedLive(rawQuery, h.title)
    }
    return matchCandidates(title, artist, durationMs, lenient, strict)
  }

  private fun matchCandidates(
    title: String,
    artist: String,
    durationMs: Long?,
    hits: List<AudiusHit>,
    strict: Boolean,
  ): AudiusHit? {
    if (hits.isEmpty()) return null
    val candidates = hits.map { h ->
      Candidate(h.title, h.artist, h.durationMs, audiusStreamUrl(h.id))
    }
    val best = SincTrackMatch.bestMatch(title, artist, durationMs, candidates, strict)
      ?: return null
    // bestMatch scores the stream URL; map back to the hit for artwork/plays.
    return hits.firstOrNull { h -> audiusStreamUrl(h.id) == best.url }
  }

  /**
   * Audius tier: search → strict match → direct MP3 stream URL. No yt-dlp
   * spawn, no format extraction — just two fast HTTPS calls.
   */
  private fun resolveAudius(
    query: String,
    artist: String,
    title: String,
    durationMs: Long?,
    strict: Boolean = false,
  ): StreamInfo? {
    val started = System.currentTimeMillis()
    val hits = try {
      audiusSearch(query)
    } catch (e: Exception) {
      Log.w(LOG_TAG, "audius search failed: ${e.message}")
      return null
    }
    if (hits.isEmpty()) return null
    val win = audiusMatch(title, artist, durationMs, hits, strict) ?: run {
      Log.w(LOG_TAG, "audius matched nothing valid for '$query' (${hits.size} hits)")
      return null
    }
    Log.d(
      LOG_TAG,
      "audius ok in ${System.currentTimeMillis() - started}ms '${win.title}' " +
        "by ${win.artist} plays=${win.plays}"
    )
    return StreamInfo(audiusStreamUrl(win.id), "mp3", win.durationMs)
  }

  private fun searchCandidates(query: String, site: String): List<Candidate> {
    val prefix = if (site == "soundcloud") "scsearch" else "ytsearch"
    val completed = run(
      listOf(
        "--flat-playlist",
        "--dump-single-json",
        "--no-playlist",
      ) + searchRetryArgs + lookupNetArgs + youtubeClientArgs(prefix) + listOf("$prefix${8}:$query"),
      60_000,
      lookupGate,
    )
    return try {
      val data = JSONObject(completed.stdout)
      val entries: JSONArray = data.optJSONArray("entries") ?: JSONArray()
      buildList {
        for (i in 0 until entries.length()) {
          val entry = entries.optJSONObject(i) ?: continue
          val title = entry.optString("title", "").trim()
          val url = entry.optString("webpage_url").trim().ifBlank {
            entry.optString("url", "").trim()
          }
          if (title.isEmpty() || url.isEmpty()) continue
          add(
            Candidate(
              title,
              entry.optString("uploader").trim().ifBlank { entry.optString("channel", "").trim() }
                .ifBlank { "Unknown Artist" },
              (entry.optDouble("duration", 0.0) * 1000).toLong(),
              url,
            )
          )
        }
      }
    } catch (e: Exception) {
      emptyList()
    }
  }

  /**
   * Resolves "artist - title" to a validated stream URL.
   *
   * @param strict downloads refuse alteration-only pools and unvalidated
   *   Audius re-uploads; playback keeps today's lenient fall-throughs so a
   *   cover the user can skip still plays instead of erroring.
   */
  private fun resolveByQueryInternal(
    artist: String,
    title: String,
    durationMs: Long?,
    strict: Boolean = false,
  ): String? {
    // Mirrors the server: the *search query* is variant-stripped for recall,
    // while the *match* uses the raw title so bestMatch can see live/remix tags.
    val query = listOf(artist.trim(), searchTitle(title).trim())
      .filter { it.isNotEmpty() }
      .joinToString(" - ")
      .trim()
    if (query.isEmpty()) return null
    Log.i(LOG_TAG, "resolve entry query='$query' strict=$strict")

    // Repeat plays (or plays of the same query within the TTL) are instant.
    val cacheKey = queryCacheKey(query)
    // A validated-but-muxed (itag 18/22 video mp4) hit: never handed to a
    // strict download as THE answer, but kept so the resolve can still return
    // it if nothing audio-only exists anywhere.
    var muxedFallback: StreamInfo? = null
    lookupCache(queryCache, cacheKey)?.let { cached ->
      if (!strict || isAudioContainer(cached.ext)) return cached.uri
      Log.d(LOG_TAG, "cached muxed container (${cached.ext}) demoted to fallback for '$query'")
      muxedFallback = cached
    }

    // Audius (win-when-matched) and the yt search run CONCURRENTLY. A serial
    // probe stalls every non-Audius resolve for the tier's full timeout on a
    // bad link before the search even begins; out-of-band it adds nothing.
    // Preference stays with Audius (matched ≤8s usually, cheaper, and its
    // stream URL needs no extraction) — after the search lands we only wait a
    // short grace window for it, never the old serial worst case.
    val audiusFuture = audiusExecutor.submit<StreamInfo?>(
      java.util.concurrent.Callable { resolveAudius(query, artist, title, durationMs, strict) }
    )
    val oneShot = resolveSearchOneShot(query, artist, title, durationMs, strict)
    val audius = try {
      audiusFuture.get(8_000L, TimeUnit.MILLISECONDS)
    } catch (e: Exception) {
      audiusFuture.cancel(true)
      null
    }
    if (audius != null) {
      putCache(queryCache, cacheKey, queryCacheTtlMs, audius)
      putCache(streamCache, audius.uri, streamCacheTtlMs, audius)
      return audius.uri
    }

    // Fast path: validated top hits across clients, raced concurrently.
    // This is what makes play feel instant (no candidate loop, no re-resolve).
    when (val fast = oneShot) {
      is OneShotOutcome.Hit -> {
        if (strict && !isAudioContainer(fast.info.ext)) {
          // The top hit is a muxed video container: park it and let the
          // deep search (which asks clients for audio-only picks) find a
          // real audio format for the download.
          Log.d(LOG_TAG, "one-shot muxed container (${fast.info.ext}) demoted for '$query'")
          muxedFallback = fast.info
          putCache(queryCache, cacheKey, queryCacheTtlMs, fast.info)
          putCache(streamCache, fast.info.uri, streamCacheTtlMs, fast.info)
        } else {
          putCache(queryCache, cacheKey, queryCacheTtlMs, fast.info)
          putCache(streamCache, fast.info.uri, streamCacheTtlMs, fast.info)
          return fast.info.uri
        }
      }
      is OneShotOutcome.NoFormats -> {
        if (strict) {
          // A download must not die because the TOP hit's formats are gated
          // ("Requested format is not available" spans sign-in-gated videos,
          // PO-token walls and player-client quirks — not a network-wide
          // ban). The slow path below is bounded and scores every candidate,
          // so let deeper results try.
          Log.w(LOG_TAG, "one-shot found no formats for '$query' (strict: trying deeper candidates)")
        } else {
          // An empty top-hit search is NOT proof that extraction is blocked:
          // on a flaky link the innertube requests fail (retried), yt-dlp
          // turns each failure into a suppressed warning and exits 0 with an
          // empty playlist — which looks exactly like "nothing found". Error
          // the play request out over that and the user needs one retry per
          // wiggle of the Wi-Fi. The candidate pool below is bounded
          // (SoundCloud first, then YouTube) and is the only other chance
          // this song has; let it run.
          Log.w(LOG_TAG, "one-shot empty for '$query' (lenient: trying candidate pool)")
        }
      }
      is OneShotOutcome.Rejected -> {
        // Formats exist but validation refused them — deeper candidates may
        // still match, so fall through to scoring.
      }
    }

    // Slow fallback: list both sites' candidates concurrently, then score
    // soundcloud first (usually the cleaner match), then youtube.
    val siteLists = collectOutcomes(
      "candidates",
      query,
      listOf("soundcloud", "youtube"),
      75_000,
    ) { site -> searchCandidates(query, site) }
      .sortedBy { (site, _) -> if (site == "soundcloud") 0 else 1 }
    for ((site, candidates) in siteLists) {
      if (candidates.isEmpty()) continue
      val best = SincTrackMatch.bestMatch(title, artist, durationMs, candidates, strict) ?: continue
      // Downloads want audio-only: the audio-aware resolve rejects the muxed
      // itag 18/22 picks (they still land as a fallback when nothing else).
      val stream = resolve(best.url, audioOnly = strict)
      if (stream == null) {
        // First failed lookup of the session gets a verbose diagnostic so the
        // next logcat read shows WHY the phone's formats came back empty.
        runLookupDiagnosticOnce(best.url)
        continue
      }
      if (site == "soundcloud" && stream.durationMs in 1 until minFullLengthMs) continue
      putCache(queryCache, cacheKey, queryCacheTtlMs, stream)
      putCache(streamCache, best.url, streamCacheTtlMs, stream)
      return best.url
    }

    // No blind last resort: returning an unchecked "ytsearch1:" string is how
    // completely wrong songs got saved/played. Fail honestly instead — but a
    // VALIDATED (title/duration/artist-gated) muxed hit still beats failing
    // the download outright; the downloader converts it.
    Log.w(LOG_TAG, "no validated source for '$query'")
    muxedFallback?.let { fallback ->
      Log.w(LOG_TAG, "accepting the demoted muxed hit for '$query'")
      return fallback.uri
    }
    return null
  }

  /** Resolves a raw "Artist - Title" or http url to something yt-dlp can download. */
  private fun resolveForDownload(query: String, durationMs: Long?, strict: Boolean = true): String {
    val trimmed = query.trim()
    if (trimmed.isEmpty()) throw IllegalStateException("No source to download")
    if (trimmed.contains("://")) return trimmed
    val parts = trimmed.split(" - ", limit = 2).map { it.trim() }
    val artist = parts.getOrNull(0) ?: ""
    val title = parts.getOrNull(1) ?: ""
    return resolveByQueryInternal(artist, title, durationMs, strict)
      ?: throw IllegalStateException(
        if (System.currentTimeMillis() - lastNetworkDeadAtMs < 10 * 60_000L) {
          // The lookups failed because the LINK collapsed (DNS/route/TLS) —
          // a waiting-class error, not a verdict about the track.
          "Network was unreachable during the source lookup"
        } else {
          "No downloadable source was found for this track"
        },
      )
  }

  /** True for URLs that ARE the audio bytes (no extraction needed). */
  private fun isDirectAudioFile(url: String): Boolean {
    val lower = url.lowercase(Locale.ROOT)
    if (
      lower.contains("youtube.com") || lower.contains("youtu.be") ||
      lower.contains("soundcloud.com")
    ) {
      return false
    }
    if (lower.contains("audius.co")) return true
    val path = lower.substringBefore('?')
    return listOf(
      ".mp3", ".m4a", ".mp4", ".ogg", ".oga", ".opus",
      ".flac", ".wav", ".aac", ".webm",
    ).any { path.endsWith(it) }
  }

  private fun formatSpeedText(bytesPerSec: Double): String {
    if (bytesPerSec < 1024) return "${bytesPerSec.toInt()} B/s"
    val kib = bytesPerSec / 1024
    if (kib < 1024) {
      return if (kib >= 100) "${kib.toInt()} KiB/s" else "${"%.1f".format(kib)} KiB/s"
    }
    val mib = kib / 1024
    return if (mib >= 100) "${mib.toInt()} MiB/s" else "${"%.1f".format(mib)} MiB/s"
  }

  /**
   * Transport-level failures (DNS gone, route gone, TLS torn) mean the LINK
   * was the problem, not the track. resolveForDownload then surfaces a
   * *waiting*-friendly message so a flapping Wi-Fi parks the job instead of
   * dooming it with "No downloadable source was found".
   */
  @Volatile
  private var lastNetworkDeadAtMs = 0L

  private val networkDeadPatterns = listOf(
    "[Errno 101]",                // Network is unreachable
    "[Errno 7]",                  // No address associated with hostname
    "[Errno -3]",                 // Temporary failure in name resolution
    "[Errno 113]",                // No route to host
    "SSL: UNEXPECTED_EOF_WHILE_READING",
    "handshake operation timed out",
    "The read operation timed out",
    "Software caused connection abort",
    "Temporary failure in name resolution",
  )

  private fun isNetworkDeadStderr(stderr: String): Boolean =
    stderr.isNotBlank() && networkDeadPatterns.any { stderr.contains(it, ignoreCase = true) }

  /**
   * Plain-HTTPS download of a direct audio file with live progress + speed
   * and cancellation support. Tags ID3 + cover afterwards (lossless when the
   * file is already MP3).
   */
  private fun downloadDirectResult(
    url: String,
    template: File,
    jobId: String?,
    title: String?,
    artist: String?,
    album: String?,
    artworkUrl: String?,
  ): DownloadResult {
    val outDir = template.parentFile
      ?: throw IllegalStateException("Download failed: no output directory")
    val conn = (URL(url).openConnection() as HttpURLConnection).apply {
      requestMethod = "GET"
      connectTimeout = 15_000
      readTimeout = 30_000
      instanceFollowRedirects = true
      setRequestProperty("User-Agent", "Sinc/1.0 (music player)")
    }
    if (conn.responseCode !in 200..299) {
      throw IllegalStateException("Direct download failed (HTTP ${conn.responseCode})")
    }
    val total = conn.contentLengthLong
    val tmp = File(outDir, "${template.name}.part")
    try {
      var written = 0L
      var lastEmit = 0L
      var lastBytes = 0L
      var lastTime = System.currentTimeMillis()
      conn.inputStream.use { input ->
        tmp.outputStream().use { out ->
          val buf = ByteArray(64 * 1024)
          while (true) {
            val n = input.read(buf)
            if (n == -1) break
            out.write(buf, 0, n)
            written += n
            val now = System.currentTimeMillis()
            if (jobId != null && now - lastEmit >= 500) {
              val dtSec = (now - lastTime) / 1000.0
              val speed = if (dtSec > 0) (written - lastBytes) / dtSec else 0.0
              lastEmit = now
              lastBytes = written
              lastTime = now
              if (total > 0) {
                val pct = ((written.toDouble() / total) * 100).toInt().coerceIn(0, 99)
                SincDownloads.update(jobId, pct)
                SincDownloads.emitYtProgress(jobId, pct, formatSpeedText(speed))
              }
            }
            if (jobId != null && !SincDownloads.isActive(jobId)) {
              throw InterruptedException("Direct download cancelled")
            }
            // Pause aborts the loop too (JS owns the paused state and will
            // restart the transfer on resume; direct files can't Range-resume).
            if (jobId != null && SincDownloads.isPaused(jobId)) {
              throw PausedDownload()
            }
          }
        }
      }
      if (tmp.length() == 0L) throw IllegalStateException("Direct download produced an empty file")
      val file = File(outDir, template.name)
      if (file.exists()) file.delete()
      if (!tmp.renameTo(file)) {
        tmp.copyTo(file, overwrite = true)
        tmp.delete()
      }
      finishTaggedFile(file, title, artist, album, artworkUrl)
      val duration = probeAudioDuration(file)
      return DownloadResult(file, mimeTypeForExt(file.extension), duration)
    } catch (e: Exception) {
      tmp.delete()
      throw e
    }
  }

  /**
   * Writes ID3 title/artist/album (+ cover when fetchable) onto a finished
   * file. MP3s are remuxed losslessly; anything else is transcoded once.
   * Best-effort: tagging never fails the download.
   */
  private fun finishTaggedFile(
    file: File,
    title: String?,
    artist: String?,
    album: String?,
    artworkUrl: String?,
  ) {
    try {
      val cover = downloadCover(artworkUrl, file.parentFile ?: return)
      try {
        if (file.extension.lowercase() == "mp3" && cover == null) {
          tagMp3InPlace(file, title, artist, album)
        } else if (file.extension.lowercase() == "mp3" && cover != null && cover.isFile) {
          val tagged = File(file.parentFile, "${file.nameWithoutExtension}.tagged.mp3")
          if (transcodeToMp3(file, tagged, title, artist, album, cover)) {
            file.delete()
            tagged.renameTo(file)
          } else {
            tagged.delete()
            tagMp3InPlace(file, title, artist, album)
          }
        }
      } finally {
        cover?.delete()
      }
    } catch (e: Exception) {
      Log.w(LOG_TAG, "tagging failed (audio is fine): ${e.message}")
    }
  }

  /** Thrown to unwind a direct download the user paused (JS owns the state). */
  private class PausedDownload : Exception("Download paused")

  /** What a finished download produced: the audio file and its real container. */
  private data class DownloadResult(val file: File, val mimeType: String, val durationMs: Long)

  /**
   * Downloads the best audio for a url/query into app storage and returns the
   * produced file (mp3 when the bundled ffmpeg could transcode it, otherwise the
   * source container). When `jobId` is set the transfer shows in the foreground
   * download notification and becomes pause/cancellable; `resumePart` skips the
   * stale-partial cleanup so a paused yt-dlp run continues from the same offset.
   */
  private fun downloadInternal(
    urlOrQuery: String,
    template: File,
    jobId: String?,
    title: String?,
    artist: String?,
    album: String?,
    artworkUrl: String?,
    resumePart: Boolean,
  ): DownloadResult {
    if (!resumePart) {
      // Drop stale partials from a previously killed run: resuming them against
      // a freshly-resolved (expired/changed) URL fails with HTTP 416 forever.
      template.parentFile?.listFiles()?.forEach { f ->
        if (f.name.startsWith(template.name) &&
          (f.name.endsWith(".part") || f.name.endsWith(".ytdl"))
        ) {
          f.delete()
        }
      }
    }
    if (jobId != null) {
      // The process isn't started yet; run() registers the real kill handle.
      SincDownloads.begin(jobId, title ?: template.name) {}
    }
    // Direct audio files (Audius streams, plain MP3 links): plain HTTPS
    // download, no yt-dlp spawn. Much faster and immune to extractor blocks.
    if (isDirectAudioFile(urlOrQuery)) {
      return try {
        downloadDirectResult(urlOrQuery, template, jobId, title, artist, album, artworkUrl)
      } finally {
        if (jobId != null) SincDownloads.end(jobId)
      }
    }
    val base = listOf(
      "--no-warnings",
      "--no-playlist",
    ) + youtubeClientArgs(urlOrQuery) + listOf(
      // Prefer the m4a/aac stream: it retags losslessly (no transcode → the
      // download finishes right after the transfer) and every music player
      // reads mp4 metadata. Falls back to whatever is available.
      "-f",
      "bestaudio[ext=m4a]/bestaudio/best",
      "--retries",
      "5",
      "--fragment-retries",
      "5",
      "--socket-timeout",
      "30",
      "--newline",
      "-o",
      "${template.parentFile?.absolutePath.orEmpty()}/${template.name}.%(ext)s",
      urlOrQuery,
    )
    return try {
      val completed = run(
        base,
        // Mobile networks are slow (observed ~235KiB/s on-device); a 3-10MB
        // track legitimately needs >2min, so the old 90s cap failed downloads.
        // 15min instead of 10: a slow connection + Range-resume recovery
        // (transient failures retry rather than kill the job).
        downloadTimeoutMs,
        downloadGate,
        jobId,
        onStderrLine = { line -> onDownloadProgress(jobId, line) },
      )
      if (completed.code != 0) {
        val message = completed.stderr.split('\n').lastOrNull()?.trim()?.take(300)
          ?: "Download failed"
        throw IllegalStateException(message)
      }
      val raw = producedFile(template)
      if (raw == null || raw.length() == 0L) {
        throw IllegalStateException("Download failed: output file not found")
      }
      // yt-dlp postprocessing (`-x --audio-format mp3`) needs a *pair* of
      // ffmpeg+ffprobe binaries; only ffmpeg ships in the APK, so `-x` always
      // died with "ffprobe and ffmpeg not found". Pull the raw audio stream and
      // transcode with our own ffmpeg instead, which needs no probe binary.
      //
      // template.name ends in the LEGACY `.mp3` shape (safeFileName), but the
      // produced container is whatever yt-dlp grabbed. Tagging rules, in order
      // of both compatibility and speed:
      //   mp3          → ID3 in place; embed the cover via one lossless remux.
      //   m4a (aac)    → LOSSLESS retag (mp4 atoms) + attached cover: zero
      //                  re-encode, so this is the fast path; the published
      //                  copy keeps the real .m4a extension.
      //   webm/opus/…  → mp3 transcode; if the bundled ffmpeg lacks
      //                  libmp3lame, an m4a/aac transcode; if BOTH fail keep
      //                  the raw file. (Publishing a webm under a `.mp3` name
      //                  is how other players previously showed no artwork or
      //                  artist names.)
      val stem = template.name.removeSuffix(".mp3")
      val cover = template.parentFile?.let { downloadCover(artworkUrl, it) }
      val mp3Target = File(raw.parentFile, "$stem.mp3")
      val m4aTarget = File(raw.parentFile, "$stem.m4a")
      val final: File = when (raw.extension.lowercase(Locale.ROOT)) {
        "mp3" -> if (cover != null) {
          val tagged = File(raw.parentFile, "$stem.tagged.mp3")
          if (transcodeToMp3(raw, tagged, title, artist, album, cover)) {
            raw.delete()
            tagged
          } else {
            tagMp3InPlace(raw, title, artist, album)
            raw
          }
        } else {
          tagMp3InPlace(raw, title, artist, album)
          raw
        }
        "m4a", "m4b", "mp4" -> {
          if (retagM4aInPlace(raw, m4aTarget, title, artist, album, cover)) {
            if (raw.canonicalPath != m4aTarget.canonicalPath) raw.delete()
            m4aTarget
          } else {
            // Retag refused (e.g. its cover attach failed, or the muxed
            // itag-18 container confused the copy): still do NOT publish a
            // `song.mp4` video — transcode instead, then finally keep the
            // raw file rather than a file named like this.
            if (transcodeToMp3(raw, mp3Target, title, artist, album, cover)) {
              raw.delete()
              mp3Target
            } else {
              mp3Target.delete()
              if (transcodeToM4a(raw, m4aTarget, title, artist, album, cover)) {
                raw.delete()
                m4aTarget
              } else {
                m4aTarget.delete()
                raw
              }
            }
          }
        }
        else -> {
          if (transcodeToMp3(raw, mp3Target, title, artist, album, cover)) {
            raw.delete()
            mp3Target
          } else {
            mp3Target.delete()
            if (transcodeToM4a(raw, m4aTarget, title, artist, album, cover)) {
              raw.delete()
              m4aTarget
            } else {
              m4aTarget.delete()
              raw
            }
          }
        }
      }
      cover?.delete()
      if (!final.isFile || final.length() == 0L) {
        throw IllegalStateException("Download failed: no audio file produced")
      }
      val duration = probeAudioDuration(final)
      DownloadResult(final, mimeTypeForExt(final.extension), duration)
    } finally {
      if (jobId != null) SincDownloads.end(jobId)
    }
  }

  /** The file yt-dlp actually wrote for `template`, ignoring partial fragments. */
  private fun producedFile(template: File): File? =
    template.parentFile
      ?.listFiles()
      ?.filter { it.name.startsWith(template.name) }
      ?.filterNot { it.name.endsWith(".part") || it.name.endsWith(".ytdl") }
      ?.maxByOrNull { it.length() }

  /** Container mime for the extensions yt-dlp hands back. */
  private fun mimeTypeForExt(ext: String): String = when (ext.lowercase()) {
    "mp3" -> "audio/mpeg"
    "m4a", "mp4", "m4b" -> "audio/mp4"
    "opus" -> "audio/opus"
    "ogg", "oga" -> "audio/ogg"
    "webm" -> "audio/webm"
    "aac" -> "audio/aac"
    "flac" -> "audio/flac"
    "wav" -> "audio/wav"
    else -> "audio/mpeg"
  }

  /**
   * Fetches the track artwork for embedding. Best-effort: null when offline,
   * blocked or unparsable — the download proceeds untagged-cover regardless.
   */
  private fun downloadCover(artworkUrl: String?, outDir: File): File? {
    if (artworkUrl.isNullOrBlank()) return null
    return try {
      val conn = (URL(artworkUrl).openConnection() as HttpURLConnection).apply {
        requestMethod = "GET"
        connectTimeout = 15_000
        readTimeout = 15_000
        instanceFollowRedirects = true
        setRequestProperty("User-Agent", "Sinc/1.0 (music player)")
      }
      if (conn.responseCode !in 200..299) return null
      val ext = when {
        (conn.contentType ?: "").contains("png", ignoreCase = true) -> ".png"
        (conn.contentType ?: "").contains("webp", ignoreCase = true) -> ".webp"
        else -> ".jpg"
      }
      val tmp = File.createTempFile("cover", ext, outDir)
      conn.inputStream.use { input -> tmp.outputStream().use { input.copyTo(it) } }
      if (tmp.length() > 0L) tmp else null
    } catch (e: Exception) {
      Log.w(LOG_TAG, "cover fetch failed: ${e.message}")
      null
    }
  }

  private fun metaArgs(title: String?, artist: String?, album: String?): List<String> {
    val args = mutableListOf<String>()
    if (!title.isNullOrBlank()) args += listOf("-metadata", "title=$title")
    if (!artist.isNullOrBlank()) args += listOf("-metadata", "artist=$artist")
    if (!album.isNullOrBlank()) args += listOf("-metadata", "album=$album")
    return args
  }

  /**
   * Converts a downloaded audio stream to mp3 with the bundled ffmpeg, writing
   * ID3 title/artist/album and embedding the cover so other music players
   * show the song correctly. Returns false (leaving `target` absent) when the
   * encoder is unavailable so the caller can fall back to the original
   * container.
   */
  /**
   * Lossless mp4 retag: streams the audio into `target` (no re-encode) with
   * metadata atoms and, when available, an attached cover picture. This is the
   * fast path for yt-dlp's m4a output — correct artist/album/cover in every
   * music player with zero CPU cost. False leaves both files untouched so the
   * caller can fall back.
   */
  private fun retagM4aInPlace(
    source: File,
    target: File,
    title: String?,
    artist: String?,
    album: String?,
    cover: File?,
  ): Boolean {
    if (source.canonicalPath == target.canonicalPath) return false
    return try {
      val base = listOf(
        "-nostdin", "-y",
        "-i", source.absolutePath,
      )
      val withCover = if (cover != null && cover.isFile) {
        base + listOf(
          "-i", cover.absolutePath,
          "-map", "0:a", "-map", "1:v",
          "-c:a", "copy", "-c:v", "mjpeg",
          "-disposition:v:0", "attached_pic",
        )
      } else {
        base + listOf("-map", "0:a", "-c:a", "copy", "-map_metadata", "0")
      }
      val res = runFfmpeg(
        withCover + metaArgs(title, artist, album) + listOf(target.absolutePath),
        120_000,
        downloadGate,
      )
      if (target.isFile && target.length() > 0L) {
        true
      } else {
        target.delete()
        Log.w(
          LOG_TAG,
          "m4a retag produced no file (code=${res.code}) for ${source.name}: " +
            res.stderr.trim().take(600)
        )
        false
      }
    } catch (e: Exception) {
      Log.w(LOG_TAG, "m4a retag failed: ${e.message}")
      target.delete()
      false
    }
  }

  /**
   * Re-encodes into m4a/aac — the fallback when the bundled ffmpeg lacks
   * libmp3lame: aac is part of every ffmpeg build, and the result is a real,
   * universally-playable mp4 container (unlike a webm renamed `.mp3`, which is
   * exactly how previously "other players showed no metadata").
   */
  private fun transcodeToM4a(
    source: File,
    target: File,
    title: String?,
    artist: String?,
    album: String?,
    cover: File?,
  ): Boolean {
    return try {
      val coverArgs = if (cover != null && cover.isFile) {
        listOf("-i", cover.absolutePath, "-map", "0:a", "-map", "1:v",
          "-c:v", "mjpeg", "-disposition:v:0", "attached_pic")
      } else {
        listOf("-map", "0:a")
      }
      val res = runFfmpeg(
        listOf("-nostdin", "-y", "-i", source.absolutePath) +
          coverArgs +
          listOf("-codec:a", "aac", "-b:a", "192k") +
          metaArgs(title, artist, album) +
          listOf(target.absolutePath),
        300_000,
        downloadGate,
      )
      if (target.isFile && target.length() > 0L) {
        true
      } else {
        target.delete()
        Log.w(
          LOG_TAG,
          "m4a transcode produced no file (code=${res.code}) for ${source.name}: " +
            res.stderr.trim().take(600)
        )
        false
      }
    } catch (e: Exception) {
      Log.w(LOG_TAG, "m4a transcode failed: ${e.message}")
      target.delete()
      false
    }
  }

  private fun transcodeToMp3(
    source: File,
    target: File,
    title: String?,
    artist: String?,
    album: String?,
    cover: File?,
  ): Boolean {
    return try {
      val coverArgs = if (cover != null && cover.isFile) {
        listOf("-i", cover.absolutePath, "-map", "0:a", "-map", "1:v", "-c:v", "mjpeg",
          "-id3v2_version", "3",
          "-metadata:s:v", "title=Album cover", "-metadata:s:v", "comment=Cover (front)")
      } else {
        listOf("-map", "0:a")
      }
      val res = runFfmpeg(
        listOf("-nostdin", "-y", "-i", source.absolutePath) +
          coverArgs +
          listOf("-codec:a", "libmp3lame", "-b:a", "192k") +
          metaArgs(title, artist, album) +
          listOf(target.absolutePath),
        300_000,
        downloadGate,
      )
      if (target.isFile && target.length() > 0L) {
        true
      } else {
        target.delete()
        Log.w(
          LOG_TAG,
          "mp3 transcode produced no file (code=${res.code}) for ${source.name}: " +
            res.stderr.trim().take(600)
        )
        false
      }
    } catch (e: Exception) {
      Log.w(LOG_TAG, "mp3 transcode failed, keeping original container: ${e.message}")
      target.delete()
      false
    }
  }

  /**
   * Rewrites ID3 tags onto an mp3 that needs no transcoding (lossless
   * `-c copy` remux). Best-effort: false leaves the file untouched and the
   * download still succeeds.
   */
  private fun tagMp3InPlace(file: File, title: String?, artist: String?, album: String?): Boolean {
    if (title.isNullOrBlank() && artist.isNullOrBlank() && album.isNullOrBlank()) return true
    return try {
      val tmp = File.createTempFile("tagged", ".mp3", file.parentFile)
      runFfmpeg(
        listOf("-nostdin", "-y", "-i", file.absolutePath, "-c", "copy") +
          metaArgs(title, artist, album) +
          listOf(tmp.absolutePath),
        120_000,
        downloadGate,
      )
      if (tmp.isFile && tmp.length() > 0L) {
        tmp.copyTo(file, overwrite = true)
        tmp.delete()
        true
      } else {
        tmp.delete()
        false
      }
    } catch (e: Exception) {
      Log.w(LOG_TAG, "in-place tagging failed: ${e.message}")
      false
    }
  }

  /** Reads the real length of the finished file off ffmpeg's `-i` header dump. */
  private fun probeAudioDuration(file: File): Long = SincAudioProbe.probeDuration(file)

  /** Frustration cap: even a slow mobile link finishes a song in this budget. */
  private val downloadTimeoutMs = 900_000L

  /**
   * Runs the bundled ffmpeg directly (ffmpeg is not a python zipapp, so the
   * generic run() helper — which always execs python3 + yt-dlp.zipapp — cannot
   * be used here).
   */
  private fun runFfmpeg(args: List<String>, timeoutMs: Long, gate: Semaphore): RunResult {
    val first = runFfmpegOnce(args, timeoutMs, gate, preloadShim = false)
    val stderr = first.stderr.trim()
    if (first.code != 0 && stderr.contains("CANNOT LINK")) {
      // Vendor libs pulled transitively (e.g. libhwui → libmediandk) match
      // needed children by DT_SONAME under bionic. Preload the platform
      // namespace shim first so the forwarding stubs bind before anything
      // scans them.
      Log.w(LOG_TAG, "ffmpeg link partial; retrying with platform-ns shim: ${stderr.take(300)}")
      val second = runFfmpegOnce(args, timeoutMs, gate, preloadShim = true)
      if (second.code == 0) {
        return second
      }
      // Last resort: the pre-fix environment (app lib dir only), which is the
      // configuration the stub set was originally laid out for.
      Log.w(LOG_TAG, "shim retry failed; retrying with app-libdir-only LD_LIBRARY_PATH")
      return runFfmpegOnce(args, timeoutMs, gate, preloadShim = false, appLibDirOnly = true)
    }
    return first
  }

  private fun runFfmpegOnce(
    args: List<String>,
    timeoutMs: Long,
    gate: Semaphore,
    preloadShim: Boolean,
    appLibDirOnly: Boolean = false,
  ): RunResult {
    gate.acquire()
    return try {
      val pb = ProcessBuilder(listOf(ffmpegBinary().absolutePath) + args)
      pb.redirectErrorStream(false)
      pb.environment().apply {
        // The bundled termux-style libs resolve their siblings from the app
        // lib dir; system paths only satisfy leaf platform expects. App libs
        // stay FIRST so the forwarding stubs (libmediandk.so etc.) are what
        // the linker binds — the real platform copies live in a namespace
        // the exec cannot reach.
        put(
          "LD_LIBRARY_PATH",
          if (appLibDirOnly) libDir().absolutePath else
            "${libDir().absolutePath}:/system/lib64:/system_ext/lib64:/vendor/lib64",
        )
        if (preloadShim) {
          put("LD_PRELOAD", File(libDir(), "libtermux-platform-ns.so").absolutePath)
        }
        put("PATH", "${abiDir().absolutePath}:/system/bin:/system/xbin")
      }
      val process = pb.start()
      val stdout = ProcessStreamReader(process.inputStream)
      val stderr = ProcessStreamReader(process.errorStream)
      val finished = process.waitFor(timeoutMs, TimeUnit.MILLISECONDS)
      if (!finished) {
        process.destroyForcibly()
        throw IllegalStateException("ffmpeg timed out")
      }
      RunResult(stdout.read(), stderr.read(), process.exitValue())
    } catch (e: InterruptedException) {
      Thread.currentThread().interrupt()
      throw IllegalStateException("ffmpeg interrupted")
    } finally {
      gate.release()
    }
  }

  private fun onDownloadProgress(jobId: String?, line: String) {
    if (jobId == null) return
    val match = Regex("\\[download\\]\\s+([0-9.]+)%").find(line)
    val pct = match?.groupValues?.getOrNull(1)?.toDoubleOrNull()?.toInt() ?: return
    // yt-dlp --newline lines look like:
    // `[download] 12.4% of 8.32MiB at 214.55KiB/s ETA 00:34`
    val speed = Regex("at\\s+([0-9.]+\\s*[KMGT]?i?B/s)").find(line)?.groupValues?.getOrNull(1)
    Log.d(LOG_TAG, "yt progress jobId=$jobId pct=$pct speed=$speed")
    SincDownloads.update(jobId, pct)
    SincDownloads.emitYtProgress(jobId, pct, speed?.replace("\\s+".toRegex(), " "))
  }

  // ---------------------------------------------------------------------
  // Track matching (mirror apps/server/src/lib/track-match.ts)
  // ---------------------------------------------------------------------
  // All scoring/gating lives in SincTrackMatch (pure, unit-tested). Only
  // thin helpers remain here.

  private fun searchTitle(title: String): String = SincTrackMatch.searchTitle(title)

  private fun hasForbiddenVariant(query: String, resultTitle: String): Boolean =
    SincTrackMatch.hasForbiddenVariant(query, resultTitle)

  private fun isUnwantedLive(query: String, resultTitle: String): Boolean =
    SincTrackMatch.isUnwantedLive(query, resultTitle)
}