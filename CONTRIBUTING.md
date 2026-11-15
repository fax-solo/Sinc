# Contributing to Sinc

Thank you for your interest in contributing to Sinc! Sinc is a community-driven, local-first music application built with React Native, TypeScript, and modern Android tools.

We welcome contributions of all kinds: bug fixes, new features, translation improvements, documentation updates, and performance optimizations.

---

## 1. Development Principles

Before contributing code, please keep these core tenets in mind:

1. **Local-First & Privacy Sovereign**: Features must operate locally on-device. Do not introduce mandatory remote servers, cloud tracking, analytics telemetry, or user account requirements.
2. **Zero Paid APIs**: Sinc relies on open, legitimate, keyless public metadata providers. Do not introduce mandatory commercial API subscriptions or gated developer credentials.
3. **True Ownership**: User downloads must always be standard, properly-tagged audio files accessible to any music player on the user's device (`Music/Sinc/`).
4. **Resilient Matching**: Audio resolvers must strictly validate stream fingerprints and reject poor matches (such as live bootlegs, nightcore edits, or duration drifts).

---

## 2. Setting Up Your Environment

### Prerequisites

- **Node.js**: `v20.x` or later (LTS recommended)
- **npm**: `v10.x` or later
- **JDK**: Java Development Kit 17 (Zulu or OpenJDK recommended)
- **Android Studio / SDK**: Android SDK Platform 34 (API 34), Android SDK Build-Tools 34.0.0, NDK 26.1.10909125
- **Python**: Python 3.10+ (for building mobile media engine binaries)

### Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/fax-solo/Sinc.git
cd Sinc

# 2. Install workspace dependencies
npm ci

# 3. Build the shared TypeScript package
npm run build -w @sinc/shared

# 4. Prepare on-device media engine binaries (yt-dlp, FFmpeg)
bash scripts/build-mobile-media-binaries.sh

# 5. Launch the Android development environment
npm run android
```

---

## 3. Code Standards & Testing

All contributions must pass code style checks, TypeScript typechecking, and the full test suite before being merged.

### Run Verification Commands

```bash
# Run linting across all workspaces
npm run lint

# Run TypeScript typechecks
npm run typecheck

# Run test suites (Jest + Vitest)
npm test

# Format code with Prettier
npm run format
```

### Commit Guidelines

We recommend following the [Conventional Commits](https://www.conventionalcommits.org/) specification:

- `feat:` A new user-facing feature
- `fix:` A bug fix
- `docs:` Documentation updates
- `refactor:` Code refactoring without behavior change
- `test:` Adding or updating tests
- `chore:` Tooling, workflow, or dependency updates

---

## 4. Pull Request Process

1. **Fork the Repository**: Work from your personal fork on a feature branch (e.g., `feat/artist-top-tracks`).
2. **Write Unit Tests**: Add tests in corresponding `*.test.ts` or `*.test.tsx` files for any new services, stores, or utility functions.
3. **Verify Locally**: Ensure `npm run typecheck` and `npm test` exit with 0 errors.
4. **Submit PR**: Open a Pull Request against the `main` branch with a clear summary of changes, motivation, and manual test evidence.
