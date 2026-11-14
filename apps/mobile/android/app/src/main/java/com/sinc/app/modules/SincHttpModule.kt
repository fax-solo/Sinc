package com.sinc.app.modules

import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import java.util.zip.GZIPInputStream

/**
 * Plain HTTP GET for third-party provider APIs (`NativeModules.SincHttp`).
 *
 * React Native's Android networking stack stamps every `fetch` with OkHttp's
 * default `User-Agent: okhttp/4.x`, and it is not overridable from JS. Several
 * public APIs fronted by Cloudflare (LRCLIB being one) reject that UA with an
 * HTTP 520, so lyrics lookups fail while the same request from curl succeeds.
 * This module does the request with [HttpURLConnection] so the provider's own
 * `User-Agent` is honoured. Responses never touch our own servers.
 *
 * Unlike the old version, the JS timeout is honoured, a watchdog enforces the
 * deadline even while blocked in DNS/connect/read, and the response body is
 * size-capped so a misbehaving provider cannot exhaust app memory.
 */
class SincHttpModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "SincHttp"

  private val executor = Executors.newFixedThreadPool(4)
  private val watchdog: ScheduledExecutorService =
    Executors.newSingleThreadScheduledExecutor { r ->
      Thread(r, "sinc-http-timeout").apply { isDaemon = true }
    }

  /**
   * Performs a GET and resolves with `{ status, body, contentType }`. Rejects
   * with `HTTP_TIMEOUT` on the overall deadline and `HTTP_ERROR` on other
   * transport failures; non-2xx statuses resolve so JS can branch on them the
   * same way it does with `fetch`.
   */
  @ReactMethod
  fun get(url: String, userAgent: String, accept: String?, timeoutMs: Double, promise: Promise) {
    val timeout = timeoutMs
      .takeIf { it.isFinite() && it > 0.0 }
      ?.toLong()
      ?.coerceIn(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)
      ?: DEFAULT_TIMEOUT_MS
    val connectionRef = AtomicReference<HttpURLConnection?>(null)
    val settled = AtomicBoolean(false)
    // Start the deadline before queueing. A saturated executor must not let a
    // request sit past the caller's timeout without any signal.
    val deadlineTask = watchdog.schedule({
      if (settled.compareAndSet(false, true)) {
        try {
          connectionRef.get()?.disconnect()
        } catch (_: Exception) {
        }
        promise.reject("HTTP_TIMEOUT", "Provider request timed out after ${timeout}ms")
      }
    }, timeout, TimeUnit.MILLISECONDS)
    try {
      executor.execute {
        if (settled.get()) return@execute
        try {
          val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = minOf(timeout, 10_000L).toInt()
            readTimeout = minOf(timeout, 15_000L).toInt()
            instanceFollowRedirects = true
            setRequestProperty("User-Agent", userAgent)
            setRequestProperty("Accept-Encoding", "gzip")
            if (!accept.isNullOrBlank()) setRequestProperty("Accept", accept)
          }
          connectionRef.set(connection)
          val status = connection.responseCode
          val contentType = connection.contentType
          // inputStream throws on >=400, so pick the stream by status code.
          // getErrorStream() may be null (e.g. HEAD/204), hence the fallback.
          val raw: BufferedInputStream? = try {
            if (status in 200..299) {
              connection.inputStream?.let { BufferedInputStream(it) }
            } else {
              (connection.errorStream ?: connection.inputStream)?.let { BufferedInputStream(it) }
            }
          } catch (e: Exception) {
            try {
              connection.errorStream?.let { BufferedInputStream(it) }
            } catch (e2: Exception) {
              null
            }
          }
          // The server gzips because we send `Accept-Encoding: gzip`; that is
          // signalled via Content-Encoding, NOT Content-Type (old code checked
          // contentType, so every gzipped JSON/HTML came back as binary garbage
          // and JSON.parse / __NEXT_DATA__ parsing failed on-device).
          val encoding = try {
            connection.contentEncoding ?: connection.getHeaderField("Content-Encoding")
          } catch (e: Exception) {
            null
          }
          val text = if (raw == null) {
            ""
          } else {
            val decoded: InputStream =
              if (encoding?.contains("gzip", ignoreCase = true) == true) {
                GZIPInputStream(raw)
              } else {
                raw
              }
            decoded.use { readLimited(it, MAX_RESPONSE_BYTES) }
          }
          if (settled.compareAndSet(false, true)) {
            val result = Arguments.createMap()
            result.putInt("status", status)
            result.putString("body", text)
            if (contentType != null) result.putString("contentType", contentType)
            promise.resolve(result)
          }
        } catch (e: Exception) {
          if (settled.compareAndSet(false, true)) {
            val message = if (e is SocketTimeoutException) {
              "Provider request timed out after ${timeout}ms"
            } else {
              e.message
            }
            Log.e(LOG_TAG, "GET failed for $url: $message", e)
            promise.reject(if (e is SocketTimeoutException) "HTTP_TIMEOUT" else "HTTP_ERROR", message)
          }
        } finally {
          deadlineTask.cancel(false)
          connectionRef.get()?.disconnect()
        }
      }
    } catch (e: Exception) {
      deadlineTask.cancel(false)
      if (settled.compareAndSet(false, true)) {
        promise.reject("HTTP_ERROR", e.message)
      }
    }
  }

  private fun readLimited(input: InputStream, maxBytes: Int): String {
    val out = ByteArrayOutputStream()
    val buffer = ByteArray(16 * 1024)
    var total = 0
    while (true) {
      val read = input.read(buffer)
      if (read < 0) break
      total += read
      if (total > maxBytes) {
        throw IOException("Provider response exceeded ${maxBytes / (1024 * 1024)} MiB")
      }
      out.write(buffer, 0, read)
    }
    return out.toString(Charsets.UTF_8.name())
  }

  companion object {
    private const val LOG_TAG = "SincHttp"
    private const val DEFAULT_TIMEOUT_MS = 10_000L
    private const val MIN_TIMEOUT_MS = 1_000L
    private const val MAX_TIMEOUT_MS = 120_000L
    private const val MAX_RESPONSE_BYTES = 8 * 1024 * 1024
  }
}
