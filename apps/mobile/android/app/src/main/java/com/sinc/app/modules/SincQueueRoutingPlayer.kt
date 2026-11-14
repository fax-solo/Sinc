package com.sinc.app.modules

import androidx.annotation.OptIn
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi

/**
 * ExoPlayer only ever holds the currently resolved stream. The real queue
 * lives in the JS player store and each entry is resolved on demand, so the
 * native player cannot advertise a next/previous item of its own.
 *
 * This wrapper advertises the seek-to-next/previous commands to Media3 and
 * the system UI, then routes those commands back through the existing player
 * orchestration instead of silently doing nothing. That makes the standard
 * notification and lockscreen buttons show Previous and Next without creating
 * a second player or duplicating the queue natively.
 */
@OptIn(UnstableApi::class)
class SincQueueRoutingPlayer(
  delegate: Player,
  private val onSkip: (String) -> Unit,
) : ForwardingPlayer(delegate) {

  override fun getAvailableCommands(): Player.Commands =
    super.getAvailableCommands()
      .buildUpon()
      .add(Player.COMMAND_SEEK_TO_NEXT)
      .add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
      .add(Player.COMMAND_SEEK_TO_PREVIOUS)
      .add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
      .build()

  override fun seekToNext() {
    onSkip("next")
  }

  override fun seekToNextMediaItem() {
    onSkip("next")
  }

  override fun seekToPrevious() {
    onSkip("previous")
  }

  override fun seekToPreviousMediaItem() {
    onSkip("previous")
  }

  /**
   * The system lockscreen/notification play button at the end of a queue must
   * restart the last track instead of being a no-op. ExoPlayer's play() does
   * nothing in STATE_ENDED, so rewind first. This also keeps the media session
   * (and therefore the lockscreen controls) alive after a natural queue end.
   */
  override fun play() {
    if (player.playbackState == Player.STATE_ENDED) {
      player.seekTo(0)
    }
    super.play()
  }

  /** Same guard for controllers that toggle playWhenReady directly. */
  override fun setPlayWhenReady(playWhenReady: Boolean) {
    if (playWhenReady && player.playbackState == Player.STATE_ENDED) {
      player.seekTo(0)
    }
    super.setPlayWhenReady(playWhenReady)
  }
}
