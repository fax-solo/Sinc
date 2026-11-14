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

## Phase 2 — JS playback-state reconciliation and favorite bridge ✅

Implemented:

- Native transport snapshots (`SincPlayerState`) now flow into the JS player store.
  Notification/lockscreen play/pause no longer desyncs the UI: `ready`+playing promotes
  the store to `playing` (including out of `loading`), `ready`+paused demotes a live
  `playing`/`loading` state to `paused`, buffering/ended/idle are mapped, and stale
  snapshots for a superseded track are ignored.
- `PlayerService` reconciles with the still-running service on app start/reload via
  `player.getState()` after listeners attach, and `App.tsx` now calls
  `playerService.initialize()` on mount so this runs before the first playback action.
- The notification Favorite action is wired end-to-end: `SincPlayerCommand` events carry
  the command + trackId, `PlayerService` toggles the library store only when the command
  matches the current track, and a library-store subscription mirrors the new favorite
  state back to the native session (single push — the command handler relies on the
  subscription rather than pushing twice).
- Native `MediaItem` metadata now includes album title, duration, and favorite state;
  `load()` reads the favorite flag from the library store at load time.

Files added/changed:

- `apps/mobile/src/app/App.tsx`
- `apps/mobile/src/services/native/types.ts`
- `apps/mobile/src/services/native/index.ts`
- `apps/mobile/src/services/player/PlayerService.ts`
- `apps/mobile/src/services/player/PlayerService.test.ts`

Checks:

- `npm run typecheck -w @sinc/mobile` ✅
- `npm test -w @sinc/mobile` ✅ 310 passed (was 302; +7 new tests covering snapshot
  sync in both directions, favorite toggle + mirroring, and stale-command rejection).
- Device-level Test A/B verification: 🕒 pending a connected device/emulator.

Known limitations:

- JS intentionally never fabricates a track when the native session reports one the
  store does not know; such snapshots are logged out and ignored.

## Phase 3 — Show Lyrics deep link ✅

Implemented:

- Added a `Lyrics: 'lyrics'` route to the deep-link config, so the native
  `sinc://lyrics` PendingIntent from the notification/lockscreen action lands on the
  existing `LyricsScreen` (both warm `onNewIntent` and cold start).
- Verified the manifest already carries a BROWSABLE `VIEW` filter for the `sinc`
  scheme on `MainActivity`, so no manifest change was needed.
- Cold-start behavior verified by code inspection: the player store rehydrates
  synchronously (MMKV), so the Lyrics screen finds the restored current track, and the
  Phase 2 `syncFromNative()` reconciliation restores play/pause state before the
  navigation parse. No playback is ever started by the deep link.
- App PIN lock: `LockGate` overlays the whole navigator while armed, so a
  deep-linked Lyrics screen cannot bypass the PIN; the screen is already mounted
  underneath once the user unlocks.

Files changed:

- `apps/mobile/src/app/navigation/linking.ts`

Checks:

- `npm run typecheck -w @sinc/mobile` ✅
- `npm test -w @sinc/mobile` ✅ 310 passed.
- End-to-end notification action → LyricsScreen: 🕒 pending a device/emulator
  (native `openLyrics()` path was compiled in Phase 1; runtime verification still
  requires Test C on hardware).

## Phase 4 — Lyrics screen refinement ✅

Implemented:

- Added the explicit **Return to current line** pill: while the user is manually
  scrolled away (auto-follow suspended), a floating accent pill appears above the
  transport bar and jumps straight back to the sung line. The 4.5s manual-timeout
  now reuses the same handler, so both paths behave identically.
- Auto-follow scrolling now respects the OS **reduced-motion** preference
  (`AccessibilityInfo.isReduceMotionEnabled` + `reduceMotionChanged`): scroll
  animation is disabled when the user opts out of motion.
- State coverage confirmed (existing behavior, no change needed): loading skeletons,
  synchronized lines with active/passing highlight, unsynchronized plain text,
  "No lyrics found" empty state, LRCLIB error state with retry, and track-changed
  reload keyed by `track.id`. Seek updates propagate through the progress store, and
  tapping any line seeks via `playerService.seekTo` without touching the session.

Files changed:

- `apps/mobile/src/ui/screens/LyricsScreen.tsx`

Checks:

- `npm run typecheck -w @sinc/mobile` ✅
- `npm test -w @sinc/mobile` ✅ 310 passed.
- Visual/scroll verification on device: 🕒 pending.

## Phase 5 — Expanded player, audio output, Show Lyrics shortcut ✅

Implemented:

