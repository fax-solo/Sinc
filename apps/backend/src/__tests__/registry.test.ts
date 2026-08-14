import { describe, it, expect, vi } from 'vitest';
import type { MetadataProvider } from '../domain/catalog/types.js';
import {
  ProviderCircuitOpenError,
  ProviderRegistryImpl,
  withTimeout,
} from '../domain/catalog/registry.js';

const provider = (id: string): MetadataProvider => ({
  id,
  type: 'metadata',
  search: vi.fn(async () => ({ query: '', tracks: [], artists: [], albums: [] })),
  getTrack: vi.fn(async () => null),
  getArtist: vi.fn(async () => null),
  getAlbum: vi.fn(async () => null),
  getArtistTracks: vi.fn(async () => []),
  getArtistAlbums: vi.fn(async () => []),
  getAlbumTracks: vi.fn(async () => []),
  getRelatedArtists: vi.fn(async () => []),
  healthCheck: vi.fn(async () => ({ ok: true, checkedAt: new Date().toISOString() })),
});

describe('ProviderRegistryImpl', () => {
  it('registers and lists enabled providers', () => {
    const registry = new ProviderRegistryImpl();
    const mb = provider('musicbrainz');
    registry.register(mb);
    expect(registry.getMetadata()).toEqual([mb]);
    expect(registry.isEnabled('musicbrainz')).toBe(true);
  });

  it('setEnabled(false) removes the provider from fan-out without unregistering', () => {
    const registry = new ProviderRegistryImpl();
    const mb = provider('musicbrainz');
    registry.register(mb);
    registry.setEnabled('musicbrainz', false);
    expect(registry.getMetadata()).toEqual([]);
    expect(registry.getMetadataById('musicbrainz')).toBe(mb);
    expect(registry.status('musicbrainz')?.enabled).toBe(false);
  });

  it('setEnabled(true) restores a provider and resets its circuit', async () => {
    const registry = new ProviderRegistryImpl({ openThreshold: 2, halfOpenDelayMs: 1_000 });
    registry.register(provider('musicbrainz'));
    await registry
      .call('musicbrainz', () => Promise.reject(new Error('boom')))
      .catch(() => undefined);
    await registry
      .call('musicbrainz', () => Promise.reject(new Error('boom')))
      .catch(() => undefined);
    expect(registry.status('musicbrainz')?.circuit.open).toBe(true);
    registry.setEnabled('musicbrainz', true);
    expect(registry.status('musicbrainz')?.circuit.open).toBe(false);
  });

  it('call() routes success to reportSuccess', async () => {
    const registry = new ProviderRegistryImpl();
    registry.register(provider('musicbrainz'));
    await expect(registry.call('musicbrainz', async () => 42)).resolves.toBe(42);
    expect(registry.status('musicbrainz')?.circuit.totalRequests).toBe(1);
    expect(registry.status('musicbrainz')?.circuit.failures).toBe(0);
  });

  it('call() trips the circuit after repeated failures and throws circuit-open', async () => {
    const registry = new ProviderRegistryImpl({ openThreshold: 2, halfOpenDelayMs: 60_000 });
    registry.register(provider('musicbrainz'));
    await registry.call('musicbrainz', () => Promise.reject(new Error('x'))).catch(() => undefined);
    await registry.call('musicbrainz', () => Promise.reject(new Error('x'))).catch(() => undefined);
    await expect(registry.call('musicbrainz', async () => 1)).rejects.toBeInstanceOf(
      ProviderCircuitOpenError,
    );
    expect(registry.status('musicbrainz')?.circuit.open).toBe(true);
  });

  it('call() rejects unknown providers', async () => {
    const registry = new ProviderRegistryImpl();
    await expect(registry.call('nope', async () => 1)).rejects.toThrow(/not registered/);
  });

  it('getMetadata excludes providers whose circuit is open', async () => {
    const registry = new ProviderRegistryImpl({ openThreshold: 1, halfOpenDelayMs: 60_000 });
    const mb = provider('musicbrainz');
    registry.register(mb);
    await registry.call('musicbrainz', () => Promise.reject(new Error('x'))).catch(() => undefined);
    expect(registry.getMetadata()).toEqual([]);
  });
});

describe('withTimeout', () => {
  it('resolves when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 100)).resolves.toBe('ok');
  });

  it('rejects when the promise exceeds the timeout', async () => {
    await expect(withTimeout(new Promise(() => undefined), 10, 'test-op')).rejects.toThrow(
      'test-op timed out after 10ms',
    );
  });

  it('propagates the underlying rejection', async () => {
    await expect(withTimeout(Promise.reject(new Error('nope')), 100)).rejects.toThrow('nope');
  });
});
