package com.sinc.app.modules

import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.BufferedInputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
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
 */
class SincHttpModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "SincHttp"

  private val executor = Executors.newFixedThreadPool(4)

  /**
   * Performs a GET and resolves with `{ status, body, contentType }`. Rejects
   * with code `HTTP_ERROR` only on transport failures; non-2xx statuses resolve
   * so JS can branch on them the same way it does with `fetch`.
   */
  @ReactMethod
  fun get(url: String, userAgent: String, accept: String?, promise: Promise) {
    executor.execute {
      var connection: HttpURLConnection? = null
      try {
        connection = (URL(url).openConnection() as HttpURLConnection).apply {
          requestMethod = "GET"
          connectTimeout = 10_000
          readTimeout = 15_000
          instanceFollowRedirects = true
          setRequestProperty("User-Agent", userAgent)
          setRequestProperty("Accept-Encoding", "gzip")
          if (!accept.isNullOrBlank()) setRequestProperty("Accept", accept)
        }
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
          val decoded =
            if (encoding?.contains("gzip", ignoreCase = true) == true) {
              GZIPInputStream(raw)
            } else {
              raw
            }
          decoded.use { it.readBytes().toString(Charsets.UTF_8) }
        }
        val result = Arguments.createMap()
        result.putInt("status", status)
        result.putString("body", text)
        if (contentType != null) result.putString("contentType", contentType)
        promise.resolve(result)
      } catch (e: Exception) {
        Log.e(LOG_TAG, "GET failed for $url: ${e.message}", e)
        promise.reject("HTTP_ERROR", e.message)
      } finally {
        connection?.disconnect()
      }
    }
  }

  companion object {
    private const val LOG_TAG = "SincHttp"
  }
}
