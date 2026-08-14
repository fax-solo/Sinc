import en from './locales/en';
import ar from './locales/ar';

export const SUPPORTED_LOCALES = ['en', 'ar'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const RTL_LOCALES: ReadonlySet<Locale> = new Set(['ar']);

export const resources = {
  en: { translation: en },
  ar: { translation: ar },
} as const;

export const DEFAULT_LOCALE: Locale = 'en';

export function isRTL(locale: Locale): boolean {
  return RTL_LOCALES.has(locale);
}

export function isSupportedLocale(locale: string): locale is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(locale);
}
