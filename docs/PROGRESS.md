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

## Upcoming

- Phase 2: JS playback-state reconciliation and favorite bridge.
- Phase 3: Show Lyrics deep link and notification action verification.
- Phase 4: Lyrics screen visual/interaction refinement.
- Phase 5: Expanded player, audio output, and mini-player lyrics shortcut.
- Phase 6: Per-job download notifications.
- Phase 7: Background playback hardening and full A–G test pass.
