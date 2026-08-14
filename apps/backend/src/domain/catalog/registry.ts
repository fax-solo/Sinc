import { ErrorCodes, ProviderError, SincError } from '@sinc/shared';
import { CircuitBreaker, type CircuitBreakerConfig } from './circuit-breaker.js';
import type { MetadataProvider, ProviderStatus, SourceProvider } from './types.js';

export const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  openThreshold: 5,
  halfOpenDelayMs: 30_000,
};

/** Thrown when a circuit is open and a provider cannot be called. */
export class ProviderCircuitOpenError extends SincError {
  constructor(provider: string) {
    super(
      ErrorCodes.PROVIDER_ERROR,
      `Provider "${provider}" is temporarily unavailable (circuit open)`,
      { status: 503, retryable: true },
    );
    this.name = 'ProviderCircuitOpenError';
  }
}

/** Rejects with the given message if the promise does not settle in time. */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label = 'operation',
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export interface ProviderRegistry {
  register(provider: MetadataProvider): void;
  getMetadata(): MetadataProvider[];
  getMetadataById(id: string): MetadataProvider | undefined;
  registerSource(provider: SourceProvider): void;
  getSource(): SourceProvider[];
  getSourceById(id: string): SourceProvider | undefined;
  isEnabled(id: string): boolean;
  setEnabled(id: string, enabled: boolean): void;
  status(id: string): ProviderStatus | undefined;
  /** Run a provider call through its circuit breaker + timeout. */
  call<T>(id: string, fn: () => Promise<T>, timeoutMs?: number): Promise<T>;
  reportFailure(id: string): void;
  reportSuccess(id: string): void;
}

/**
 * Holds every provider, its enabled flag and its circuit breaker. All provider
 * calls must go through `call()` so failures trip circuits and success resets
 * them (see ARCHITECTURE_PROVIDERS.md).
 */
export class ProviderRegistryImpl implements ProviderRegistry {
  private readonly providers = new Map<string, MetadataProvider>();
  private readonly sources = new Map<string, SourceProvider>();
  private readonly enabled = new Set<string>();
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly circuitConfig: CircuitBreakerConfig;

  constructor(circuitConfig: Partial<CircuitBreakerConfig> = {}) {
    this.circuitConfig = { ...DEFAULT_CIRCUIT_CONFIG, ...circuitConfig };
  }

  register(provider: MetadataProvider): void {
    this.providers.set(provider.id, provider);
    this.enabled.add(provider.id);
    this.ensureBreaker(provider.id);
  }

  registerSource(provider: SourceProvider): void {
    this.sources.set(provider.id, provider);
    this.enabled.add(provider.id);
    this.ensureBreaker(provider.id);
  }

  private ensureBreaker(id: string): void {
    if (!this.breakers.has(id)) {
      this.breakers.set(id, new CircuitBreaker(this.circuitConfig));
    }
  }

  getMetadata(): MetadataProvider[] {
    return [...this.providers.values()].filter(
      (p) => this.enabled.has(p.id) && this.breakers.get(p.id)?.allow() !== false,
    );
  }

  getMetadataById(id: string): MetadataProvider | undefined {
    return this.providers.get(id);
  }

  getSource(): SourceProvider[] {
    return [...this.sources.values()].filter(
      (p) => this.enabled.has(p.id) && this.breakers.get(p.id)?.allow() !== false,
    );
  }

  getSourceById(id: string): SourceProvider | undefined {
    return this.sources.get(id);
  }

  isEnabled(id: string): boolean {
    return this.enabled.has(id);
  }

  setEnabled(id: string, enabled: boolean): void {
    if (enabled) {
      this.enabled.add(id);
      this.breakers.get(id)?.reset();
    } else {
      this.enabled.delete(id);
    }
  }

  status(id: string): ProviderStatus | undefined {
    const provider = this.providers.get(id);
    if (!provider) return undefined;
    return {
      id,
      type: provider.type,
      enabled: this.enabled.has(id),
      circuit: this.breakers.get(id)?.state ?? {
        failures: 0,
        open: false,
        openedAt: null,
        halfOpenUntil: null,
        totalRequests: 0,
        totalFailures: 0,
      },
    };
  }

  async call<T>(id: string, fn: () => Promise<T>, timeoutMs = 10_000): Promise<T> {
    const breaker = this.breakers.get(id);
    if (!breaker) throw new ProviderError(id, `Provider "${id}" is not registered`);
    if (!breaker.allow()) throw new ProviderCircuitOpenError(id);

    try {
      const result = await withTimeout(fn(), timeoutMs, `provider:${id}`);
      breaker.reportSuccess();
      return result;
    } catch (error) {
      breaker.reportFailure();
      throw error;
    }
  }

  reportFailure(id: string): void {
    this.breakers.get(id)?.reportFailure();
  }

  reportSuccess(id: string): void {
    this.breakers.get(id)?.reportSuccess();
  }
}