- **Audio output selection** (the one missing expanded-player feature):
  - New native `SincAudioOutputModule`: lists Android output routes via
    `AudioManager.getDevices(GET_DEVICES_OUTPUTS)` (Bluetooth, wired, USB, HDMI,
    speaker, earpiece), infers the active route following Android's precedence
    when nothing is pinned, and applies the choice to the process-wide ExoPlayer
    via `setPreferredAudioDevice`. A negative id restores the OS default.
  - `PlaybackService` companion now tracks `preferredAudioDeviceId` so the UI
    highlight survives module re-instantiation.
  - New `audioOutput` bridge (`getOutputs`/`setOutput`) with unavailable stubs,
    registered in `SincPackage`.
  - PlayerScreen gained an **Output** footer button opening a BottomSheet picker
    (Automatic + detected devices, current route highlighted, per-type icons);
    selection applies immediately and refreshes the list.
- Extended-player inventory confirmed against the spec (no duplication needed):
  artwork, title/artist/album, favorite heart, progress bar with seek,
  shuffle/previous/play/next/repeat, **Show Lyrics** footer shortcut (→ Lyrics
  screen, preserving playback), Queue, Share, Download, and **More** (ellipsis →
  song menu, which contains Add to Playlist).

Files added/changed:

- `apps/mobile/android/app/src/main/java/com/sinc/app/modules/SincAudioOutputModule.kt` (new)
- `apps/mobile/android/app/src/main/java/com/sinc/app/modules/PlaybackService.kt`
- `apps/mobile/android/app/src/main/java/com/sinc/app/modules/SincPackage.kt`
- `apps/mobile/src/services/native/types.ts`
- `apps/mobile/src/services/native/index.ts`
- `apps/mobile/src/ui/screens/PlayerScreen.tsx`

Checks:

- `./gradlew :app:compileDebugKotlin` ✅
- `npm run typecheck -w @sinc/mobile` ✅
- `npm test -w @sinc/mobile` ✅ 310 passed.
- Live route switching across Bluetooth/wired devices: 🕒 pending device tests (E).

Known limitations:

- Route inference when "Automatic" is selected is an approximation of Android's
  internal precedence; actual audio routing is still decided by the OS.
- If a pinned device disconnects, Android falls back to default routing on its
  own; the picker refreshes its highlight the next time it is opened.

## Device findings (Samsung Galaxy A05, Android 14, release build)

Verified on hardware:

- MediaSession is active, public, and holds the media-button session; the Samsung
  lockscreen player shows artwork, title, Previous/Pause/Next, and its buttons change
  real playback state (verified PLAYING → PAUSED → PLAYING via media keys).
- The notification is a `sinc_playback` transport notification with 5 actions and
  `vis=PUBLIC`; POST_NOTIFICATIONS is granted; the service runs in the foreground.

Bug found and fixed — **media session died at end of queue**:

- On natural completion (or Next on the last track) with repeat off, `PlayerService`
  called `nativeBridge.player.stop()`, which released the ExoPlayer, destroyed the
  `PlaybackService`, and removed the notification/lockscreen player entirely. The
  lockscreen then fell back to Samsung Music.
- Fix: end-of-queue now keeps the media session alive. Natural completion leaves the
  player in `ENDED`; Next-past-the-end pauses it. In both cases the notification and
  lockscreen controls remain showing the last track.
- `SincQueueRoutingPlayer` now overrides `play()`/`setPlayWhenReady(true)`: when the
  delegate is in `STATE_ENDED`, it rewinds to 0 first, so the lockscreen play button
  replays the last track instead of being a no-op.
- Error-before-start deliberately still tears the session down.

Checks: typecheck ✅, 315 vitest ✅ (2 new tests: session survives completion of last
track; Next on last track pauses without `stop()`). Release APK rebuilt and installed
over the existing app at 15:04 (same debug signing key, user data preserved).
End-of-queue re-tested on the phone: `state=ended` → no service destroy → play button
restarted the track from 0. ✅

Bug found and fixed — **Show Lyrics blocked by Android 14 BAL**:

- Tapping Show Lyrics from the lockscreen while Sinc was backgrounded produced
  `Background activity launch blocked! ... dat=sinc://lyrics ... FOREGROUND_SERVICE`.
  The session-command handler called `PendingIntent.send()` from the service, which
  Android 14 treats as a background app trying to launch an activity.
- Fix: `SincNotificationProvider` wraps Media3's default provider and appends Show
  Lyrics as a notification action whose PendingIntent targets `MainActivity` directly.
  SystemUI sends notification PendingIntents, which are allowed to start activities.
  The platform `Notification.Builder.recoverBuilder` restores the MediaStyle so the
  transport/lockscreen treatment is preserved; below API 24 the extra action is
  skipped rather than risking a broken notification.
- The session custom layout now carries only Favorite; Show Lyrics is added by the
  provider. On-device: Favorite works from the lockscreen expanded player (action
  switched to "Remove from Liked Songs" with a filled heart).

## Upcoming

- Phase 2: JS playback-state reconciliation and favorite bridge.
- Phase 3: Show Lyrics deep link and notification action verification.
- Phase 4: Lyrics screen visual/interaction refinement.
- Phase 5: Expanded player, audio output, and mini-player lyrics shortcut.
- Phase 6: Per-job download notifications.
- Phase 7: Background playback hardening and full A–G test pass.
