# Releasing the Android app (maintainers)

The `v*` tag push workflow (`.github/workflows/release-apk.yml`) builds a release APK,
publishes it as a GitHub release named `sinc-<major>.<minor>.<patch>-<code>.apk`, and the
app's "About & updates" screen tells users when a newer build exists.

## One-time setup

1. Generate the release keystore and add the four secrets it prints to
   **Settings > Secrets and variables > Actions**:

   ```bash
   bash scripts/generate-release-keystore.sh
   ```

2. The release signing key must never change, or existing installs cannot update.

## Cutting a release

1. Bump `APP_VERSION` in `apps/mobile/src/services/updates/appUpdates.ts` to match the new
   version (the workflow refuses to build if the tag and constant disagree), then commit.
2. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. The workflow builds `sinc-X.Y.Z-<code>.apk`, uploads it to a release with auto-generated
   notes, and the app surfaces an "Update available" download for it.
