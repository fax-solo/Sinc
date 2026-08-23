import { describe, expect, it } from 'vitest';
import { parseLrc, serializeLrc } from './lyrics.js';

describe('parseLrc', () => {
  it('parses timed lines in order', () => {
    const parsed = parseLrc('[00:12.34]Hello\n[00:16.50]World');
    expect(parsed.synced).toBe(true);
    expect(parsed.lines).toEqual([
      { timeMs: 12_340, text: 'Hello' },
      { timeMs: 16_500, text: 'World' },
    ]);
  });

  it('handles multiple timestamps on one line and sorts', () => {
    const parsed = parseLrc('[00:20.00]A\n[00:10.00]B\n[00:05.00]C\n[00:30.00]D');
    expect(parsed.lines.map((l) => l.timeMs)).toEqual([5_000, 10_000, 20_000, 30_000]);
  });

  it('handles milliseconds with 1-2 digits', () => {
    const parsed = parseLrc('[00:01.5]x\n[00:02.55]y');
    expect(parsed.lines[0].timeMs).toBe(1500);
    expect(parsed.lines[1].timeMs).toBe(2550);
  });

  it('falls back to plain text when there is no timing', () => {
    const parsed = parseLrc('First line\nSecond line');
    expect(parsed.synced).toBe(false);
    expect(parsed.lines).toEqual([{ timeMs: 0, text: 'First line\nSecond line' }]);
  });

  it('ignores metadata tags like [ti:...]', () => {
    const parsed = parseLrc('[ti:Title]\n[ar:Artist]\n[00:03.00]Go');
    expect(parsed.lines).toEqual([{ timeMs: 3_000, text: 'Go' }]);
  });

  it('collapses a lyric line repeated a few seconds later (caption artifact)', () => {
    const parsed = parseLrc(
      '[00:18.24]First phrase\n[00:22.63]First phrase\n[00:22.64]Second phrase\n[00:26.47]Second phrase'
    );
    expect(parsed.lines).toEqual([
      { timeMs: 18_240, text: 'First phrase' },
      { timeMs: 22_640, text: 'Second phrase' },
    ]);
  });

  it('keeps a repeated line when it is far enough apart or not consecutive', () => {
    const parsed = parseLrc('[00:02.00]Chorus\n[00:30.00]Chorus');
    expect(parsed.lines).toEqual([
      { timeMs: 2_000, text: 'Chorus' },
      { timeMs: 30_000, text: 'Chorus' },
    ]);
  });
});

describe('serializeLrc', () => {
  it('round-trips through parseLrc', () => {
    const lines = [
      { timeMs: 0, text: 'A' },
      { timeMs: 65_004, text: 'B' },
    ];
    const serialized = serializeLrc(lines);
    expect(serialized).toBe('[00:00.000]A\n[01:05.004]B');
    expect(parseLrc(serialized).lines).toEqual(lines);
  });
});
