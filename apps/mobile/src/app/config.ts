/**
 * App-wide configuration.
 *
 * Dev: on a physical device the backend is reachable through an adb reverse
 * tunnel (`adb reverse tcp:3000 tcp:3000`), so localhost maps to the host.
 *
 * Prod: point this at your HTTPS API (e.g. https://api.example.com). The
 * Hostinger deployment runs nginx + Let's Encrypt in front of the container on
 * port 443. Mobile apps reject cleartext HTTP in production, so this MUST be
 * an https:// URL when deployed.
 */
export const config = {
  apiBaseUrl: 'http://127.0.0.1:3000',
  // Release distribution: Sinc is sideloaded from the public GitHub repo. The
  // app checks the latest GitHub release for a newer APK.
  githubRepo: 'fax-solo/Sinc',
  githubReleasePageUrl: 'https://github.com/fax-solo/Sinc/releases/latest',
} as const;
