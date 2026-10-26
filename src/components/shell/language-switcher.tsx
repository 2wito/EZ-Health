"use client";

import { Languages } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LOCALE_COOKIE, LOCALE_NAMES, LOCALES, localeDir, type Locale } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/** Saves the choice in a cookie, flips the page direction now, and re-renders the server copy. */
function useSetLocale() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const setLocale = (next: Locale) => {
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = next;
    document.documentElement.dir = localeDir(next);
    startTransition(() => router.refresh());
  };
  return { setLocale, pending };
}

/** iOS segmented control: English / עברית. */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, t } = useI18n();
  const { setLocale, pending } = useSetLocale();

  return (
    <div
      role="radiogroup"
      aria-label={t.shell.language}
      aria-busy={pending}
      className={cn("grid grid-cols-2 rounded-[9px] bg-muted p-0.5", className)}
    >
      {LOCALES.map((value) => {
        const selected = locale === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            lang={value}
            onClick={() => !selected && setLocale(value)}
            className={cn(
              "flex h-7 items-center justify-center rounded-[7px] text-[13px] font-medium",
              selected && "bg-segment-thumb font-semibold shadow-[0_3px_8px_rgb(0_0_0/0.12),0_1px_1px_rgb(0_0_0/0.04)]",
            )}
          >
            {LOCALE_NAMES[value]}
          </button>
        );
      })}
    </div>
  );
}

/** Round button for the phone nav bar: switches to the other language. */
export function LanguageToggleButton({ className }: { className?: string }) {
  const { locale, t } = useI18n();
  const { setLocale } = useSetLocale();
  const next: Locale = locale === "he" ? "en" : "he";

  return (
    <button
      type="button"
      onClick={() => setLocale(next)}
      aria-label={t.shell.switchLanguageLabel}
      lang={next}
      className={cn("flex h-8 items-center gap-1 rounded-full bg-muted px-2.5 text-[13px] font-semibold text-primary", className)}
    >
      <Languages aria-hidden className="size-[15px]" strokeWidth={2.25} />
      {t.shell.switchLanguage}
    </button>
  );
}
