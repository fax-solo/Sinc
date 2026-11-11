package com.sinc.app.modules

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SincAudioContainerTest {

  @Test
  fun `detects common audio containers from magic bytes`() {
    assertEquals("mp3", SincAudioContainer.detectExtension(byteArrayOf(0x49, 0x44, 0x33, 0x04)))
    assertEquals(
      "ogg",
      SincAudioContainer.detectExtension("OggS".toByteArray() + ByteArray(4)),
    )
    assertEquals(
      "flac",
      SincAudioContainer.detectExtension("fLaC".toByteArray() + ByteArray(4)),
    )
    assertEquals(
      "wav",
      SincAudioContainer.detectExtension("RIFF".toByteArray() + ByteArray(8)),
    )
    assertEquals(
      "webm",
      SincAudioContainer.detectExtension(byteArrayOf(0x1A, 0x45, 0xDF.toByte(), 0xA3.toByte())),
    )
    val ftyp = ByteArray(12)
    "ftyp".toByteArray().copyInto(ftyp, 4)
    assertEquals("m4a", SincAudioContainer.detectExtension(ftyp))
  }

  @Test
  fun `returns null for empty, short or unknown files`() {
    assertNull(SincAudioContainer.detectExtension(byteArrayOf(1, 2)))
    assertNull(SincAudioContainer.detectExtension(ByteArray(16)))
    val tmp = File.createTempFile("sinc-container", ".bin")
    try {
      assertNull(SincAudioContainer.detectExtension(tmp))
    } finally {
      tmp.delete()
    }
  }

  @Test
  fun `renames a mislabeled file to the detected container`() {
    val tmp = File.createTempFile("sinc-container", ".mp3")
    try {
      tmp.writeBytes("OggS".toByteArray() + ByteArray(8))
      val renamed = SincAudioContainer.retarget(tmp, "ogg")
      assertEquals("ogg", renamed.extension)
      assertEquals(false, tmp.exists())
      assertEquals(true, renamed.exists())
      renamed.delete()
    } finally {
      tmp.delete()
    }
  }

  @Test
  fun `normalizes extension and mime consistently`() {
    assertEquals("m4a", SincAudioContainer.normalizeExtension("mp4"))
    assertEquals("audio/mp4", SincAudioContainer.mimeForExtension("m4a"))
    assertEquals("audio/ogg", SincAudioContainer.mimeForExtension("oga"))
    assertEquals("audio/opus", SincAudioContainer.mimeForExtension("opus"))
    assertEquals("audio/flac", SincAudioContainer.mimeForExtension("flac"))
    assertEquals("audio/mpeg", SincAudioContainer.mimeForExtension("unknown"))
  }
}
