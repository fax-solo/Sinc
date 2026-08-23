/**
 * Forced-update gate (M9.3). The server exposes the minimum supported app
 * version at /app/version; if the installed build is older, the app shows a
 * blocking "update required" screen instead of normal UI. The check is
 * fire-and-forget and non-fatal: if the API is unreachable the app proceeds
 * normally so offline/library usage is never interrupted.
 */
import { apiClient } from '../../api/client';

export const APP_VERSION = '0.1.0';

interface AppVersionResponse {
  name: string;
  version: string;
  minAppVersion: string;
}

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

export interface UpdateStatus {
  blocked: boolean;
  minAppVersion: string;
}

export async function checkForcedUpdate(): Promise<UpdateStatus> {
  try {
    const info = await apiClient.get<AppVersionResponse>('/app/version');
    const blocked = isVersionOlder(APP_VERSION, info.minAppVersion);
    return { blocked, minAppVersion: info.minAppVersion };
  } catch {
    return { blocked: false, minAppVersion: '' };
  }
}
