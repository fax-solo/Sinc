package com.sinc.app.modules

import java.io.File

/**
 * Small, dependency-free container checks shared by both transfer paths.
 *
 * Providers and CDNs lie: Archive items named `.mp3` occasionally contain Ogg,
 * and extensionless direct URLs can return FLAC. The extension we publish must
 * describe the bytes we actually saved, not the URL or MIME header.
 */
object SincAudioContainer {
  private const val HEADER_BYTES = 16

  /** Returns one of mp3/ogg/oga/opus/m4a/flac/wav/webm/aac, or null. */
  fun detectExtension(file: File): String? {
    if (!file.isFile || file.length() <= 0L) return null
    val head = ByteArray(HEADER_BYTES)
    val read = try {
      file.inputStream().use { it.read(head) }
    } catch (_: Exception) {
      return null
    }
    if (read <= 0) return null
    return detectExtension(head.copyOf(read))
  }

  fun detectExtension(head: ByteArray): String? {
    if (head.size < 4) return null
    // ISO-BMFF: bytes 4..7 are "ftyp" (m4a/mp4).
    if (head.size >= 8 &&
      head[4] == 'f'.code.toByte() && head[5] == 't'.code.toByte() &&
      head[6] == 'y'.code.toByte() && head[7] == 'p'.code.toByte()
    ) {
      return "m4a"
    }
    if (head[0] == 'O'.code.toByte() && head[1] == 'g'.code.toByte() &&
      head[2] == 'g'.code.toByte() && head[3] == 'S'.code.toByte()
    ) {
      return "ogg"
    }
    if (head[0] == 'f'.code.toByte() && head[1] == 'L'.code.toByte() &&
      head[2] == 'a'.code.toByte() && head[3] == 'C'.code.toByte()
    ) {
      return "flac"
    }
    if (head[0] == 'R'.code.toByte() && head[1] == 'I'.code.toByte() &&
      head[2] == 'F'.code.toByte() && head[3] == 'F'.code.toByte()
    ) {
      return "wav"
    }
    // EBML/Matroska (WebM).
    if (head[0] == 0x1A.toByte() && head[1] == 0x45.toByte() &&
      head[2] == 0xDF.toByte() && head[3] == 0xA3.toByte()
    ) {
      return "webm"
    }
    // ADTS AAC: 12-bit sync 0xFFF and layer bits 00. Check before MPEG audio,
    // because both share the 0xFFF sync word.
    val b1 = head[1].toInt() and 0xFF
    if (head[0] == 0xFF.toByte() && (b1 and 0xF6) == 0xF0) return "aac"
    // MPEG audio frame sync (MP3). ID3-tagged files are caught here too after
    // the tag header, but an ID3 prefix is also a valid mp3 signature.
    if (head[0] == 'I'.code.toByte() && head[1] == 'D'.code.toByte() &&
      head[2] == '3'.code.toByte()
    ) {
      return "mp3"
    }
    if (head[0] == 0xFF.toByte() && (b1 and 0xE0) == 0xE0) return "mp3"
    return null
  }

  fun normalizeExtension(extension: String): String = when (extension.lowercase()) {
    "mp4", "m4b", "m4a" -> "m4a"
    "oga", "ogg" -> "ogg"
    "opus" -> "opus"
    "flac" -> "flac"
    "wav" -> "wav"
    "webm" -> "webm"
    "aac" -> "aac"
    else -> "mp3"
  }

  /** Renames `file` to the detected/normalized container extension. */
  fun retarget(file: File, extension: String): File {
    val normalized = normalizeExtension(extension)
    if (normalized == normalizeExtension(file.extension)) return file
    val renamed = File(file.parentFile, "${file.nameWithoutExtension}.$normalized")
    return try {
      if (renamed.exists()) renamed.delete()
      if (file.renameTo(renamed)) {
        renamed
      } else {
        file.copyTo(renamed, overwrite = true)
        file.delete()
        renamed
      }
    } catch (_: Exception) {
      file
    }
  }

  fun mimeForExtension(extension: String): String = when (normalizeExtension(extension)) {
    "m4a" -> "audio/mp4"
    "ogg" -> "audio/ogg"
    "opus" -> "audio/opus"
    "webm" -> "audio/webm"
    "aac" -> "audio/aac"
    "flac" -> "audio/flac"
    "wav" -> "audio/wav"
    else -> "audio/mpeg"
  }
}
