package com.sinc.app.modules

import android.content.Context
import android.media.MediaScannerConnection
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileOutputStream
import java.io.IOException

/**
 * Native bridge for persistent profile, library, and downloaded songs backup.
 * Files are stored in public external storage (Music/Sinc) so they survive
 * app uninstallation, reinstallation, and updates.
 */
class SincBackupModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "SincBackup"

  companion object {
    private const val LOG_TAG = "SincBackup"
    private const val BACKUP_FILE_NAME = ".sinc_backup.json"
    private const val PUBLIC_BACKUP_NAME = "sinc_backup.json"
    private val AUDIO_EXTENSIONS = setOf("mp3", "m4a", "webm", "opus", "flac", "aac", "wav", "ogg")
  }

  private fun getMusicSincDir(): File {
    val musicDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC)
    val sincDir = File(musicDir, "Sinc")
    if (!sincDir.exists()) {
      sincDir.mkdirs()
    }
    return sincDir
  }

  private fun getDocumentsSincDir(): File? {
    return try {
      val docsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS)
      val sincDir = File(docsDir, "Sinc")
      if (!sincDir.exists()) {
        sincDir.mkdirs()
      }
      sincDir
    } catch (_: Exception) {
      null
    }
  }

  private fun getInternalDir(): File {
    return reactApplicationContext.filesDir
  }

  @ReactMethod
  fun saveBackup(jsonString: String, promise: Promise) {
    Thread {
      try {
        val sincDir = getMusicSincDir()
        val targetFile = File(sincDir, BACKUP_FILE_NAME)
        val publicCopyFile = File(sincDir, PUBLIC_BACKUP_NAME)
        val tempFile = File(sincDir, "$BACKUP_FILE_NAME.tmp")

        // Atomic write via temp file
        FileOutputStream(tempFile).use { out ->
          out.write(jsonString.toByteArray(Charsets.UTF_8))
          out.flush()
        }

        if (targetFile.exists()) {
          targetFile.delete()
        }
        val renamed = tempFile.renameTo(targetFile)
        if (!renamed) {
          // Fallback if atomic rename fails across partitions
          tempFile.copyTo(targetFile, overwrite = true)
          tempFile.delete()
        }

        // Also write the visible public copy for ease of user inspection/backup
        try {
          targetFile.copyTo(publicCopyFile, overwrite = true)
        } catch (_: Exception) {}

        // Secondary fallback to Documents/Sinc
        try {
          getDocumentsSincDir()?.let { docsDir ->
            targetFile.copyTo(File(docsDir, BACKUP_FILE_NAME), overwrite = true)
          }
        } catch (_: Exception) {}

        // App-internal fallback copy as well
        try {
          targetFile.copyTo(File(getInternalDir(), BACKUP_FILE_NAME), overwrite = true)
        } catch (_: Exception) {}

        // Trigger MediaScanner so files are registered with the OS
        try {
          MediaScannerConnection.scanFile(
            reactApplicationContext,
            arrayOf(targetFile.absolutePath, publicCopyFile.absolutePath),
            arrayOf("application/json", "application/json"),
            null
          )
        } catch (_: Exception) {}

        Log.i(LOG_TAG, "Backup saved successfully to ${targetFile.absolutePath} (${targetFile.length()} bytes)")

        val result = Arguments.createMap().apply {
          putBoolean("success", true)
          putString("path", targetFile.absolutePath)
          putDouble("timestamp", targetFile.lastModified().toDouble())
          putDouble("sizeBytes", targetFile.length().toDouble())
        }
        promise.resolve(result)
      } catch (e: Exception) {
        Log.e(LOG_TAG, "Failed to save backup: ${e.message}", e)
        promise.reject("BACKUP_SAVE_ERROR", e.message ?: "Failed to save backup", e)
      }
    }.start()
  }

  @ReactMethod
  fun readBackup(promise: Promise) {
    Thread {
      try {
        val candidates = listOfNotNull(
          File(getMusicSincDir(), BACKUP_FILE_NAME),
          File(getMusicSincDir(), PUBLIC_BACKUP_NAME),
          getDocumentsSincDir()?.let { File(it, BACKUP_FILE_NAME) },
          File(getInternalDir(), BACKUP_FILE_NAME)
        )

        var foundFile: File? = null
        for (file in candidates) {
          if (file.exists() && file.isFile && file.length() > 0) {
            foundFile = file
            break
          }
        }

        if (foundFile == null) {
          val result = Arguments.createMap().apply {
            putBoolean("exists", false)
          }
          promise.resolve(result)
          return@Thread
        }

        val json = foundFile.readText(Charsets.UTF_8)
        Log.i(LOG_TAG, "Read backup from ${foundFile.absolutePath} (${foundFile.length()} bytes)")

        val result = Arguments.createMap().apply {
          putBoolean("exists", true)
          putString("data", json)
          putString("path", foundFile.absolutePath)
          putDouble("timestamp", foundFile.lastModified().toDouble())
          putDouble("sizeBytes", foundFile.length().toDouble())
        }
        promise.resolve(result)
      } catch (e: Exception) {
        Log.e(LOG_TAG, "Failed to read backup: ${e.message}", e)
        promise.reject("BACKUP_READ_ERROR", e.message ?: "Failed to read backup", e)
      }
    }.start()
  }

  @ReactMethod
  fun scanDownloadedFiles(promise: Promise) {
    Thread {
      try {
        val sincDir = getMusicSincDir()
        val filesArray = Arguments.createArray()

        if (sincDir.exists() && sincDir.isDirectory) {
          val files = sincDir.listFiles() ?: emptyArray()
          for (file in files) {
            if (file.isFile && file.length() > 0) {
              val ext = file.extension.lowercase()
              if (AUDIO_EXTENSIONS.contains(ext)) {
                val item = Arguments.createMap().apply {
                  putString("fileName", file.name)
                  putString("uri", "file://${file.absolutePath}")
                  putDouble("sizeBytes", file.length().toDouble())
                  putDouble("lastModified", file.lastModified().toDouble())
                }
                filesArray.pushMap(item)
              }
            }
          }
        }

        promise.resolve(filesArray)
      } catch (e: Exception) {
        Log.e(LOG_TAG, "Failed to scan downloaded files: ${e.message}", e)
        promise.reject("SCAN_ERROR", e.message ?: "Failed to scan files", e)
      }
    }.start()
  }

  @ReactMethod
  fun getStorageStats(promise: Promise) {
    Thread {
      try {
        val sincDir = getMusicSincDir()
        var sincBytes = 0L
        var songCount = 0

        if (sincDir.exists() && sincDir.isDirectory) {
          sincDir.listFiles()?.forEach { file ->
            if (file.isFile) {
              sincBytes += file.length()
              if (AUDIO_EXTENSIONS.contains(file.extension.lowercase())) {
                songCount++
              }
            }
          }
        }

        val stat = StatFs(Environment.getExternalStorageDirectory().path)
        val totalBytes = stat.blockCountLong * stat.blockSizeLong
        val freeBytes = stat.availableBlocksLong * stat.blockSizeLong

        val result = Arguments.createMap().apply {
          putDouble("totalBytes", totalBytes.toDouble())
          putDouble("freeBytes", freeBytes.toDouble())
          putDouble("usedBytes", (totalBytes - freeBytes).toDouble())
          putDouble("sincBytes", sincBytes.toDouble())
          putInt("songCount", songCount)
        }
        promise.resolve(result)
      } catch (e: Exception) {
        Log.e(LOG_TAG, "Failed to get storage stats: ${e.message}", e)
        promise.reject("STORAGE_STATS_ERROR", e.message ?: "Failed to get stats", e)
      }
    }.start()
  }

  @ReactMethod
  fun clearDownloadCache(promise: Promise) {
    Thread {
      try {
        var freedBytes = 0L
        val internalDirs = listOf(
          File(reactApplicationContext.filesDir, "sinc_downloads"),
          File(reactApplicationContext.filesDir, "sinc_yt"),
          reactApplicationContext.cacheDir
        )

        for (dir in internalDirs) {
          if (dir.exists() && dir.isDirectory) {
            dir.listFiles()?.forEach { file ->
              if (file.isFile && (file.name.endsWith(".part") || file.name.endsWith(".tmp") || file.name.endsWith(".ytdl"))) {
                freedBytes += file.length()
                file.delete()
              }
            }
          }
        }

        val result = Arguments.createMap().apply {
          putBoolean("success", true)
          putDouble("freedBytes", freedBytes.toDouble())
        }
        promise.resolve(result)
      } catch (e: Exception) {
        promise.reject("CACHE_CLEAR_ERROR", e.message ?: "Failed to clear cache", e)
      }
    }.start()
  }
}
