# M7 + M8 Status — Advanced Mobile Features & Administration

Completion status as of this session. Both milestones are implemented across the
mobile app (`apps/mobile`) and the Fastify server (`apps/server`); deep links and
biometric unlock need an Android rebuild + reinstall to become active on device.

## M7 — Advanced Mobile Features (implemented)

### M7.1 Deep Links & Sharing ✅

- **Routing** — `apps/mobile/src/app/navigation/linking.ts` registers deep-link
  prefixes `sinc://`, `sincapp://` and `https://sinc.app` and maps public paths
  onto the navigation tree: `song/:id` → Player, `album/:id`, `artist/:id`,
  `playlist/:id`, `mix/:id`, plus `home` / `search` / `library` tabs. Wired into
  `NavigationContainer` (`RootNavigator.tsx`).
- **Manifest** — `AndroidManifest.xml` gains an `android:autoVerify` https
  intent-filter for `sinc.app` and two custom-scheme filters (`sinc`, `sincapp`).
- **Song links** — `Player` route now accepts an optional `trackId`; the screen
  fetches the track and starts playback when the linked track isn't already the
  current one.
- **Mix links** — `Mix` accepts `mixId` alone; `MixScreen` resolves it from the
  cached personalized feed, then refetches the feed if needed. (Reuses the daily
  mixes section — no new server endpoint required.)
- **Sharing** — `apps/mobile/src/utils/share.ts` builds `https://sinc.app/…`
  links and opens the native share sheet. Share buttons added to Album, Playlist,
  Mix, Artist and the Player (song) screens.
- Requires an Android rebuild (manifest change) to test end-to-end.

### M7.2 Accessibility & RTL polish ✅

- **Labels/roles** — `accessibilityRole` + `accessibilityLabel` added to
  `SongRow`, `TrackCard`, `AlbumCard`, `ArtistCard`, `PlaylistCard`, `SearchBar`,
  Library `SectionRow`, back buttons and the share buttons (download/add buttons
  already had labels).
- **RTL** — `apps/mobile/src/utils/rtl.ts` provides `chevronIcon()` which mirrors
  chevron/back glyphs under `I18nManager.isRTL`; wired into the Library screens.
  The manifest already declares `supportsRtl="true"`.
- **Reduced motion** — `apps/mobile/src/hooks/useReduceMotion.ts` wraps
  `AccessibilityInfo`; the Lyrics screen's looping shine sweep is suppressed when
  "Remove animations" is enabled (the static highlight remains readable).

### M7.3 Biometric Security ✅ (PIN active; biometrics behind rebuild)

- **PIN app lock** — `apps/mobile/src/services/security/pin.ts` stores a salted
  FNV-1a hash (4–6 digit PIN). `features/lock/lockStore.ts` (persisted) tracks
  armed/enabled state; session `unlocked` state is never persisted.
- **Lock gate** — `LockScreen.tsx` (PIN entry, error handling, biometric shortcut)
  rendered by `LockGate` in `RootNavigator` whenever the lock is armed but not
  unlocked. `App.tsx` re-arms the lock via `AppState` the moment the app leaves
  the foreground.
- **Settings** — Library → **Security** (`features/lock/SecuritySettings.tsx`):
  enable/disable, set/change PIN, and a **Biometric unlock** toggle backed by
  `react-native-keychain` (`services/security/biometric.ts`, `BIOMETRY_CURRENT_SET`
  access control in the OS keystore). The toggle only appears when the native
  module is linked — current installed build hides it until rebuild.

### M7.4 Widgets / Vehicle extension points ✅ (architecture hooks)

- `apps/mobile/src/services/widgets/widgetBridge.ts` — `HomeWidgetBridge` surface
  (update now-playing, quick-play shortcuts) with a no-op fallback and documented
  steps for a native `AppWidgetProvider` (now playing / quick play widgets).
- `apps/mobile/src/services/vehicle/vehicleBridge.ts` — `VehicleBridge` surface
  (publish queue + index, transport commands) with a no-op fallback, documented
  as the hook around the existing Media3 `PlaybackService` (MediaBrowserService /
  Android Auto). No Kotlin written yet — stubs only, per the roadmap.

## M8 — Administration (implemented)

> Note: this milestone was implemented by the parallel working session. Summary
> reflects the code present in the repo; on-device verification was not performed
> by this session.

### M8.1 Admin Backend ✅

- **RBAC** — `apps/server/src/plugins/guard.js` `adminGuard` enforces the `admin`
  role on every `/admin/*` route; only admins can manage users/sessions/playlists.
- **Module** — `apps/server/src/modules/admin/` (`routes.ts`, `service.ts`,
  `routes.test.ts`):
  - Stats: overview + 14-day activity (`/admin/stats/overview`,
    `/admin/stats/activity`).
  - Users: list/search, detail, delete, suspend/unsuspend, promote/demote,
    reset password; session listing + revocation.
  - Playlists: list/search + delete.
  - Audit log: every admin action is recorded and queryable (`/admin/audit`).
- **MFA (TOTP)** — `apps/server/src/lib/totp.js` + `/admin/mfa/*`:
  enroll (fresh secret + otpauth URI), verify (code + IP logged), disable.
  Enabling/disabling requires a valid TOTP code.

### M8.2 Admin Mobile (Admin screen) ✅

- `apps/mobile/src/features/admin/AdminScreen.tsx` + `apps/mobile/src/api/admin.ts`:
  - Stats cards + activity chart data.
  - User list with per-user actions (promote/demote, suspend/unsuspend, reset
    password, delete) behind a confirm dialog.
  - Audit log list.
  - MFA setup/disable flow with 6-digit code entry.
- Only reachable by admins: the `Admin` screen is added to `RootNavigator` when
  `user.role === 'admin'` (`RootNavigator.tsx:103`).

## Verification status

- `apps/mobile`: `tsc --noEmit` clean, ESLint 0 errors, vitest 87/87 passing.
- M7 PIN lock + share buttons verified on device; deep links and biometrics
  pending an Android rebuild (`cd android && ./gradlew assembleDebug`).
- M8 server routes have unit tests; admin flows not yet exercised on device.
