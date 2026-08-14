# M3.3/M4.2 QA Matrix — Downloads (Android)

Preconditions: signed in; network online; storage > 300 MB free. Files land in
`Android/data/com.sinc/app/files/Music/sinc_<trackId>.mp3` via the system
DownloadManager. One job per track (id = track id); batches share a batch id.

## Smoke

| #   | Action                                                   | Expected                                                                                 |
| --- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1   | Open Downloads tab with no jobs                          | Empty state: "No downloads yet"                                                          |
| 2   | From a track's detail screen, tap **Download**           | Chip flips to "Downloading…"; job appears in Downloads tab                               |
| 3   | Downloads tab shows title/artist, progress bar and %     | Progress advances ~1.5 s cadence                                                         |
| 4   | Tap **Pause**                                            | Status "Paused"; progress bar idle                                                       |
| 5   | Tap **Resume**                                           | Download continues from 0 (DownloadManager limitation)                                   |
| 6   | Tap **Cancel**                                           | Job removed from list; file removed                                                      |
| 7   | Kill the app mid-download, relaunch (online)             | Reconcile resumes QUEUED jobs; orphaned DOWNLOADING jobs marked failed with retry option |
| 8   | Kill the app mid-download, relaunch (offline)            | Nothing marked failed; jobs wait (reconcile is network-gated)                            |
| 9   | Complete a download; open **Full Player** for that track | Plays the local file (no stream request); notification shows artwork/title               |
| 10  | Airplane mode ON; play a downloaded track                | Plays offline; queue advances to next downloaded track if set                            |
| 11  | Tap **Delete** on a completed job                        | Row disappears; file deleted from disk; storage usage drops                              |
| 12  | Download from an album via queue/batch (if wired)        | One aggregate "downloads complete" notification for the batch                            |
| 13  | Fail a download (offline / expired URL)                  | Status Failed + error message; **Retry** re-enqueues                                     |

## Storage

| #   | Action                                                                       | Expected                                                             |
| --- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 14  | Downloads tab footer shows storage usage                                     | Grows with completed bytes                                           |
| 15  | Free storage < 300 MB                                                        | Low-storage banner appears; new enqueues are rejected with the alert |
| 16  | Settings → Download settings shows storage line + "Clear finished downloads" | Clearing removes COMPLETED/FAILED/CANCELLED rows and their files     |

## Persistence

| #   | Action                             | Expected                                                     |
| --- | ---------------------------------- | ------------------------------------------------------------ |
| 17  | Download, force-stop app, relaunch | Job still listed with status COMPLETED; local file playable  |
| 18  | Sign out and back in               | Jobs remain (local DB), server sync does not touch downloads |

## Notifications / background

| #   | Action                          | Expected                                                                                                                     |
| --- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 19  | Download while app backgrounded | DownloadManager keeps transferring; completion event updates DB on foreground; batch completion posts notification (id 4242) |

## Edge cases

| #   | Action                                             | Expected                                                 |
| --- | -------------------------------------------------- | -------------------------------------------------------- |
| 20  | Tap Download on the same track twice               | No duplicate job; alert-free no-op                       |
| 21  | Delete a track while it is PLAYING from local file | Playback continues; next job/reload falls back to stream |
| 22  | Reinstall app                                      | Downloads wiped with app data (system-scoped files)      |
| 23  | Sync engine runs while downloading                 | No interference; downloads unaffected by library sync    |

Known limitations: pause = cancel + requeue (DownloadManager cannot pause);
no iOS implementation (deferred); artwork not embedded in files; bytes_total
may stay null until first progress poll.
