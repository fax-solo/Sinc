package com.sinc.app.modules

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SincProgressParserTest {

  @Test
  fun `parses structured yt-dlp progress`() {
    val update = SincProgressParser.parse(
      "SINC_PROGRESS {\"status\":\"downloading\",\"downloaded_bytes\":1024," +
        "\"total_bytes\":4096,\"speed\":214550.0,\"_speed_str\":\" 209.5KiB/s\"," +
        "\"_percent\":25.0}"
    )
    assertEquals(25, update?.percent)
    assertEquals(1024L, update?.bytesDownloaded)
    assertEquals(4096L, update?.bytesTotal)
    assertEquals(214550.0, update?.speedBytesPerSec ?: 0.0, 0.01)
    assertEquals("209.5KiB/s", update?.speedText)
    assertFalse(update?.finished ?: true)
  }

  @Test
  fun `finished progress caps below completion`() {
    val update = SincProgressParser.parse(
      "SINC_PROGRESS {\"status\":\"finished\",\"downloaded_bytes\":4096," +
        "\"total_bytes\":4096,\"_percent\":100.0}"
    )
    assertEquals(99, update?.percent)
    assertTrue(update?.finished ?: false)
  }

  @Test
  fun `unknown total stays indeterminate`() {
    val update = SincProgressParser.parse(
      "SINC_PROGRESS {\"status\":\"downloading\",\"downloaded_bytes\":2048," +
        "\"total_bytes\":null,\"speed\":null}"
    )
    assertNull(update?.percent)
    assertEquals(2048L, update?.bytesDownloaded)
    assertNull(update?.bytesTotal)
  }

  @Test
  fun `uses total estimate when exact size is absent`() {
    val update = SincProgressParser.parse(
      "SINC_PROGRESS {\"status\":\"downloading\",\"downloaded_bytes\":500," +
        "\"total_bytes_estimate\":2000.0,\"_percent\":25.0}"
    )
    assertEquals(25, update?.percent)
    assertEquals(2000L, update?.bytesTotal)
  }

  @Test
  fun `malformed and unrelated lines are ignored`() {
    assertNull(SincProgressParser.parse("SINC_PROGRESS {\"status\":"))
    assertNull(SincProgressParser.parse("[download] Destination: song.mp3"))
    assertNull(SincProgressParser.parse(""))
    assertNull(SincProgressParser.parse("SINC_PROGRESS {\"status\":\"error\"}"))
  }

  @Test
  fun `legacy human line remains a fallback`() {
    val update = SincProgressParser.parse(
      "[download]  12.4% of 8.32MiB at 214.55KiB/s ETA 00:34"
    )
    assertEquals(12, update?.percent)
    assertEquals("214.55KiB/s", update?.speedText)
    assertNull(update?.bytesTotal)
    assertFalse(update?.finished ?: true)
  }
}
