import { describe, it, expect } from 'vitest';
import { resources, SUPPORTED_LOCALES, RTL_LOCALES, isRTL, DEFAULT_LOCALE } from '../registry';
import en from '../locales/en';

function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') {
      keys.push(...flattenKeys(value as Record<string, unknown>, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

describe('i18n resources', () => {
  const enKeys = flattenKeys(en).sort();

  it('supports en and ar', () => {
    expect(SUPPORTED_LOCALES).toEqual(['en', 'ar']);
  });

  it('defaults to en', () => {
    expect(DEFAULT_LOCALE).toBe('en');
  });

  it('has a key-parity with English in every locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const localeKeys = flattenKeys(
        resources[locale].translation as unknown as Record<string, unknown>,
      ).sort();
      expect(localeKeys, `missing/mismatched keys for ${locale}`).toEqual(enKeys);
    }
  });

  it('declares only supported locales as RTL', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const rtl = RTL_LOCALES.has(locale);
      expect(isRTL(locale)).toBe(rtl);
    }
    expect(isRTL('ar')).toBe(true);
    expect(isRTL('en')).toBe(false);
  });
});
