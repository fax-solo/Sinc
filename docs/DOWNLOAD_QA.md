# Download pipeline device acceptance

Final manual gate for the P0/P1 download reliability work. Automated tests cover
matching, progress parsing, queueing, retries, cancellation state, stages,
containers and metadata. The items below exercise paths that only a real Android
device and MediaStore can prove.

Run the automated gates first:

```bash
npm run typecheck -w @sinc/mobile
npm run test -w @sinc/mobile
cd apps/mobile/android
./gradlew :app:testDebugUnitTest
```

Build and install a release-path APK from the repo instructions in
[`RELEASING.md`](RELEASING.md). For a local check, `:app:assembleRelease` is
enough; the CI workflow supplies the real signing key.

Useful while testing:

```bash
adb logcat -s ReactNativeJS SincDownloads SincDownloaderModule SincYtModule
```

Record the device model, Android version, source (Wi-Fi/mobile), track name and
approximate file size for every failure.

## 1. Authorized sources and matching

- [ ] An Internet Archive track downloads through the native direct path and
      publishes to `Music/Sinc`.
- [ ] A Jamendo/FMA track with configured keys uses the direct path.
- [ ] A track with no authorized direct source downloads through the bundled
      yt-dlp fallback **only after an individual user action**.
- [ ] A bulk import never silently falls back to yt-dlp. Individual rows may
      show the fallback explanation and proceed only when the user starts them.
- [ ] A pop single whose only search results are covers, sped-up edits, live
      re-uploads or wrong-length videos fails honestly instead of saving the
      wrong audio. Playback for the same track still works leniently.
- [ ] A request for a live/radio variant returns a live/radio result when the
      catalog has one; it is not collapsed to the studio recording.
- [ ] No DRM-protected, paywalled, authenticated or provider-restricted content
      is downloaded by bypassing a restriction.

## 2. Queue, concurrency and duplicates

- [ ] Three or more downloads show at most **two** active transfers at once;
      the rest remain visibly `Queued`.
- [ ] A new user tap jumps ahead of a pending bulk import. A resumed job is
      behind a user tap but ahead of bulk work.
- [ ] Tapping download twice for the same track, or importing a track that is
      already queued, does not create a second job or a duplicate file.
- [ ] Pausing a `Queued` row prevents it from starting later on its own.
- [ ] Cancelling a `Queued` row removes it without touching the current
      transfers.
- [ ] Force-kill and relaunch with queued/running rows: the queue recovers
      without duplicate native jobs and completed rows stay completed.

## 3. Progress and stage honesty

- [ ] The row/notification progresses through the real stages:
      `Queued` → finding the source → `Downloading` → `Processing audio…` →
      `Writing tags…` → `Verifying audio…` → completed.
- [ ] A source without `Content-Length` shows an indeterminate download and the
      measured byte rate, not a fake 99%.
- [ ] Post-transfer stages do not show a stale byte speed or a jumping
      download percentage.
- [ ] A late/duplicate stage event cannot move a row backwards, and the final
      stage is not shown before the file is actually finalized.
- [ ] The foreground notification uses the same stage wording as the in-app
      row.
- [ ] If the engine re-resolves an expired stream and restarts its transfer,
      the row returns to the transfer stage instead of staying on "Writing
      tags…" while bytes move again.

## 4. Pause, resume, restart and backoff

- [ ] Pause a large direct download, wait, then Resume in the same app session:
      it continues from the surviving `.part` instead of restarting at 0%.
- [ ] Do the same for a yt-dlp job: it reuses the same resolved source and
      continues the existing `.part`.
- [ ] Force-kill the app mid-transfer, then relaunch. The job restarts as a
      **fresh transfer**; the old partial is discarded rather than appended to
      a possibly different source. The final file must be playable and the
      duration/tags correct.
- [ ] While a transient error is showing "Retrying in 5s…" or "Retrying in
      15s…", force-kill and relaunch. The retry waits out the remaining
      backoff instead of firing immediately.
- [ ] After the retried transfer succeeds, a later restart gets a fresh retry
      budget (the old transient failures must not permanently consume it).
