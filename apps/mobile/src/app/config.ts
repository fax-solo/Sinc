/**
 * App-wide configuration.
 *
 * The local build talks directly to third-party providers (iTunes, Deezer,
 * LRCLIB, the on-device yt-dlp binary, Internet Archive...) — never to our own
 * backend. Optional provider API keys are left empty by default.
 */
export const config = {
  // Release distribution: Sinc is sideloaded from the public GitHub repo. The
  // app checks the latest GitHub release for a newer APK.
  githubRepo: 'fax-solo/Sinc',
  githubReleasePageUrl: 'https://github.com/fax-solo/Sinc/releases/latest',
  // Optional: unset keys disable those direct download sources.
  jamendoClientId: '',
  fmaApiKey: '',
} as const;
