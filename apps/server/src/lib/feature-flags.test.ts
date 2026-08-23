import { describe, expect, it } from 'vitest';
import {
  parseFlags,
  setFeatureFlag,
  featureFlagEnabled,
  clearFeatureFlags,
} from './feature-flags.js';

describe('feature-flags', () => {
  it('parses on/off pairs, defaulting unknown to off', () => {
    const flags = parseFlags('newRanking=on,recs=off,beta=1,live=false');
    expect(flags.get('newRanking')).toBe(true);
    expect(flags.get('recs')).toBe(false);
    expect(flags.get('beta')).toBe(true);
    expect(flags.get('live')).toBe(false);
    expect(flags.get('missing')).toBeUndefined();
  });

  it('ignores empty segments and malformed pairs', () => {
    expect(parseFlags('').size).toBe(0);
    expect(parseFlags('a=on,,b').size).toBe(2);
    expect(parseFlags('a=on,,b').get('b')).toBe(false);
  });

  it('supports in-memory overrides for tests', () => {
    clearFeatureFlags();
    setFeatureFlag('test.flag', true);
    expect(featureFlagEnabled('test.flag')).toBe(true);
    setFeatureFlag('test.flag', false);
    expect(featureFlagEnabled('test.flag')).toBe(false);
    clearFeatureFlags();
  });
});
