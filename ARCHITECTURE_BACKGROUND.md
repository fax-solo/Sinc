# Background Architecture

## Overview

Background behavior is the most platform-divergent area of the app. The architecture treats **audio playback**, **downloads**, **sync**, and **notifications** as separate background subsystems, each with its own platform strategy. All long-running operations are **recoverable** and **persist state** so nothing is lost on process termination.

## Platform Capability Matrix

| Task                 | Android                        | iOS                                         |
| -------------------- | ------------------------------ | ------------------------------------------- |
| Background audio     | Foreground Service (Media3)    | Background Modes: "Audio, AirPlay, and PiP" |
| Background downloads | `DownloadManager` (OS-managed) | `URLSession` background session             |
| Short sync           | `WorkManager` (expedited)      | `BGAppRefreshTaskRequest`                   |
| Push                 | FCM (data + notification)      | APNs                                        |
| Local notifications  | Notification channels          | UNUserNotificationCenter                    |

## 1. Background Playback

### Architecture

```
┌─────────────────────┐     ┌──────────────────────────┐
│  React Native (JS)  │     │   Native Audio Engine    │
│  PlaybackStore      │◄───►│  ─────────────────────   │
│  (state machine)    │     │  Android: Media3/Exo     │
│                     │     │  iOS: AVPlayer           │
│  NativeModule Bridge│────►│  MediaSession/NowPlaying  │
└─────────────────────┘     │  AudioFocus              │
                            │  ForegroundService/      │
                            │  AVAudioSession          │
                            └──────────────────────────┘
```

### Android Implementation

- **Media3 (ExoPlayer + MediaSessionService)**: The playback engine runs in a foreground service (`MediaSessionService`) with an ongoing notification. This is the _only_ reliable way to keep audio playing in background on modern Android.
- **Foreground notification**: Shows artwork, title, artist, play/pause/next/prev/stop actions. Uses a dedicated `notification_channel_playback` channel (IMPORTANCE_LOW, no sound, no vibration).
- **Audio focus**:
  - Request focus when starting playback (`AUDIOFOCUS_GAIN`)
  - Duck (`AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK`) → lower volume
  - Pause (`AUDIOFOCUS_LOSS_TRANSIENT`) → pause, resume on regain
  - Stop (`AUDIOFOCUS_LOSS`) → pause + release focus
- **Becoming noisy**: Bluetooth/headset disconnect → pause (per setting, or continue)
- **Media buttons**: handled by `MediaSessionCompat` callbacks
- **Lock screen**: media notification with artwork (NotificationCompat.MediaStyle)
- **Doze/battery**: Foreground service keeps app alive; no special workarounds needed for playback

```kotlin
// Android: MainPlaybackService.kt
class MainPlaybackService : MediaSessionService() {
    private var mediaSession: MediaSession? = null
    private var player: ExoPlayer? = null

    override fun onCreate() {
        super.onCreate()
        val mediaSession = MediaSession.Builder(this, player).build()
        mediaSession.apply {
            setCallback(MediaSessionCallback())
            isActive = true
        }
        // Set up audio focus handling
        // Set up becoming-noisy receiver
        // Set up notification
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? {
        return mediaSession
    }
}
```

### iOS Implementation

- **AVAudioSession category**: `.playback` mode — required for background audio
- **Background mode**: "Audio, AirPlay, and Picture in Picture" in Info.plist
- **Now Playing**: `MPNowPlayingInfoCenter` with artwork, title, artist, position, duration, playback rate
- **Remote commands**: `MPRemoteCommandCenter` (play, pause, toggle, next, prev, seek forward/back, changePlaybackPosition, skip forward/back, like/dislike if applicable)
- **Interruptions**: `AVAudioSession` notifications for phone calls, Siri, alarms
- **Lock screen**: System Now Playing UI shows automatically from the Now Playing center

```swift
// iOS: AudioSessionManager.swift
func activate() {
    try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
    try? AVAudioSession.sharedInstance().setActive(true)
}

func setupNowPlaying() {
    var info = [String: Any]()
    info[MPMediaItemPropertyTitle] = currentTrack.title
    info[MPMediaItemPropertyArtist] = currentTrack.artist
    info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: artwork.size) { _ in artwork }
    info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = position
    info[MPMediaItemPropertyPlaybackDuration] = duration
    info[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? 1.0 : 0.0
    MPNowPlayingInfoCenter.default().nowPlayingInfo = info
}
```

### Playback State Machine

```
IDLE → LOADING → BUFFERING → PLAYING ⇄ PAUSED → ENDED → IDLE
                      ↘           ↘
                       ERROR → IDLE (or retry)
```

- Native engine and JS store stay in sync via event bridge (stateChange, positionChange, trackChange, error, buffering)
- Position persisted every ~10s (and on pause/stop/background) for "Continue Listening"

## 2. Background Downloads

### Architecture

