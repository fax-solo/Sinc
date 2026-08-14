import type { CircuitState } from './types.js';

export interface CircuitBreakerConfig {
  /** Failures before the circuit opens. */
  openThreshold: number;
  /** Cooldown before the circuit allows a trial (half-open) request. */
  halfOpenDelayMs: number;
  now?: () => number;
}

/**
 * Failure counter with a closed/open/half-open state machine. Used per provider
 * so a broken upstream degrades to "skipped" instead of failing the fan-out.
 */
export class CircuitBreaker {
  readonly state: CircuitState = {
    failures: 0,
    open: false,
    openedAt: null,
    halfOpenUntil: null,
    totalRequests: 0,
    totalFailures: 0,
  };

  constructor(private readonly config: CircuitBreakerConfig) {}

  /** May this provider be called right now? */
  allow(): boolean {
    const now = this.config.now?.() ?? Date.now();
    if (!this.state.open) return true;
    if (this.state.halfOpenUntil != null && now >= this.state.halfOpenUntil) {
      this.state.open = false;
      this.state.halfOpenUntil = null;
      return true;
    }
    return false;
  }

  reportSuccess(): void {
    this.state.failures = 0;
    this.state.open = false;
    this.state.halfOpenUntil = null;
    this.state.totalRequests += 1;
  }

  reportFailure(): void {
    this.state.totalRequests += 1;
    this.state.totalFailures += 1;
    this.state.failures += 1;
    if (this.state.failures >= this.config.openThreshold) {
      this.state.open = true;
      this.state.openedAt = this.config.now?.() ?? Date.now();
      this.state.halfOpenUntil = (this.state.openedAt ?? 0) + this.config.halfOpenDelayMs;
    }
  }

  /** Test hook: force the circuit into its open state. */
  forceOpen(): void {
    this.state.failures = this.config.openThreshold;
    this.state.open = true;
    this.state.openedAt = this.config.now?.() ?? Date.now();
    this.state.halfOpenUntil = (this.state.openedAt ?? 0) + this.config.halfOpenDelayMs;
  }

  /** Test hook: reset to closed with no recorded failures. */
  reset(): void {
    this.state.failures = 0;
    this.state.open = false;
    this.state.openedAt = null;
    this.state.halfOpenUntil = null;
  }
}
