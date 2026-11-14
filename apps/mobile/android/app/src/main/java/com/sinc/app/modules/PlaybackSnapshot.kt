package com.sinc.app.modules

/**
 * Immutable transport snapshot emitted by [PlaybackService] and consumed by
 * JS. The native player owns the actual transport state; the JS player store
 * owns the queue and user intent. This is the single bridge between them.
 */
data class PlaybackSnapshot(
  val trackId: String?,
  val isPlaying: Boolean,
  val playbackState: String,
  val positionMs: Long,
  val durationMs: Long,
  val bufferedPositionMs: Long,
  val favorite: Boolean,
  val shuffle: Boolean,
  val repeat: String,
)
