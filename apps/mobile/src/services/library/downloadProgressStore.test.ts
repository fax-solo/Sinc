import { describe, expect, it } from 'vitest';
import { useDownloadProgressStore } from './downloadProgressStore';

describe('useDownloadProgressStore', () => {
  it('tracks per-job progress without persist churn', () => {
    useDownloadProgressStore.setState({ progress: {} });
    useDownloadProgressStore.getState().setProgress('job-1', 25);
    expect(useDownloadProgressStore.getState().progress).toEqual({ 'job-1': 25 });
  });

  it('does not create a new object for an unchanged progress', () => {
    useDownloadProgressStore.setState({ progress: { 'job-1': 25 } });
    const before = useDownloadProgressStore.getState().progress;
    useDownloadProgressStore.getState().setProgress('job-1', 25);
    expect(useDownloadProgressStore.getState().progress).toBe(before);
  });

  it('clears single jobs and the whole map', () => {
    useDownloadProgressStore.setState({ progress: { a: 1, b: 2 } });
    useDownloadProgressStore.getState().clearProgress('a');
    expect(useDownloadProgressStore.getState().progress).toEqual({ b: 2 });

    useDownloadProgressStore.getState().clear();
    expect(useDownloadProgressStore.getState().progress).toEqual({});
  });

  it('tracks speeds and drops them with the job', () => {
    useDownloadProgressStore.setState({ progress: {}, speeds: {} });
    useDownloadProgressStore.getState().setSpeed('job-1', '214.6 KiB/s');
    expect(useDownloadProgressStore.getState().speeds).toEqual({ 'job-1': '214.6 KiB/s' });

    useDownloadProgressStore.getState().setSpeed('job-1', null);
    expect(useDownloadProgressStore.getState().speeds).toEqual({});

    useDownloadProgressStore.getState().setSpeed('job-1', '1.0 MiB/s');
    useDownloadProgressStore.getState().clearProgress('job-1');
    expect(useDownloadProgressStore.getState().speeds).toEqual({});
  });
});