```
User taps Download
        │
        ▼
JS DownloadStore creates job (persisted in WatermelonDB)
        │
        ▼
API: POST /downloads → server creates download record + enqueues BullMQ job
        │
        ▼
Server worker: RESOLVING → DOWNLOADING → PROCESSING → FETCHING_LYRICS → FINALIZING → COMPLETED
        │
        ▼
Server uploads file to object storage
        │
        ▼
Client notified (WS + local notification) → GET /downloads/:id/file (signed URL)
        │
        ▼
Client native DownloadManager (Android) / URLSession (iOS) fetches file in background
        │
        ▼
File landed → process (metadata/artwork/lyrics embed) → library updated
```

**Two-phase download:** Server-side job orchestration (source resolution, lyrics, processing) + client-side file transfer via native background downloader. The client never blocks; it receives progress via WS and uses OS-managed background transfers for the actual bytes.

### Android: DownloadManager

- OS-managed, survives app process death and reboot
- Notification progress managed by OS (configurable)
- Status via `BroadcastReceiver` + `DownloadManager.Query`
- Enforces Wi-Fi-only via `setAllowedOverMetered(false)` / `setAllowedOverRoaming(false)`

```kotlin
val request = DownloadManager.Request(uri)
    .setTitle(track.title)
    .setDescription(track.artist)
    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
    .setDestinationInExternalFilesDir(context, null, "downloads/${trackId}.m4a")
    .setAllowedOverMetered(allowedCellular)
    .setAllowedOverRoaming(false)
val id = downloadManager.enqueue(request)
```

### iOS: URLSession Background Session

- `URLSessionConfiguration.background(withIdentifier:)`
- Downloads continue after app is backgrounded/killed; OS wakes app on completion
- Delegates report progress; final file in temp dir → move to app container
- Enforce Wi-Fi via `allowsCellularAccess` (checked on network transitions)

### Job Persistence & Recovery

Every job persists: id, trackId, status, progress, bytes, speed, retryCount, error, source, createdAt, completedAt (WatermelonDB + server DB).

On app start:

1. Load `download_jobs` from WatermelonDB
2. Reconcile with server (`GET /downloads?status=...`)
3. Jobs stuck in DOWNLOADING on device → query OS download manager for state → resume or mark failed
4. Jobs in QUEUED/RESOLVING → ask server worker state → continue
5. Show recovery notification summary if jobs were interrupted

### Concurrency Control

- Max concurrent downloads: default 3, configurable 1–5
- Enforced both client-side (DownloadStore) and server-side (worker concurrency)
- Priority: higher priority jobs preempt queued lower-priority ones
- Batch downloads (playlist/album): aggregate progress `18/42`

## 3. Background Sync

### What Syncs

- Play history upload
- Favorites (bidirectional)
- Playlist edits (bidirectional, versioned)
- Settings
- Recommendations refresh (server-driven)
- Library metadata refresh

### Android: WorkManager

```kotlin
val syncRequest = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
    .setConstraints(
        Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()
    )
    .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
    .build()
WorkManager.getInstance(context).enqueueUniquePeriodicWork(
    "background-sync", ExistingPeriodicWorkPolicy.KEEP, syncRequest
)
```

- Battery-aware: OS batches work; constraints require network; only syncs when there is pending work (checks local `sync_queue` first)

### iOS: BGAppRefreshTask / BGProcessingTask

```swift
BGTaskScheduler.shared.register(
    forTaskWithIdentifier: "com.sinc.refresh", using: nil
) { task in
    self.handleAppRefresh(task: task)
}
// Schedule
let request = BGAppRefreshTaskRequest(identifier: "com.sinc.refresh")
request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
try BGTaskScheduler.shared.submit(request)
```

- iOS grants ~15–30 min; must call `task.setTaskCompleted(success:)`
- Never loop; only sync what changed since `lastSyncedAt`
- Debounce: if nothing pending, complete immediately (saves battery)

### Sync Flow

```
Client mutation (favorite, playlist edit, history)
        │
        ▼
Optimistic local update (WatermelonDB + React Query cache)
        │
        ▼
Enqueue sync operation (sync_queue table, with type + data + dependencies)
        │
        ▼
When online (or background sync worker fires):
  POST /sync (batched operations)
        │
        ▼
Server applies with conflict resolution, returns authoritative state
        │
        ▼
Client updates local DB, clears queue, invalidates queries
```

### Conflict Resolution

| Entity               | Strategy                                                                             |
| -------------------- | ------------------------------------------------------------------------------------ |
| Favorites            | Union (favorite if either has it)                                                    |
| Play history         | Dedup by trackId+playedAt; keep higher completion                                    |
| Playlist metadata    | Server wins for title/desc/artwork                                                   |
| Playlist track order | Version check; client wins if server unchanged, else merge by last-write-wins per op |
| Settings             | Per-key: security → server wins; UI prefs → client wins; downloads → validated merge |

