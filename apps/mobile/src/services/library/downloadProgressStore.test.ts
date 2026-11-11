import { describe, expect, it } from 'vitest';
import { useDownloadProgressStore } from './downloadProgressStore';

describe('useDownloadProgressStore', () => {
  it('tracks per-job progress without persist churn', () => {
    useDownloadProgressStore.setState({ progress: {}, indeterminate: {}, speeds: {} });
    useDownloadProgressStore.getState().setProgress('job-1', 25);
    expect(useDownloadProgressStore.getState().progress).toEqual({ 'job-1': 25 });
  });

  it('does not create a new object for an unchanged progress', () => {
    useDownloadProgressStore.setState({ progress: { 'job-1': 25 }, indeterminate: {} });
    const before = useDownloadProgressStore.getState().progress;
    useDownloadProgressStore.getState().setProgress('job-1', 25);
    expect(useDownloadProgressStore.getState().progress).toBe(before);
  });

  it('tracks unknown totals separately from percentages', () => {
    useDownloadProgressStore.setState({ progress: {}, indeterminate: {}, speeds: {} });
    useDownloadProgressStore.getState().setIndeterminate('job-1', true);
    expect(useDownloadProgressStore.getState().indeterminate).toEqual({ 'job-1': true });
    expect(useDownloadProgressStore.getState().progress).toEqual({});

    // The first real percentage clears the indeterminate flag.
    useDownloadProgressStore.getState().setProgress('job-1', 42);
    expect(useDownloadProgressStore.getState().indeterminate).toEqual({});
    expect(useDownloadProgressStore.getState().progress).toEqual({ 'job-1': 42 });
  });

  it('clears single jobs and the whole map', () => {
    useDownloadProgressStore.setState({
      progress: { a: 1, b: 2 },
      indeterminate: { a: true },
    });
    useDownloadProgressStore.getState().clearProgress('a');
    expect(useDownloadProgressStore.getState().progress).toEqual({ b: 2 });
    expect(useDownloadProgressStore.getState().indeterminate).toEqual({});

    useDownloadProgressStore.getState().clear();
    expect(useDownloadProgressStore.getState().progress).toEqual({});
    expect(useDownloadProgressStore.getState().indeterminate).toEqual({});
  });

  it('tracks speeds and drops them with the job', () => {
    useDownloadProgressStore.setState({ progress: {}, indeterminate: {}, speeds: {} });
    useDownloadProgressStore.getState().setSpeed('job-1', '214.6 KiB/s');
    expect(useDownloadProgressStore.getState().speeds).toEqual({ 'job-1': '214.6 KiB/s' });

    useDownloadProgressStore.getState().setSpeed('job-1', null);
    expect(useDownloadProgressStore.getState().speeds).toEqual({});

    useDownloadProgressStore.getState().setSpeed('job-1', '1.0 MiB/s');
    useDownloadProgressStore.getState().clearProgress('job-1');
    expect(useDownloadProgressStore.getState().speeds).toEqual({});
  });
});
