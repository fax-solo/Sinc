package com.sinc.app.modules

import com.sinc.app.modules.SincDownloadRules.isDurationAcceptable
import com.sinc.app.modules.SincDownloadRules.resolveCacheKey
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SincDownloadRulesTest {

  @Test
  fun acceptsExactAndShortIntroOrOutroDifferences() {
    assertTrue(isDurationAcceptable(180_000, 180_000))
    assertTrue(isDurationAcceptable(174_000, 175_000))
    assertTrue(isDurationAcceptable(176_170, 175_000))
  }

  @Test
  fun rejectsWrongRecordingsThatAreRoughlySongLength() {
    // The old 0.5x-2x window accepted both of these.
    assertFalse(isDurationAcceptable(198_000, 210_000)) // 1920s re-upload, 12s off
    assertFalse(isDurationAcceptable(215_570, 175_000)) // unrelated podcast, 40s off
    assertFalse(isDurationAcceptable(210_000, 175_000)) // exactly 1.2x
  }

  @Test
  fun rejectsPreviewsAndFailedProbes() {
    assertFalse(isDurationAcceptable(30_000, 180_000))
    assertFalse(isDurationAcceptable(0, 180_000))
    assertFalse(isDurationAcceptable(44_999, 44_999))
  }

  @Test
  fun unknownExpectedDurationKeepsTheHourLoopGuard() {
    assertTrue(isDurationAcceptable(10 * 60 * 1000L, null))
    assertFalse(isDurationAcceptable(25 * 60 * 1000L, null))
    assertFalse(isDurationAcceptable(0, null))
  }

  @Test
  fun cacheKeysSeparateModeAndDuration() {
    val base = resolveCacheKey("artist - song", 175_000L, strict = false)
    assertEquals(base, resolveCacheKey("artist - song", 175_000L, strict = false))
    assertNotEquals(base, resolveCacheKey("artist - song", 175_000L, strict = true))
    assertNotEquals(base, resolveCacheKey("artist - song", 176_000L, strict = false))
  }
}