- [ ] Toggle airplane mode mid-download: the row parks as "Waiting for
      connection…" and is not marked failed. Reconnect, foreground the app, or
      wait for the 60-second poller; it resumes.
- [ ] Leave a paused yt-dlp job for longer than the stream URL lifetime, then
      resume. An expired `googlevideo`/403 target must re-resolve once instead
      of failing permanently.
- [ ] A hard 403/404 or exhausted retry budget fails with a clear message and
      leaves Retry/Cancel available.

## 5. Cancellation, cleanup and deletion

- [ ] Cancel an active direct transfer from the app: the native transfer stops,
      the row disappears, and no `.part`/target file remains in app storage.
- [ ] Cancel an active yt-dlp transfer from the notification: the process
      stops and no private or published copy remains.
- [ ] Cancel during `Processing audio…`, `Writing tags…` or `Verifying audio…`:
      the job must not publish afterwards.
- [ ] Cancel, then immediately re-download the same track. The new download must
      survive; the old cleanup must not delete its partial or final file.
- [ ] Delete a completed download: both the app-private copy and the
      `Music/Sinc` MediaStore entry disappear. No ghost row remains in other
      music players.
- [ ] Delete a queued or failed row: no orphan files are left behind.

## 6. Files, containers and metadata

- [ ] A direct MP3 publishes as `.mp3` with title, artist, album and embedded
      artwork.
- [ ] A direct OGG/Opus or FLAC source keeps a compatible container; it is not
      mislabeled as `.mp3`.
- [ ] A yt-dlp M4A/AAC result publishes as `.m4a` and is retagged losslessly.
- [ ] An MP3 with cover art is finalized atomically; no partial file is ever
      visible in `Music/Sinc` or playable before validation finishes.
- [ ] Unicode and Arabic titles/artists produce valid filenames and tags.
- [ ] A second player (YouTube Music, Samsung Music, VLC, etc.) shows the
      correct title, artist, album and cover.
- [ ] A direct source that returns a preview-length file is rejected, cleaned
      up and retried through the alternate path — or fails honestly.
- [ ] No success is reported unless the file exists, has an acceptable
      duration, passes the fingerprint gate (when a preview is available) and
      has been published.

## 7. Background, restart and permissions

- [ ] Start two downloads, background the app, and lock the screen. Transfers
      continue and the foreground notification updates.
- [ ] Notification Pause, Resume and Cancel each affect the correct job.
- [ ] Android 13+ notification permission is requested once; denying it does
      not stop downloads, but the notification may be absent.
- [ ] Android 8/9 gets the legacy storage permission path; Android 10+ needs no
      broad storage permission.
- [ ] Force-stop during `Writing tags…`/`Verifying audio…`, then relaunch. The
      job recovers without publishing two copies or leaving a partial in
      `Music/Sinc`.
- [ ] Reboot or let the OS kill the app with paused jobs: paused rows stay
      paused and running rows resume according to the restart rules above.

## 8. Storage and MediaStore

- [ ] The app-private copy is under the app data directory and the public copy
      is under `Music/Sinc`.
- [ ] The published file is indexed immediately and appears in a fresh media
      scan.
- [ ] Removing the download removes the MediaStore row; it does not leave a
      playable ghost entry.
- [ ] A failed/cancelled job never leaves a `.part`, `.ytdl`, temporary tagged
      file or stale published copy.
- [ ] Low-storage failure is reported honestly; a partial output is not marked
      completed.

## Engine fallback policy

- Licensed/direct providers are always tried first.
- An individual download may fall back to the on-device yt-dlp engine. While it
  resolves, the row says that no licensed source was found and that the
  on-device engine is being used; completed fallback rows keep an
  `on-device engine` label.
- Bulk jobs never fall back. They fail with an explanation and must be opened
  individually to use the engine.
- Automatic restarts/resumes keep the original policy. An explicit Retry is an
  individual action and may opt into the engine.

## Intended restart rule

A force-kill loses the in-memory source-to-partial mapping. Restarting a direct
or yt-dlp transfer therefore discards the old partial and starts fresh — this is
deliberate corruption protection. Same-session pause/resume does continue from
the existing `.part`, because the original URL/resolved target is still known.
Any checklist claim of byte-range resume after a process kill is obsolete.
