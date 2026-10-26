import "server-only";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { createFormat } from "@/lib/format";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from "./config";
import { getMessages } from "./messages";

/** The saved choice, else the browser's preferred language, else English. */
export const getLocale = cache(async (): Promise<Locale> => {
  const saved = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(saved)) return saved;
  const accept = (await headers()).get("accept-language") ?? "";
  const first = accept.split(",")[0]?.trim().toLowerCase() ?? "";
  return first.startsWith("he") || first.startsWith("iw") ? "he" : DEFAULT_LOCALE;
});

/** Copy and formatters for the current request, for server components. */
export async function getI18n() {
  const locale = await getLocale();
  return { locale, t: getMessages(locale), f: createFormat(locale) };
}
