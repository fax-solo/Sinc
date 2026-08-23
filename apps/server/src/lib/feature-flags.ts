import { getEnv } from '../config/env.js';

/** Parses "name=on,other=off" into a flag map. Unknown values count as off. */
export function parseFlags(raw: string): Map<string, boolean> {
  const flags = new Map<string, boolean>();
  for (const part of raw.split(',')) {
    const [name, value] = part.trim().split('=');
    if (!name) continue;
    flags.set(name, value?.trim() === 'on' || value?.trim() === '1' || value?.trim() === 'true');
  }
  return flags;
}

/**
 * Lightweight feature flags read from the FEATURE_FLAGS env var, formatted as
 * comma-separated "name=on|off" pairs, e.g. FEATURE_FLAGS="newRanking=on,recs=off".
 * Unknown flags default to off. Flags are effectively static per process (env is
 * cached) but can be overridden in-memory for tests.
 */
export function isFeatureEnabled(name: string): boolean {
  return parseFlags(getEnv().FEATURE_FLAGS ?? '').get(name) ?? false;
}

const overrides = new Map<string, boolean>();

export function setFeatureFlag(name: string, enabled: boolean): void {
  overrides.set(name, enabled);
}

export function featureFlagEnabled(name: string): boolean {
  if (overrides.has(name)) return overrides.get(name) === true;
  return isFeatureEnabled(name);
}

export function clearFeatureFlags(): void {
  overrides.clear();
}
