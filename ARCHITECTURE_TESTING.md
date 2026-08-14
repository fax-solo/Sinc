# Testing Strategy

## Overview

Testing pyramid: many fast unit tests, fewer integration tests, and a small set of high-value E2E tests. Critical domain logic (search scoring, provider matching, lyric matching, download/playback state machines, permission logic, recommendation engine) is **pure and unit-testable** — it has no I/O dependencies.

## Test Layers

```
        ┌──────────┐   Few, slow, end-to-end user journeys
        │   E2E    │
        ├──────────┤
        │  Mobile  │   Platform-specific (native, background, notifications)
        ├──────────┤
        │Integration│   Auth, DB, providers, downloads, lyrics, sync
        ├──────────┤
        │  Unit    │   Fast, isolated, pure domain logic  ← most tests
        └──────────┘
```

## 1. Unit Tests

### Frameworks

- **Backend**: Vitest (fast, TS-native)
- **Mobile**: Jest + Testing Library (React Native)
- Coverage targets: domain services ≥ 90%, app services ≥ 70%

### Test Targets

| Module                   | What to test                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search-scorer`          | Title/artist/album/duration/isrc/version scoring; fuzzy matching; boundary cases (empty, Unicode, featured-artist stripping)                            |
| `track-normalizer`       | Normalization of "Song (Remix)" vs "Song", diacritics, `&` vs `and`, whitespace, apostrophes, RTL-safe normalization                                    |
| `deduplicator`           | Groups same track across 5 providers into one; merges provider IDs; picks highest-confidence representative; handles conflicting durations              |
| `lyric-matcher`          | Matches correct lyrics; rejects wrong version; confidence thresholds; fallback to plain when synced missing                                             |
| `download-state-machine` | Every valid transition; invalid transitions throw; terminal states; retry paths                                                                         |
| `playback-state-machine` | IDLE→LOADING→BUFFERING→PLAYING⇄PAUSED→ENDED→ERROR; invalid transitions                                                                                  |
| `recommendation-engine`  | Familiar/similar/discovery split (70/20/10 configurable); weighting by play count, completion, recency; dedup against history; configurable percentages |
| `source-resolver`        | ISRC-first scoring; never auto-selects low-confidence; provider failure doesn't crash; fallback chain                                                   |
| `conflict-resolver`      | Favorite union; playlist version conflicts; history dedup; per-setting rules                                                                            |
| `permission-logic`       | Role rank checks; route-level guards; capability checks                                                                                                 |
| `fuzzy-search`           | Misspellings, partial titles, multi-word queries, normalized queries                                                                                    |
| `filename-sanitizer`     | Illegal chars, reserved names, length limits, Unicode edge cases                                                                                        |
| `id` generator           | ULID uniqueness, sortability                                                                                                                            |

### Example: Download State Machine Test

```typescript
describe('DownloadStateMachine', () => {
  it('allows QUEUED → RESOLVING', () => {
    const sm = new DownloadStateMachine();
    expect(sm.canTransition('QUEUED', 'RESOLVING')).toBe(true);
  });

  it('rejects QUEUED → COMPLETED', () => {
    const sm = new DownloadStateMachine();
    expect(() => sm.transition(job('QUEUED'), 'COMPLETED')).toThrow();
  });

  it('allows FAILED → QUEUED (retry)', () => {
    const sm = new DownloadStateMachine();
    expect(sm.canTransition('FAILED', 'QUEUED')).toBe(true);
  });

  it('treats COMPLETED as terminal', () => {
    const sm = new DownloadStateMachine();
    expect(sm.canTransition('COMPLETED', 'FAILED')).toBe(false);
  });
});
```

### Example: Search Scorer Test

```typescript
describe('SearchScorer', () => {
  it('scores exact title highest', () => {
    const score = scorer.score(normQuery('Shape of You'), {
      title: 'Shape of You',
      artistNames: ['Ed Sheeran'],
    });
    expect(score.titleScore).toBe(1.0);
  });

  it('handles misspellings', () => {
    const score = scorer.score(normQuery('Shape of Yu'), {
      title: 'Shape of You',
      artistNames: [],
    });
    expect(score.titleScore).toBeGreaterThan(0.8);
  });

  it('penalizes wrong version', () => {
    const a = scorer.score(normQuery('Shape of You', 'Remix'), {
      title: 'Shape of You',
      version: 'Remix',
    });
    const b = scorer.score(normQuery('Shape of You', 'Remix'), {
      title: 'Shape of You',
      version: 'Acoustic',
    });
    expect(a.versionScore).toBeGreaterThan(b.versionScore);
  });
});
```

## 2. Integration Tests

### Backend Integration (Vitest + Testcontainers)

- Real PostgreSQL + Redis via Testcontainers (or local docker-compose dev DB)
- HTTP integration via Fastify `app.inject()` (no real network to outside)

| Test              | Covers                                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| Auth integration  | Register→verify→login→refresh→logout; token rotation; reuse detection; revocation                              |
| Users             | Profile update; settings; account deletion flow; role changes                                                  |
| Music             | Search fan-out with mocked providers; dedup; caching; source resolve; lyrics with mocked lyrics providers      |
| Playlists         | CRUD; reorder with version conflicts; collaborative edits; duplicate                                           |
| Favorites/History | CRUD; sync batch upload; dedup; stats                                                                          |
| Downloads         | Full job lifecycle via queue worker (mocked storage/provider); progress; retry; cancel; batch; signed URL flow |
| Lyrics            | Cache hit/miss; provider fallback; wrong-version rejection                                                     |
| Sync              | Batch mutation apply; conflict resolution outcomes                                                             |
| Admin             | RBAC enforcement; MFA challenge; audit logging; provider disable/enable; feature flags                         |
| Rate limits       | Sliding window behavior; 429 responses                                                                         |

### Mobile Integration (Jest + WatermelonDB in-memory + MSW)

- Repository tests against in-memory WatermelonDB
- API client tests with mocked network (MSW)
- Zustand store tests (playback, download, auth flows)
- Sync manager with mocked WS

## 3. Mobile Platform Tests

### Detox E2E (Android + iOS simulators)

Critical flows:

```
Register → Login → Search → Open song → Play → Pause → Seek
→ Add favorite → Create playlist → Add track → Download
→ Receive notification → Open downloaded song → Go offline
→ Play downloaded song → Open lyrics
```

Config: two projects (android, ios), per-platform `launchArgs`, CI on local simulators/emulators.

### Native Module Tests

- Android: JUnit for ExoPlayer service, DownloadManager receiver, notifications, MediaSession callbacks
- iOS: XCTest for AVAudioSession handling, Now Playing update, remote command responses, URLSession background delegate

### Manual QA Checklist (per release)

- Background audio on Android (screen lock, app switch) and iOS (lock, background)
- Bluetooth / headset pause behavior
- Notification actions (play/pause/next from notification)
- Deep link handling (cold/warm, logged out)
- Offline mode: browse/play downloads, queue actions fail gracefully
- Low storage warning
- Data saver / Wi-Fi-only enforcement
- RTL layout (Arabic)
- Dynamic type (iOS) / font scaling (Android)
- Dark mode + system appearance
- Reduced motion

## 4. E2E Tests (Backend)

- Contract tests: verify API responses match the OpenAPI spec
- Full user journey against a deployed staging stack (scripted + CI nightly):
  register → search → play (mocked) → favorite → playlist → download job → complete → notifications
- Chaos: kill worker mid-download → verify job recovers/requeues (failure/recovery)

## 5. Performance Tests

- **Backend**:
  - k6 load tests: login, search, home feed, downloads list at expected peak (e.g., 500 RPS)
  - Search fan-out latency budget (target p95 < 500ms with caching)
  - Queue throughput test (1000 downloads enqueue/process)
- **Mobile**:
  - React Profiler: screen render budgets (Home < 16ms on mid-range)
  - FPS check for scroll/lists/lyrics scrolling
  - Startup time (cold start target < 2s on mid-range Android)
  - Memory usage during long playback / large library
  - Network throttling profiles (3G/4G/offline)

## 6. Failure / Recovery Tests

| Scenario                        | Expected                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------- |
| Worker killed mid-download      | Job re-queued; no duplicate finalization (idempotency)                           |
| Redis down                      | API still serves reads (DB fallback); rate limiting skipped w/ log               |
| Provider outage                 | Search returns fewer results; source resolve says "Source unavailable"; no crash |
| PostgreSQL down                 | API returns 503 with health degraded; worker pauses                              |
| App process killed mid-playback | Position persisted; "Continue Listening" on next start                           |
| App process killed mid-download | Job reconciled on next start (OS manager or server record)                       |
| Network loss mid-download       | Job paused → resumes on reconnect (native manager)                               |
| Refresh token theft reuse       | All sessions revoked + security notification                                     |
| Partial lyrics failure          | Download completes; lyrics marked unavailable                                    |
| Low disk during download        | Download fails cleanly; storage warning notification                             |

## 7. Test Infrastructure

- CI (GitHub Actions):
  - Backend: `test:unit` → `test:integration` → `test:e2e` → coverage gate
  - Mobile: `test:unit` (Jest) → lint → typecheck → Detox (on tagged PRs/nightly)
  - Deployment check: `docker compose` smoke test in CI
- Coverage gate: 80% line coverage on backend domain + app services; 90% domain
- Fixtures: `tests/fixtures/` for provider responses (MusicBrainz, Last.fm, LRCLIB), lyrics samples, track samples
- Mock providers: in-memory provider implementations for integration tests

## 8. Test Commands (planned package.json scripts)

```json
{
  "backend": {
    "test": "vitest run",
    "test:unit": "vitest run tests/unit",
    "test:integration": "vitest run tests/integration",
    "test:e2e": "vitest run tests/e2e",
    "test:coverage": "vitest run --coverage",
    "test:contract": "vitest run tests/contract"
  },
  "mobile": {
    "test": "jest",
    "test:unit": "jest src",
    "test:e2e:android": "detox test --configuration android",
    "test:e2e:ios": "detox test --configuration ios",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit"
  }
}
```

## 9. Quality Gates (Definition of Done)

A feature is done only when:

- [ ] Unit tests for domain logic pass (≥90% coverage on changed domain)
- [ ] Integration tests for new API paths pass
- [ ] Mobile tests (store/repo/component) pass
- [ ] Loading / empty / error / offline states implemented
- [ ] Accessibility labels + dynamic type verified
- [ ] Dark mode + RTL verified
- [ ] Lifecycle behavior verified (background/foreground/kill)
- [ ] Platform-specific behavior verified (Android vs iOS)
- [ ] Analytics + logging events added
- [ ] No secrets, no `console.log` in prod code
- [ ] Performance budget met (render, startup, memory)
- [ ] E2E path updated/verified where applicable
