package com.sinc.app.modules

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SincFingerprintTest {

  private fun signal(
    seconds: Double,
    seed: Int,
    noise: Double = 0.0,
    frequencyOffset: Double = 0.0,
  ): ShortArray {
    val rate = SincFingerprint.SAMPLE_RATE
    val size = (seconds * rate).toInt()
    val out = ShortArray(size)
    val random = java.util.Random(seed.toLong())
    var p1 = 0.0
    var p2 = 0.0
    var p3 = 0.0
    for (i in 0 until size) {
      val t = i.toDouble() / rate
      val f1 = 220.0 + frequencyOffset + 80.0 * sin(2 * PI * 0.17 * t)
      val f2 = 440.0 + frequencyOffset + 160.0 * sin(2 * PI * 0.11 * t + 1.0)
      val f3 = 880.0 + frequencyOffset + 300.0 * sin(2 * PI * 0.07 * t + 2.0)
      p1 += 2 * PI * f1 / rate
      p2 += 2 * PI * f2 / rate
      p3 += 2 * PI * f3 / rate
      val envelope = 0.55 + 0.25 * sin(2 * PI * 0.33 * t)
      var sample = envelope * (0.5 * sin(p1) + 0.3 * sin(p2) + 0.2 * sin(p3))
      if (noise > 0) sample += noise * (random.nextDouble() * 2 - 1)
      out[i] = (sample * 12_000).toInt().coerceIn(-32_768, 32_767).toShort()
    }
    return out
  }

  private fun slice(samples: ShortArray, startSeconds: Double, seconds: Double): ShortArray {
    val rate = SincFingerprint.SAMPLE_RATE
    val start = (startSeconds * rate).toInt()
    val length = (seconds * rate).toInt()
    return samples.copyOfRange(start, start + length)
  }

  @Test
  fun `finds the preview position inside the full track`() {
    val full = signal(30.0, seed = 7)
    val preview = slice(full, startSeconds = 7.13, seconds = 8.0)
    val reference = SincFingerprint.fingerprint(preview)
    val candidate = SincFingerprint.fingerprint(full)
    val match = SincFingerprint.match(reference, candidate)
    assertTrue("expected a match, got $match", SincFingerprint.isMatch(match))
    val expectedOffset = (7.13 * SincFingerprint.SAMPLE_RATE / SincFingerprint.HOP_SIZE).toInt()
    assertTrue(
      "offset ${match.offsetFrames} should be near $expectedOffset",
      abs(match.offsetFrames - expectedOffset) <= 2,
    )
  }

  @Test
  fun `survives added noise and a level change`() {
    val full = signal(30.0, seed = 11)
    val preview = slice(full, startSeconds = 12.4, seconds = 8.0)
    val noisy = ShortArray(full.size) { i ->
      val base = full[i].toInt()
      val noise = ((i * 1103515245 + 12345) % 1600) - 800
      ((base * 0.7).toInt() + noise).coerceIn(-32_768, 32_767).toShort()
    }

    val match = SincFingerprint.match(
      SincFingerprint.fingerprint(preview),
      SincFingerprint.fingerprint(noisy),
    )
    assertTrue("expected a noisy match, got $match", SincFingerprint.isMatch(match))
  }

  @Test
  fun `rejects a different recording`() {
    val requested = signal(30.0, seed = 3)
    val preview = slice(requested, startSeconds = 9.0, seconds = 8.0)
    val other = signal(30.0, seed = 4, frequencyOffset = 170.0)

    val match = SincFingerprint.match(
      SincFingerprint.fingerprint(preview),
      SincFingerprint.fingerprint(other),
    )
    assertFalse("different audio must not match, got $match", SincFingerprint.isMatch(match))
  }

  @Test
  fun `rejects a short preview against a different song`() {
    val preview = slice(signal(20.0, seed = 21), startSeconds = 2.0, seconds = 5.0)
    val other = signal(20.0, seed = 22, frequencyOffset = 250.0)

    val match = SincFingerprint.match(
      SincFingerprint.fingerprint(preview),
      SincFingerprint.fingerprint(other),
    )
    assertFalse(SincFingerprint.isMatch(match))
  }

  @Test
  fun `silence produces no hashes`() {
    assertEquals(0, SincFingerprint.fingerprint(ShortArray(16_000)).size)
  }
}
