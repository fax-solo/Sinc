# Sinc media/lockscreen/lyrics work — progress

This document tracks the implementation phases for the native media notification,
lockscreen media controls, Show Lyrics action, expanded player improvements, audio
output selection, and download notifications.

Status legend:

- ✅ Implemented and verified with the checks listed below.
- 🚧 Partially implemented; remaining work is listed.
- ⛔ Intentionally not implemented because Android does not support it.
- 🕒 Runtime-tested on a real device; pending until a device/emulator is available.

## Phase 1 — native media session foundation ✅

Implemented:

- Added `SincQueueRoutingPlayer` around the single ExoPlayer so Android advertises
  Previous/Next in MediaStyle notifications and the system lockscreen, while still
  routing those commands to the existing JS queue instead of seeking a native playlist.
- `PlaybackService` now uses the routing player, emits a full transport snapshot on
  play/pause, playback-state, and media-item changes, and supports `getState()`.
- Added a Sinc-owned playback notification channel and monochrome notification icon.
- Added a Show Lyrics custom session action and a Favorite custom session action.
- Favorite icon state is mirrored from the JS library store through `setFavorite()`.
- Enabled audio-becoming-noisy handling on ExoPlayer.
- Added album title, duration, and favorite metadata to the native `MediaItem`.
- `POST_NOTIFICATIONS` is now requested once per app session rather than on every load.

Files added/changed:

- `apps/mobile/android/app/src/main/java/com/sinc/app/modules/SincQueueRoutingPlayer.kt`
- `apps/mobile/android/app/src/main/java/com/sinc/app/modules/PlaybackSnapshot.kt`
- `apps/mobile/android/app/src/main/java/com/sinc/app/modules/PlaybackService.kt`
- `apps/mobile/android/app/src/main/java/com/sinc/app/modules/SincPlayerModule.kt`
- `apps/mobile/android/app/src/main/res/drawable/ic_sinc_notification.xml`
- `apps/mobile/android/app/src/main/res/drawable/ic_sinc_lyrics.xml`
- `apps/mobile/android/app/src/main/res/values/strings.xml`

Checks:

- `./gradlew :app:compileDebugKotlin` ✅
- Baseline mobile typecheck/tests had already been verified before Phase 1.
- Device-level Test A/B verification: 🕒 pending a connected device/emulator.

Known limitations:

- The system notification/lockscreen layout is owned by Android SystemUI. The mockup’s
  custom cards, overlaid heart, full-width lyrics row, and custom background cannot be
  reproduced inside system media UI.
- Android MediaStyle supports a maximum of five actions. Phase 1 adds Previous,
  Play/Pause, Next, Show Lyrics, and Favorite. Shuffle and Repeat remain in the expanded
  in-app player.
- Open Sinc is the standard notification-body tap.

## Upcoming

- Phase 2: JS playback-state reconciliation and favorite bridge.
- Phase 3: Show Lyrics deep link and notification action verification.
- Phase 4: Lyrics screen visual/interaction refinement.
- Phase 5: Expanded player, audio output, and mini-player lyrics shortcut.
- Phase 6: Per-job download notifications.
- Phase 7: Background playback hardening and full A–G test pass.
