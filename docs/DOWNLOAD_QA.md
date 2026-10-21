# Download pipeline QA checklist

Fixes implemented (2026-10): wrong-song matching gates, transfer reliability,
background liveness, failure observability. Automated coverage lives in
`SincTrackMatchTest` (14 fixtures), `download-source.test.ts`,
`downloadsStore.test.ts` (retry/regression fixtures). The items below exercise
the device-only paths and should be walked once on a real phone before release.

Run with: `cd apps/mobile/android && ./gradlew :app:testDebugUnitTest --tests "com.sinc.app.modules.SincTrackMatchTest"`.

## 1. Wrong-song gates (native matching)

- [ ] Download a chart-topping track (e.g. a pop single) with airplane data ON:
      the saved file must be the actual single — verify by comparing the length
      and intro seconds before/after.
- [ ] Pick a track whose catalog has no direct source and whose only YouTube
      results are covers/sped-up edits: the download must now FAIL honestly
      ("No downloadable source…") instead of saving a cover. Playback of the
      same track must still play (lenient path).
- [ ] Retry the same track after toggling a VPN region: repeated downloads
      should resolve identically when a good source exists (strict resolver +
      one-shot artist gate).

## 2. Resume / reliability

- [ ] Start a large (>10 MB) download on Wi-Fi, force-kill the app mid
      transfer, relaunch → resume must continue from the interrupted offset
      (`%` jumps, not from 0; `.part` reused through OkHttp Range requests).
- [ ] Same kill test on the yt-dlp path: relaunch must continue and reuse the
      SAME resolved source (per-job resolved-target cache).
- [ ] Toggle airplane mode mid download: the job must park as
      "Waiting for connection…" (NOT failed). Reconnect (or re-checks every
      60 s / on app foreground) auto-resumes it.
- [ ] Throttle the link (airplane + flaky LTE): transient timeouts must
      auto-retry twice (5 s/15 s backoff, shown as "Retrying in Xs…") before a
      permanent failure.
- [ ] Stale-URL case: leave the app open > 6 h on a paused yt-dlp job, resume
      → googlevideo URL must re-resolve instead of a raw 403.

## 3. Direct-source duration guard

- [ ] Find a track where Archive/Jamendo serves a short preview: the guard must
      reject the file, clean up (no orphan in Music/Sinc), fall through to the
      yt-dlp path and complete correctly.
- [ ] Verify the published Music/Sinc copy is named after the song title and
      carries the right artist/album tags.
- [ ] Delete the download afterwards: BOTH the app-private file and the
      Music/Sinc MediaStore entry must disappear (ghost-entry bug fix).

## 4. UI

- [ ] A failed download row shows the error text plus Retry / Cancel actions;
      Retry must re-run (not duplicate) the job.
- [ ] Lock-screen/notification controls still work during a download
      (foreground service unaffected by the new probe step).
- [ ] Notification progress reflects Range-resume percentages correctly.

## Notes

- The bundled ffmpeg now also runs a duration probe on every direct download;
  a probe returning 0 (unreadable) is treated as "unknown — accept".
- Keep the SELinux-safe binary layout (`nativeLibraryDir` fake `.so` files)
  when touching any engine code.
- Server-side `apps/server/src/lib/track-match.ts` intentionally keeps the old
  (lenient) scoring: local mode is the only affected surface.
