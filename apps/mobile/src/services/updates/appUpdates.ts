/**
 * Update discovery. Sinc is distributed as a sideloaded APK through the public
 * GitHub repo, so the latest published release is the single source of truth
 * for updates (no backend involved). The check is fire-and-forget and
 * non-fatal: if the release feed is unreachable the app proceeds normally so
 * offline/library usage is never interrupted.
 */
import { config } from '../../app/config';

export const APP_VERSION = '0.2.0';

/** Compares dotted numeric versions. Returns true when a is older than b. */
export function isVersionOlder(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na < nb;
  }
  return false;
}

interface GitHubReleasePayload {
  tag_name: string;
  name: string | null;
  body: string | null;
  published_at: string | null;
  assets: Array<{ name: string; browser_download_url: string }>;
}

export interface LatestRelease {
  versionName: string;
  versionCode: number;
  apkUrl: string;
  notes: string | null;
  publishedAt: string | null;
}

const APK_ASSET_PATTERN = /^sinc-(\d+)\.(\d+)\.(\d+)-(\d+)\.apk$/i;

/**
 * Fetches the newest published release of Sinc from the public GitHub repo. The
 * version is parsed from the `sinc-<major>.<minor>.<patch>-<code>.apk` asset
 * name (single source of truth produced by the release workflow). Any failure
 * (offline, repo unreachable, no APK asset) resolves to null — update checks
 * must never disturb the user.
 */
export async function fetchLatestRelease(): Promise<LatestRelease | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${config.githubRepo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as GitHubReleasePayload;
    const asset = data.assets.find((a) => APK_ASSET_PATTERN.test(a.name));
    if (!asset) return null;
    const match = APK_ASSET_PATTERN.exec(asset.name);
    if (!match) return null;
    return {
      versionName: `${match[1]}.${match[2]}.${match[3]}`,
      versionCode: parseInt(match[4], 10),
      apkUrl: asset.browser_download_url,
      notes: data.body ?? null,
      publishedAt: data.published_at ?? null,
    };
  } catch {
    return null;
  }
}

export interface UpdateCheckResult {
  available: boolean;
  latest: LatestRelease | null;
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const latest = await fetchLatestRelease();
  if (!latest) return { available: false, latest: null };
  return { available: isVersionOlder(APP_VERSION, latest.versionName), latest };
}

/** Positive length between automatic checks (GitHub API: 60 req/hr unauthenticated). */
export const UPDATE_CHECK_COOLDOWN_MS = 6 * 60 * 60 * 1000;
