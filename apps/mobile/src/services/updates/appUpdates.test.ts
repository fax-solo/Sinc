import { describe, expect, it } from 'vitest';
import { isVersionOlder } from './appUpdates';

describe('isVersionOlder', () => {
  it('compares dotted numeric versions', () => {
    expect(isVersionOlder('0.1.0', '0.2.0')).toBe(true);
    expect(isVersionOlder('0.2.0', '0.1.0')).toBe(false);
    expect(isVersionOlder('1.0.0', '1.0.1')).toBe(true);
    expect(isVersionOlder('1.0.1', '1.0.0')).toBe(false);
    expect(isVersionOlder('1.0.0', '1.0.0')).toBe(false);
  });

  it('handles differing segment counts and invalid segments', () => {
    expect(isVersionOlder('1', '1.0.1')).toBe(true);
    expect(isVersionOlder('1.0.1', '1')).toBe(false);
    expect(isVersionOlder('abc', '1.0.0')).toBe(true);
  });
});
