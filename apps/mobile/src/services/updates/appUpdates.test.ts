import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkForUpdates, fetchLatestRelease, isVersionOlder, APP_VERSION } from './appUpdates';

describe('isVersionOlder', () => {
  it('compares dotted numeric versions', () => {
    expect(isVersionOlder('0.1.0', '0.2.0')).toBe(true);
    expect(isVersionOlder('0.2.0', '0.1.0')).toBe(false);
    expect(isVersionOlder('1.0.0', '1.0.1')).toBe(true);
    expect(isVersionOlder('1.0.1', '1.0.0')).toBe(false);
    expect(isVersionOlder('1.0.0', '1.0.0')).toBe(false);
  });

  it('handles differing segment counts and invalid segments', () => {
    expect(isVersionOlder('1', '1.0.1')).toBe(true);
    expect(isVersionOlder('1.0.1', '1')).toBe(false);
    expect(isVersionOlder('abc', '1.0.0')).toBe(true);
  });
});

const releasePayload = {
  tag_name: 'v1.2.3',
  name: 'sinc 1.2.3',
  body: 'Release notes',
  published_at: '2026-01-02T03:04:05Z',
  assets: [
    {
      name: 'sinc-1.2.3-10203.apk',
      browser_download_url: 'https://example.com/sinc-1.2.3-10203.apk',
    },
  ],
};

function stubFetchOk(body: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => body }));
}

function stubFetchError() {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchLatestRelease', () => {
  it('parses the version from the sinc APK asset name', async () => {
    stubFetchOk(releasePayload);
    const latest = await fetchLatestRelease();
    expect(latest).toEqual({
      versionName: '1.2.3',
      versionCode: 10203,
      apkUrl: 'https://example.com/sinc-1.2.3-10203.apk',
      notes: 'Release notes',
      publishedAt: '2026-01-02T03:04:05Z',
    });
  });

  it('returns null when no release asset matches the sync name', async () => {
    stubFetchOk({
      ...releasePayload,
      assets: [{ name: 'app-universal.apk', browser_download_url: 'https://example.com/x.apk' }],
    });
    expect(await fetchLatestRelease()).toBeNull();
  });

  it('returns null on a non-ok response', async () => {
    stubFetchError();
    expect(await fetchLatestRelease()).toBeNull();
  });

  it('returns null when the network request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await fetchLatestRelease()).toBeNull();
  });
});

describe('checkForUpdates', () => {
  it('reports an available update when the latest release is newer', async () => {
    stubFetchOk(releasePayload);
    const result = await checkForUpdates();
    expect(result.available).toBe(true);
    expect(result.latest?.versionName).toBe('1.2.3');
  });

  it('reports up to date when the latest release is not newer than APP_VERSION', async () => {
    stubFetchOk({
      ...releasePayload,
      assets: [
        {
          name: `sinc-${APP_VERSION}-99.apk`,
          browser_download_url: 'https://example.com/old.apk',
        },
      ],
    });
    const result = await checkForUpdates();
    expect(result.available).toBe(false);
    expect(result.latest?.versionName).toBe(APP_VERSION);
  });

  it('reports no update and no latest when the fetch fails', async () => {
    stubFetchError();
    expect(await checkForUpdates()).toEqual({ available: false, latest: null });
  });
});
