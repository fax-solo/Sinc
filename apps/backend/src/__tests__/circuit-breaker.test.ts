import { describe, it, expect } from 'vitest';
import { CircuitBreaker } from '../domain/catalog/circuit-breaker.js';

const config = { openThreshold: 3, halfOpenDelayMs: 1_000 };
let now = 0;

function makeBreaker() {
  now = 0;
  return new CircuitBreaker({ ...config, now: () => now });
}

describe('CircuitBreaker', () => {
  it('allows requests while closed', () => {
    const breaker = makeBreaker();
    expect(breaker.allow()).toBe(true);
    expect(breaker.state.open).toBe(false);
  });

  it('opens after the failure threshold', () => {
    const breaker = makeBreaker();
    breaker.reportFailure();
    breaker.reportFailure();
    expect(breaker.allow()).toBe(true);
    breaker.reportFailure();
    expect(breaker.state.open).toBe(true);
    expect(breaker.state.halfOpenUntil).toBe(1_000);
    expect(breaker.allow()).toBe(false);
  });

  it('stays open through the cooldown then half-opens for a trial', () => {
    const breaker = makeBreaker();
    breaker.forceOpen();
    expect(breaker.allow()).toBe(false);
    now = 1_001;
    expect(breaker.allow()).toBe(true);
    expect(breaker.state.open).toBe(false);
  });

  it('success resets failures and closes the circuit', () => {
    const breaker = makeBreaker();
    breaker.forceOpen();
    now = 1_001;
    breaker.allow();
    breaker.reportSuccess();
    expect(breaker.state.open).toBe(false);
    expect(breaker.state.failures).toBe(0);
    expect(breaker.allow()).toBe(true);
  });

  it('tracks request and failure totals', () => {
    const breaker = makeBreaker();
    breaker.reportSuccess();
    breaker.reportFailure();
    breaker.reportFailure();
    expect(breaker.state.totalRequests).toBe(3);
    expect(breaker.state.totalFailures).toBe(2);
  });

  it('reset returns to a clean closed state', () => {
    const breaker = makeBreaker();
    breaker.forceOpen();
    breaker.reset();
    expect(breaker.state.open).toBe(false);
    expect(breaker.state.failures).toBe(0);
    expect(breaker.allow()).toBe(true);
  });
});
