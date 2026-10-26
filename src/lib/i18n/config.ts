// Client-safe locale settings. The choice lives in a cookie, not the URL, so
// links and the API stay the same in every language.

export const LOCALES = ["en", "he"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "locale";

export const isLocale = (value: unknown): value is Locale => LOCALES.includes(value as Locale);

export const localeDir = (locale: Locale) => (locale === "he" ? "rtl" : "ltr");

/** BCP 47 tag for Intl formatters. */
export const intlTag = (locale: Locale) => (locale === "he" ? "he-IL" : "en-US");

/** Native names, so each option is readable by the people who need it. */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", he: "עברית" };
