package com.sinc.app.modules

import android.system.Os
import android.util.Log
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Semaphore

/**
 * Best-effort, quality-preserving tagging for direct HTTPS downloads.
 *
 * The old direct path published the raw provider bytes with no ID3/MP4 tags
 * and always under an `.mp3` name. Here every supported container is remuxed
 * with `-c:a copy` (no re-encode) and the metadata/cover atoms are written to
 * a sibling temp file, then atomically renamed over the original.
 */
object SincMediaTagger {
  private const val LOG_TAG = "SincMediaTagger"
  private const val MAX_COVER_BYTES = 8L * 1024L * 1024L
  private const val TAG_TIMEOUT_MS = 120_000L

  private val gate = Semaphore(2)

  /** Returns the MIME type of the (possibly tagged) file. */
  fun tagInPlace(
    file: File,
    title: String?,
    artist: String?,
    album: String?,
    artworkUrl: String?,
  ): String {
    if (!file.isFile || file.length() == 0L) {
      return SincAudioContainer.mimeForExtension(file.extension)
    }
    val extension = SincAudioContainer.normalizeExtension(file.extension)
    val hasMetadata = !title.isNullOrBlank() || !artist.isNullOrBlank() || !album.isNullOrBlank()
    if (!hasMetadata && artworkUrl.isNullOrBlank()) {
      return SincAudioContainer.mimeForExtension(extension)
    }
    val cover = downloadCover(artworkUrl, file.parentFile)
    if (cover == null && !hasMetadata) return SincAudioContainer.mimeForExtension(extension)
    try {
      val ok = when (extension) {
        "mp3" -> remux(file, cover, title, artist, album, id3 = true)
        "m4a", "flac" -> remux(file, cover, title, artist, album, id3 = false)
        // Ogg/Opus/WebM do not support a portable attached-picture atom; write
        // text metadata losslessly and leave the existing bytes intact.
        "ogg", "opus", "webm", "wav" ->
          remux(file, cover = null, title = title, artist = artist, album = album, id3 = false)
        else -> false
      }
      if (!ok) Log.w(LOG_TAG, "tagging skipped/failed for ${file.name}")
    } catch (e: Exception) {
      Log.w(LOG_TAG, "tagging failed for ${file.name}: ${e.message}")
    } finally {
      cover?.delete()
    }
    return SincAudioContainer.mimeForExtension(file.extension)
  }

  /**
   * Lossless MP3 cover/tag remux used by the yt-dlp path instead of
   * `libmp3lame -b:a 192k`. The caller owns `cover` and deletes it.
   */
  fun remuxMp3WithCover(
    source: File,
    target: File,
    title: String?,
    artist: String?,
    album: String?,
    cover: File?,
  ): Boolean {
    if (source.canonicalPath == target.canonicalPath) return false
    return remux(source, cover, title, artist, album, id3 = true, output = target)
  }

  private fun remux(
    source: File,
    cover: File?,
    title: String?,
    artist: String?,
    album: String?,
    id3: Boolean,
    output: File? = null,
  ): Boolean {
    val extension = SincAudioContainer.normalizeExtension(source.extension)
    val target = output ?: File.createTempFile("sinc-tag-", ".$extension", source.parentFile)
    try {
      val args = mutableListOf<String>()
      args += listOf("-nostdin", "-y", "-i", source.absolutePath)
      if (cover != null && cover.isFile) {
        args += listOf("-i", cover.absolutePath, "-map", "0:a", "-map", "1:v", "-c:a", "copy")
        args += listOf("-c:v", "mjpeg", "-disposition:v:0", "attached_pic")
        if (id3) {
          args += listOf(
            "-id3v2_version", "3",
            "-metadata:s:v", "title=Album cover",
            "-metadata:s:v", "comment=Cover (front)",
          )
        }
      } else {
        args += listOf("-map", "0:a", "-c:a", "copy")
      }
      args += listOf("-map_metadata", "0")
      if (!title.isNullOrBlank()) args += listOf("-metadata", "title=$title")
      if (!artist.isNullOrBlank()) args += listOf("-metadata", "artist=$artist")
      if (!album.isNullOrBlank()) args += listOf("-metadata", "album=$album")
      args += target.absolutePath

      val result = SincFfmpeg.run(args, TAG_TIMEOUT_MS, gate)
      if (result.code == 0 && target.isFile && target.length() > 0L) {
        if (output != null) return true
        return replace(target, source)
      }
      Log.w(
        LOG_TAG,
        "ffmpeg tag failed code=${result.code} for ${source.name}: " +
          result.stderr.trim().take(500),
      )
      if (output == null) target.delete()
      return false
    } catch (e: Exception) {
      Log.w(LOG_TAG, "ffmpeg tag error for ${source.name}: ${e.message}")
      if (output == null) target.delete()
      return false
    }
  }

  /**
   * Replaces `target` with the temp file atomically. `Os.rename` is the POSIX
   * rename used by Android; the copy fallback is only for unusual filesystems.
   */
  private fun replace(temp: File, target: File): Boolean {
    return try {
      Os.rename(temp.absolutePath, target.absolutePath)
      true
    } catch (_: Exception) {
      try {
        temp.copyTo(target, overwrite = true)
        temp.delete()
        true
      } catch (e: Exception) {
        Log.w(LOG_TAG, "atomic replace failed for ${target.name}: ${e.message}")
        temp.delete()
        false
      }
    }
  }

  private fun downloadCover(artworkUrl: String?, outDir: File?): File? {
    if (artworkUrl.isNullOrBlank() || outDir == null) return null
    return try {
      val conn = (URL(artworkUrl).openConnection() as HttpURLConnection).apply {
        requestMethod = "GET"
        connectTimeout = 10_000
        readTimeout = 15_000
        instanceFollowRedirects = true
        setRequestProperty("User-Agent", "Sinc/1.0 (music player)")
      }
      try {
        if (conn.responseCode !in 200..299) return null
        val contentType = (conn.contentType ?: "").lowercase()
        if (!contentType.startsWith("image/")) return null
        val ext = when {
          contentType.contains("png") -> ".png"
          contentType.contains("webp") -> ".webp"
          else -> ".jpg"
        }
        val tmp = File.createTempFile("cover", ext, outDir)
        conn.inputStream.use { input ->
          tmp.outputStream().use { output ->
            val buffer = ByteArray(16 * 1024)
            var total = 0L
            while (true) {
              val read = input.read(buffer)
              if (read < 0) break
              total += read
              if (total > MAX_COVER_BYTES) {
                tmp.delete()
                return null
              }
              output.write(buffer, 0, read)
            }
          }
        }
        if (tmp.length() > 0L) {
          tmp
        } else {
          tmp.delete()
          null
        }
      } finally {
        conn.disconnect()
      }
    } catch (e: Exception) {
      Log.w(LOG_TAG, "cover fetch failed: ${e.message}")
      null
    }
  }
}
