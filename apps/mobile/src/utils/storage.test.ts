import { describe, expect, it } from 'vitest';
import { createStorage } from './storage';

describe('createStorage (in-memory fallback)', () => {
  it('round-trips strings and objects', () => {
    const s = createStorage();
    expect(s.getString('missing')).toBeNull();
    s.setString('k', 'v');
    expect(s.getString('k')).toBe('v');

    s.setObject('obj', { a: 1, b: { c: true } });
    expect(s.getObject<{ a: number }>('obj')).toEqual({ a: 1, b: { c: true } });
  });

  it('removes and clears keys', () => {
    const s = createStorage();
    s.setString('a', '1');
    s.setString('b', '2');
    s.remove('a');
    expect(s.getString('a')).toBeNull();
    expect(s.getString('b')).toBe('2');

    s.clear();
    expect(s.getString('b')).toBeNull();
    expect(s.getObject('b')).toBeNull();
  });

  it('degrades to null on corrupt JSON instead of throwing', () => {
    const s = createStorage();
    s.setString('bad', '{not json');
    expect(s.getObject('bad')).toBeNull();
  });

  it('keeps independently created stores isolated', () => {
    const a = createStorage();
    const b = createStorage();
    a.setString('x', '1');
    expect(b.getString('x')).toBeNull();
  });
});
