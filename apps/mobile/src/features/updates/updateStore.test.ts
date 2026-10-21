import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateCheckResult, LatestRelease } from '../../services/updates/appUpdates';
import { useUpdateStore } from './updateStore';
import { storage, STORAGE_KEYS } from '../../utils/storage';

const { mockedCheckUpdates, mockedNotify } = vi.hoisted(() => ({
  mockedCheckUpdates: vi.fn(),
  mockedNotify: vi.fn(),
}));

vi.mock('../../services/updates/appUpdates', async (importOriginal) => {
  const actual = await importOriginal<{ UPDATE_CHECK_COOLDOWN_MS: number }>();
  return {
    ...actual,
    checkForUpdates: mockedCheckUpdates,
  };
});

vi.mock('../../services/notifications', () => ({
  sincNotifications: {
    available: true,
    showUpdateAvailable: mockedNotify,
  },
}));

function release(overrides: Partial<LatestRelease> = {}): LatestRelease {
  return {
    versionName: '1.2.3',
    versionCode: 10203,
    apkUrl: 'https://example.com/sinc-1.2.3-10203.apk',
    notes: null,
    publishedAt: null,
    ...overrides,
  };
}

function softResult(overrides: Partial<UpdateCheckResult> = {}): UpdateCheckResult {
  return {
    available: false,
    latest: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockedCheckUpdates.mockReset();
  mockedNotify.mockReset();
  storage.clear();
  useUpdateStore.setState({
    checked: false,
    latest: null,
    softStatus: 'idle',
    remindedFor: null,
    bannerDismissedFor: null,
    lastCheckAt: null,
  });
});

describe('updateStore.check (cooldown)', () => {
  it('runs on cold start when no check has happened yet', async () => {
    mockedCheckUpdates.mockResolvedValue(softResult());

    await useUpdateStore.getState().check();

    expect(mockedCheckUpdates).toHaveBeenCalledTimes(1);
    expect(useUpdateStore.getState().checked).toBe(true);
    expect(useUpdateStore.getState().lastCheckAt).not.toBeNull();
    expect(useUpdateStore.getState().softStatus).toBe('error');
  });

  it('skips within the cooldown and runs again once it has elapsed', async () => {
    mockedCheckUpdates.mockResolvedValue(softResult());
    useUpdateStore.setState({ lastCheckAt: Date.now() });

    await useUpdateStore.getState().check();
    expect(mockedCheckUpdates).toHaveBeenCalledTimes(0);

    useUpdateStore.setState({ lastCheckAt: Date.now() - 7 * 60 * 60 * 1000 });
    await useUpdateStore.getState().check();
    expect(mockedCheckUpdates).toHaveBeenCalledTimes(1);
  });

  it('force bypasses the cooldown', async () => {
    mockedCheckUpdates.mockResolvedValue(softResult());
    useUpdateStore.setState({ lastCheckAt: Date.now() });

    await useUpdateStore.getState().check({ force: true });

    expect(mockedCheckUpdates).toHaveBeenCalledTimes(1);
  });
});

describe('updateStore reminders', () => {
  it('marks available and notifies once per release', async () => {
    mockedCheckUpdates.mockResolvedValue(softResult({ available: true, latest: release() }));

    await useUpdateStore.getState().check();
    await useUpdateStore.getState().check({ force: true });

    expect(useUpdateStore.getState().softStatus).toBe('available');
    expect(useUpdateStore.getState().latest?.versionName).toBe('1.2.3');
    expect(useUpdateStore.getState().remindedFor).toBe('1.2.3');
    expect(mockedNotify).toHaveBeenCalledTimes(1);
    expect(mockedNotify).toHaveBeenCalledWith(
      '1.2.3',
      'https://github.com/fax-solo/Sinc/releases/latest'
    );
  });

  it('reminds again when a newer release appears', async () => {
    mockedCheckUpdates.mockResolvedValue(softResult({ available: true, latest: release() }));
    await useUpdateStore.getState().check();
    expect(mockedNotify).toHaveBeenCalledTimes(1);

    mockedCheckUpdates.mockResolvedValue(
      softResult({ available: true, latest: release({ versionName: '2.0.0', versionCode: 20000 }) })
    );
    await useUpdateStore.getState().check({ force: true });

    expect(useUpdateStore.getState().remindedFor).toBe('2.0.0');
    expect(mockedNotify).toHaveBeenCalledTimes(2);
  });

  it('persists the reminded release to storage', async () => {
    mockedCheckUpdates.mockResolvedValue(softResult({ available: true, latest: release() }));

    await useUpdateStore.getState().check();

    const persisted = storage.getString(STORAGE_KEYS.UPDATES);
    expect(persisted).toContain('"remindedFor":"1.2.3"');
  });
});

describe('updateStore.checkSoft', () => {
  it('always runs (manual) and reports up to date', async () => {
    mockedCheckUpdates.mockResolvedValue(
      softResult({ available: false, latest: release({ versionName: '0.0.9', versionCode: 9 }) })
    );

    await useUpdateStore.getState().checkSoft();

    expect(mockedCheckUpdates).toHaveBeenCalledTimes(1);
    expect(useUpdateStore.getState().softStatus).toBe('up-to-date');
  });

  it('does not re-enter while a check is already running', async () => {
    let resolveSoft!: (value: UpdateCheckResult) => void;
    mockedCheckUpdates.mockImplementation(
      () => new Promise<UpdateCheckResult>((resolve) => (resolveSoft = resolve))
    );

    const first = useUpdateStore.getState().checkSoft();
    expect(useUpdateStore.getState().softStatus).toBe('checking');

    const second = useUpdateStore.getState().checkSoft();

    resolveSoft(softResult());

    await Promise.all([first, second]);
    expect(mockedCheckUpdates).toHaveBeenCalledTimes(1);
  });

  it('marks error when no release info is reachable', async () => {
    mockedCheckUpdates.mockResolvedValue(softResult());

    await useUpdateStore.getState().checkSoft();

    expect(useUpdateStore.getState().softStatus).toBe('error');
    expect(useUpdateStore.getState().latest).toBeNull();
  });
});

describe('updateStore.dismissBanner', () => {
  it('remembers dismissal for the current release', async () => {
    mockedCheckUpdates.mockResolvedValue(softResult({ available: true, latest: release() }));
    await useUpdateStore.getState().check();

    useUpdateStore.getState().dismissBanner();

    expect(useUpdateStore.getState().bannerDismissedFor).toBe('1.2.3');
  });

  it('does nothing when no release is known', () => {
    useUpdateStore.getState().dismissBanner();
    expect(useUpdateStore.getState().bannerDismissedFor).toBeNull();
  });
});
