import { beforeEach, describe, expect, it } from 'vitest';
import { inc, resetMetrics, renderMetrics } from './metrics.js';

describe('metrics registry', () => {
  beforeEach(() => resetMetrics());

  it('increments counters and renders Prometheus text format', () => {
    inc('sinc_http_requests_total', { method: 'GET', route: '/health' });
    inc('sinc_http_requests_total', { method: 'GET', route: '/health' });
    inc('sinc_http_requests_total', { method: 'POST', route: '/auth/login' });

    const out = renderMetrics();
    expect(out).toContain('# HELP sinc_http_requests_total Total HTTP requests');
    expect(out).toContain('# TYPE sinc_http_requests_total counter');
    expect(out).toContain('sinc_http_requests_total{method="GET",route="/health"} 2');
    expect(out).toContain('sinc_http_requests_total{method="POST",route="/auth/login"} 1');
  });

  it('escapes quotes in label values', () => {
    inc('sinc_http_requests_total', { route: 'a"b' });
    expect(renderMetrics()).toContain('route="a\\"b"');
  });

  it('resets cleanly', () => {
    inc('sinc_http_requests_total');
    resetMetrics();
    expect(renderMetrics()).toBe('');
  });
});
