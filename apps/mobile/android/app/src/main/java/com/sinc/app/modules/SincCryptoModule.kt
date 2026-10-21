package com.sinc.app.modules

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/**
 * Native crypto primitives used by the app lock. PINs are hashed with
 * PBKDF2-HMAC-SHA256 (an actual KDF with an iteration cost) instead of a fast
 * non-cryptographic hash, so an offline brute force of a 4-6 digit PIN is no
 * longer trivial. Salts come from the platform CSPRNG, never Math.random.
 */
class SincCryptoModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "SincCrypto"

  companion object {
    private const val PBKDF2_ALGORITHM = "PBKDF2WithHmacSHA256"
    private val secureRandom = SecureRandom()
  }

  /** Derives keyLenBytes of PBKDF2-HMAC-SHA256 output from saltHex, hex-encoded. */
  @ReactMethod
  fun pbkdf2(password: String, saltHex: String, iterations: Int, keyLenBytes: Int, promise: Promise) {
    try {
      val salt = hexToBytes(saltHex)
      val spec = PBEKeySpec(password.toCharArray(), salt, iterations, keyLenBytes * 8)
      val key = SecretKeyFactory.getInstance(PBKDF2_ALGORITHM).generateSecret(spec)
      promise.resolve(bytesToHex(key.encoded))
    } catch (e: Exception) {
      promise.reject("CRYPTO_ERROR", e.message)
    }
  }

  /** Returns `length` cryptographically random bytes as hex. */
  @ReactMethod
  fun randomBytes(length: Int, promise: Promise) {
    try {
      val bytes = ByteArray(length)
      secureRandom.nextBytes(bytes)
      promise.resolve(bytesToHex(bytes))
    } catch (e: Exception) {
      promise.reject("CRYPTO_ERROR", e.message)
    }
  }

  private fun hexToBytes(hex: String): ByteArray {
    require(hex.length % 2 == 0) { "saltHex must have an even length" }
    return ByteArray(hex.length / 2) { i ->
      ((Character.digit(hex[i * 2], 16) shl 4) or Character.digit(hex[i * 2 + 1], 16)).toByte()
    }
  }

  private fun bytesToHex(bytes: ByteArray): String =
    bytes.joinToString("") { "%02x".format(it) }
}