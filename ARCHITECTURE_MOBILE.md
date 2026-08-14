# Mobile Architecture

## Overview

The mobile application follows a layered architecture with clear separation between UI, presentation state, application logic, domain, and data sources. Built with React Native 0.74+ using TypeScript, with native modules for platform-critical functionality.

## Navigation Architecture

### Primary Navigation Structure

```
Root Navigator (Stack)
├── Auth Stack (when unauthenticated)
│   ├── Welcome / Onboarding
│   ├── Login
│   ├── Register
│   ├── Email Verification
│   ├── Password Reset
│   └── Biometric Setup (optional)
│
├── Main App (Tab Navigator) - Authenticated
│   ├── Home Tab (Stack)
│   │   ├── Home Screen
│   │   ├── Song Details
│   │   ├── Artist Details
│   │   ├── Album Details
│   │   ├── Playlist Details
│   │   ├── Recommended Music
│   │   └── Quick Mixes
│   │
│   ├── Search Tab (Stack)
│   │   ├── Search Screen
│   │   ├── Search Results
│   │   ├── Search Filters
│   │   ├── Song Details
│   │   ├── Artist Details
│   │   ├── Album Details
│   │   └── Playlist Details
│   │
│   ├── Library Tab (Stack)
│   │   ├── Library Root
│   │   ├── Tracks
│   │   ├── Artists
│   │   ├── Albums
│   │   ├── Playlists
│   │   ├── Favorites
│   │   ├── Recently Played
│   │   ├── Recently Downloaded
│   │   ├── History
│   │   ├── Song Details
│   │   ├── Artist Details
│   │   ├── Album Details
│   │   └── Playlist Details (Edit/Create)
│   │
│   ├── Downloads Tab (Stack)
│   │   ├── Downloads Dashboard
│   │   ├── Download Queue
│   │   ├── Download Details
│   │   ├── Active Downloads
│   │   ├── Completed Downloads
│   │   ├── Failed Downloads
│   │   └── Download Settings
│   │
│   └── Profile Tab (Stack)
│       ├── Profile / Settings
│       ├── Account
│       ├── Notifications
│       ├── Storage
│       ├── Playback Settings
│       ├── Download Settings
│       ├── Lyrics Settings
│       ├── Privacy
│       ├── Security
│       ├── Biometric Settings
│       ├── Active Sessions
│       ├── About
│       └── Admin Dashboard (if admin)
│
├── Global Overlays (Modal Stack)
│   ├── Full Screen Player (always accessible)
│   ├── Lyrics Screen
│   ├── Queue Screen
│   ├── Share Sheet
│   ├── Add to Playlist
│   ├── Create Playlist
│   ├── Edit Playlist
│   └── Deep Link Handlers
│
└── Admin Stack (separate, guarded)
    ├── Admin Dashboard
    ├── Admin Users
    ├── Admin Roles
    ├── Admin Providers
    ├── Admin Logs
    └── Admin System Health
```

### Navigation Principles

- **Tab Navigator** for primary sections (persistent, swipeable on iOS)
- **Stack Navigators** per tab for drill-down navigation
- **Modal Stack** for global overlays (player, lyrics, queue)
- **Deep Linking**: All screens accessible via `sinc://` and `https://sinc.app/` URLs
- **State Preservation**: Navigation state persisted to disk for cold start restoration

### Mini-Player Integration

The mini-player exists **above** the tab navigator in the render hierarchy:

```
<NavigationContainer>
  <MiniPlayerProvider>
    <RootNavigator />
    <MiniPlayer />  // Fixed position, above tabs
    <GlobalModals /> // Player, Lyrics, Queue, Share
  </MiniPlayerProvider>
</NavigationContainer>
```

- Visible when `playbackState.currentTrack != null`
- Tap opens Full Screen Player (modal)
- Swipe down on Full Player minimizes to Mini Player

## State Management Architecture

### State Categories

| Category            | Technology               | Persistence                                | Scope          |
| ------------------- | ------------------------ | ------------------------------------------ | -------------- |
| **Server State**    | TanStack Query v5        | React Query Cache + WatermelonDB (offline) | Global         |
| **Client UI State** | Zustand                  | Memory only                                | Feature-scoped |
| **Auth State**      | Zustand + Secure Storage | Encrypted (Keychain/Keystore)              | Global         |
| **Playback State**  | Zustand + Native Module  | Memory + Native (persisted)                | Global         |
| **Download State**  | Zustand + WatermelonDB   | SQLite (persistent)                        | Global         |
| **Network State**   | Zustand + NetInfo        | Memory                                     | Global         |
| **Settings**        | WatermelonDB + MMKV      | SQLite + MMKV                              | Global         |
| **Local Library**   | WatermelonDB             | SQLite (primary)                           | Global         |

### Global Stores (Zustand)

See `ARCHITECTURE_MOBILE_STORES.md` for complete store definitions.

### TanStack Query Configuration

See `ARCHITECTURE_MOBILE_QUERY.md` for query client configuration.

### WatermelonDB Models (Local Database)

See `ARCHITECTURE_MOBILE_DATABASE.md` for complete model definitions.

### Repository Pattern (Interfaces)

See `ARCHITECTURE_MOBILE_REPOSITORIES.md` for repository interfaces.
