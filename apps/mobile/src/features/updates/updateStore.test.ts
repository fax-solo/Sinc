import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateCheckResult, UpdateStatus } from '../../services/updates/appUpdates';
import type * as appUpdatesModule from '../../services/updates/appUpdates';
import { useUpdateStore } from './updateStore';

const { mockedForcedUpdate, mockedCheckUpdates } = vi.hoisted(() => ({
  mockedForcedUpdate: vi.fn(),
  mockedCheckUpdates: vi.fn(),
}));

vi.mock('../../services/updates/appUpdates', async (importOriginal) => {
  const actual = await importOriginal<typeof appUpdatesModule>();
  return {
    ...actual,
    checkForcedUpdate: mockedForcedUpdate,
    checkForUpdates: mockedCheckUpdates,
  };
});

const forcedStatus: UpdateStatus = { blocked: false, minAppVersion: '0.0.0' };

function softResult(overrides: Partial<UpdateCheckResult> = {}): UpdateCheckResult {
  return {
    available: false,
    latest: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockedForcedUpdate.mockReset();
  mockedCheckUpdates.mockReset();
  useUpdateStore.setState({
    checked: false,
    blocked: false,
    minAppVersion: '',
    latest: null,
    softStatus: 'idle',
  });
});

describe('updateStore.check', () => {
  it('runs the forced gate and the soft check together once per session', async () => {
    mockedForcedUpdate.mockResolvedValue(forcedStatus);
    mockedCheckUpdates.mockResolvedValue(softResult());

    await useUpdateStore.getState().check();
    await useUpdateStore.getState().check();

    expect(mockedForcedUpdate).toHaveBeenCalledTimes(1);
    expect(mockedCheckUpdates).toHaveBeenCalledTimes(1);
    expect(useUpdateStore.getState().checked).toBe(true);
    expect(useUpdateStore.getState().blocked).toBe(false);
    expect(useUpdateStore.getState().softStatus).toBe('error');
  });

  it('marks an available update when the latest release is newer', async () => {
    mockedForcedUpdate.mockResolvedValue(forcedStatus);
    mockedCheckUpdates.mockResolvedValue(
      softResult({
        available: true,
        latest: {
          versionName: '1.2.3',
          versionCode: 10203,
          apkUrl: 'https://example.com/sinc-1.2.3-10203.apk',
          notes: null,
          publishedAt: null,
        },
      })
    );

    await useUpdateStore.getState().check();

    expect(useUpdateStore.getState().softStatus).toBe('available');
    expect(useUpdateStore.getState().latest?.versionName).toBe('1.2.3');
  });
});

describe('updateStore.checkSoft', () => {
  it('marks up-to-date when the latest release is not newer', async () => {
    mockedCheckUpdates.mockResolvedValue(
      softResult({
        available: false,
        latest: {
          versionName: '0.0.9',
          versionCode: 9,
          apkUrl: 'https://example.com/sinc-0.0.9-9.apk',
          notes: null,
          publishedAt: null,
        },
      })
    );

    await useUpdateStore.getState().checkSoft();

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
    mockedCheckUpdates.mockResolvedValue(softResult({ available: false, latest: null }));

    await useUpdateStore.getState().checkSoft();

    expect(useUpdateStore.getState().softStatus).toBe('error');
    expect(useUpdateStore.getState().latest).toBeNull();
  });
});
