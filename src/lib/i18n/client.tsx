"use client";

import { createContext, useContext, useMemo } from "react";
import { createFormat } from "@/lib/format";
import type { Locale } from "./config";
import { getMessages } from "./messages";

const LocaleContext = createContext<Locale>("en");

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

/** Copy and formatters for client components. */
export function useI18n() {
  const locale = useContext(LocaleContext);
  return useMemo(() => ({ locale, t: getMessages(locale), f: createFormat(locale) }), [locale]);
}
