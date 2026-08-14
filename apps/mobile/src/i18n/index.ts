import i18next, { type InitOptions } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { I18nManager } from 'react-native';
import { resources, DEFAULT_LOCALE, isRTL, isSupportedLocale, type Locale } from './registry';

export { SUPPORTED_LOCALES, RTL_LOCALES, resources, DEFAULT_LOCALE, isRTL } from './registry';
export type { Locale } from './registry';

/** Set the active locale and sync the native RTL layout flag. */
export async function setLocale(locale: Locale): Promise<void> {
  await i18next.changeLanguage(locale);
  const shouldBeRTL = isRTL(locale);
  if (I18nManager.isRTL !== shouldBeRTL) {
    I18nManager.allowRTL(shouldBeRTL);
    I18nManager.forceRTL(shouldBeRTL);
  }
}

export async function initI18n(options?: Partial<InitOptions>): Promise<void> {
  const current = i18next.language;
  const resolved: Locale = current && isSupportedLocale(current) ? current : DEFAULT_LOCALE;
  const rtl = isRTL(resolved);
  I18nManager.allowRTL(rtl);
  I18nManager.forceRTL(rtl);

  i18next.use(initReactI18next);

  await i18next.init({
    resources,
    lng: resolved,
    fallbackLng: DEFAULT_LOCALE,
    compatibilityJSON: 'v4',
    interpolation: { escapeValue: false },
    returnEmptyString: false,
    ...options,
  });
}

export default i18next;
