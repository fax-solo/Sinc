# M4.1 Background Playback — Manual QA Matrix

Milestone: **M4.1 Background Playback** (Phase 4 — Background Systems).

Implementation notes: background playback rides on `react-native-video` 6.19.2's built-in
Media3 machinery (Android: `VideoPlaybackService`, MediaSession, media notification, audio
focus; iOS: `AudioSessionManager` + `NowPlayingInfoCenterManager` with remote commands).
The app wires it via `AudioHost` props (`showNotificationControls`, `playInBackground`,
`ignoreSilentSwitch`) and manifest/plist entries.

| #   | Scenario                       | Steps                                                        | Expected                                                                    | Android | iOS |
| --- | ------------------------------ | ------------------------------------------------------------ | --------------------------------------------------------------------------- | :-----: | :-: |
| 1   | Media notification appears     | Play a track, lock the screen                                | Persistent media notification with track title + artist; playback continues |         |     |
| 2   | Notification pause/resume      | Tap pause then play on the notification                      | Playback pauses/resumes; app state stays in sync                            |         |     |
| 3   | Lock screen controls           | With screen locked, use play/pause (and skip on Android 12-) | Controls act on the player                                                  |         |     |
| 4   | Skip from notification         | Android 12-: tap fast-forward/rewind                         | Seeks ±10s                                                                  |         |     |
| 5   | Background playback            | Start a track, press Home, wait 60s                          | Audio keeps playing; app not killed                                         |         |     |
| 6   | Kill app / swipe away          | Swipe app from recents while playing                         | Playback stops cleanly (service stops), no crash                            |         |     |
| 7   | Notification permission prompt | Fresh install on Android 13+, play first track               | POST_NOTIFICATIONS prompt appears; deny → playback works, no notification   |         |     |
| 8   | Audio focus — phone call       | Play, receive a call                                         | Playback pauses; resumes after the call ends                                |         |     |
| 9   | Audio focus — other app        | Play, start another media app                                | Sinc pauses (focus loss)                                                    |         |     |
| 10  | Headset unplug                 | Play with headphones, unplug                                 | Playback pauses (`onAudioBecomingNoisy`)                                    |         |     |
| 11  | Silent switch (iOS)            | Enable silent switch, play                                   | Audio plays (ignoreSilentSwitch=ignore)                                     |    —    |     |
| 12  | Track metadata                 | Play a track with known title/artist                         | Notification shows the right title/artist                                   |         |     |
| 13  | App foreground sync            | Pause via notification, reopen app                           | Mini player + status show paused                                            |         |     |
| 14  | End of queue                   | Let the last track end                                       | Notification disappears / service stops                                     |         |     |
| 15  | No crash on rotation           | Play, rotate device                                          | Playback unaffected                                                         |         |     |

Known limitations:

- Notification artwork (album cover) is not yet shown (`imageUri` intentionally omitted —
  the library loads artwork synchronously on the main thread, which can ANR on slow
  networks).
- iOS requires a Mac build to verify; columns above are the runbook for that pass.
- Detox smoke test: not set up yet (no `detox` dependency); deferred — requires an
  emulator/CI decision. The matrix above is the manual gate for this milestone.