## 4. Notifications

### Architecture

```
Notification Event (domain event)
        │
        ▼
NotificationService
        │
        ▼
Preference Check (notification_preferences per category)
        │
        ▼
Platform Formatter (title/body/actions/channel per platform)
        │
        ▼
Delivery: Push (FCM/APNs) OR Local (scheduled on device)
```

### Local Notifications (client-scheduled)

| Category           | Example                               | Channel (Android)    |
| ------------------ | ------------------------------------- | -------------------- |
| download.completed | "Download finished — Track Name"      | downloads            |
| download.failed    | "Download failed — Track Name. Retry" | downloads            |
| download.batch     | "Playlist download: 18/42"            | downloads (progress) |
| storage.low        | "Storage almost full"                 | storage              |
| update.available   | "New version available"               | updates              |
| sync.failed        | "Some changes weren't synced"         | sync                 |

Throttling:

- Progress notifications updated at most every 2s (coalesced via NotifyThrottle)
- Aggregate batch progress replaces per-track progress
- Idempotent notification IDs per job (update, not create)

### Push Notifications (server-sent)

| Type             | Trigger                                | Frequency Guard |
| ---------------- | -------------------------------------- | --------------- |
| account.security | login from new device, password change | immediate       |
| admin.security   | admin action on account                | immediate       |
| recommendation   | weekly personalized batch              | weekly, opt-in  |
| product.update   | version release                        | on release      |
| playback.remote  | (reserved)                             | opt-in          |

Push payload:

```json
{
  "title": "...",
  "body": "...",
  "data": {
    "type": "recommendation",
    "deepLink": "sinc://playlist/pl_1",
    "notificationId": "ntf_123"
  },
  "category": "recommendation"
}
```

Notification categories (stable IDs): `download`, `recommendation`, `account`, `security`, `update`, `storage`, `sync`. Each maps to a preference toggle. Users can disable any category.

### Android Channels

- `playback` (music ongoing, low importance, no sound)
- `downloads` (medium, default sound)
- `account` (high, default sound)
- `security` (high, urgent sound)
- `updates` (low)
- `recommendations` (default off per user pref)
- `storage` (low)
- `sync` (low)

### iOS

- Integrates with system Now Playing for playback (not notification)
- Push via APNs with `content-available` only when needed
- Notification grouping via `threadIdentifier`

## 5. Lifecycle Recovery

### Cold Start Recovery Sequence

```
App launches
    │
    ▼
1. Initialize DB (WatermelonDB), check schema migrations
2. Load auth state from secure storage
3. If authenticated:
   a. Restore player state + queue (from native + local persistence)
   b. Reconcile download jobs (local + server)
   c. Replay sync queue (pending mutations)
   d. Restore navigation state (deep link if present)
   e. Resubscribe to WS (realtime)
   f. Check for interrupted operations → show recovery banner
4. If unauthenticated: onboarding/auth flow
```

### Interrupted Download Recovery

- If process killed mid-download:
  - Android: DownloadManager continues independently; on restart, query status and reconcile → job lands or resumes
  - iOS: URLSession background task continues; on restart, delegate fires → reconcile
- Jobs never silently lost: persisted status + server record + OS queue are reconciled

### Interrupted Playback Recovery

- Last track + position persisted (throttled, every 10s + on background/pause)
- On restart: `IDLE` state, "Continue Listening" section shows resume point
- Never auto-resume playback without user intent (avoid surprise audio)

### Crash Handling

- Sentry captures crash (app version, platform, OS, safe breadcrumbs — never tokens)
- On next launch, check for crash → offer to send diagnostics if opted-in
- Background tasks re-run with their own idempotency keys

## Battery & Resource Policy

| Principle              | Implementation                                                          |
| ---------------------- | ----------------------------------------------------------------------- |
| No constant polling    | Event-driven via WS; WorkManager/BGTask batched                         |
| Throttle notifications | Progress coalescing, min interval 2s                                    |
| Constraint-aware work  | WorkManager constraints (network, not-low-battery, idle for heavy sync) |
| Lazy sync              | Only sync dirty state; full sync only on login/reconnect                |
| Download throttling    | Server-side per-user rate limits + concurrency cap                      |
| Reduce wakeups         | Batch multiple pending ops into one WS round trip                       |
| No location services   | Not used                                                                |

## Data Loss Prevention

- All state writes go through WatermelonDB (durable)
- Critical state also mirrored server-side where appropriate (queue positions optional)
- Background workers are idempotent (retry-safe)
- Download job progress is persisted before/after every transition
- Playback position persisted on interruption/background/kill

## Admin Visibility

- Worker heartbeats (`worker:alive` every 30s) → admin health dashboard
- Queue metrics (depth, stalled, failed) via Redis + Prometheus
- Failed job DLQ with manual re-queue
- Per-platform download success rates tracked
