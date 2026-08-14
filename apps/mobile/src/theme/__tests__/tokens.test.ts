import { describe, it, expect } from 'vitest';
import { createTokens, lightColors, darkColors, typography, radius, spacing } from '../tokens';

describe('theme tokens', () => {
  it('creates light tokens with isDark=false', () => {
    const t = createTokens(false);
    expect(t.isDark).toBe(false);
    expect(t.colors).toEqual(lightColors);
  });

  it('creates dark tokens with isDark=true', () => {
    const t = createTokens(true);
    expect(t.isDark).toBe(true);
    expect(t.colors).toEqual(darkColors);
  });

  it('shares the same color-role keys across palettes', () => {
    const lightKeys = Object.keys(lightColors).sort();
    const darkKeys = Object.keys(darkColors).sort();
    expect(lightKeys).toEqual(darkKeys);
  });

  it('exposes every role as a non-empty color', () => {
    for (const [key, value] of Object.entries(lightColors)) {
      expect(value.length).toBeGreaterThan(0);
      void key;
    }
  });

  it('has a positive spacing scale', () => {
    for (const value of Object.values(spacing)) {
      expect(value).toBeGreaterThan(0);
    }
  });

  it('has a usable radius scale including full', () => {
    expect(radius.full).toBe(999);
    expect(radius.xs).toBeLessThan(radius.xl);
  });

  it('orders typography sizes consistently', () => {
    const sizes = Object.values(typography).map((t) => t.fontSize);
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]!).toBeLessThanOrEqual(sizes[i - 1]!);
    }
  });
});
