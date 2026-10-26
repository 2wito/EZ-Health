"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { LanguageSwitcher } from "./language-switcher";
import { NAV_ITEMS, isActive } from "./nav-items";
import { ThemeSwitcher } from "./theme-switcher";

/** iPadOS-style sidebar, shown from the `lg` breakpoint up. */
export function Sidebar({ footer }: { footer?: React.ReactNode }) {
  const pathname = usePathname();
  const { t } = useI18n();

  return (
    <aside className="sticky top-0 hidden h-dvh w-[264px] shrink-0 flex-col border-e border-chrome-border bg-chrome px-3 backdrop-blur-2xl backdrop-saturate-150 lg:flex">
      <div className="px-3 pb-4 pt-8">
        <p className="font-display text-[22px] font-bold tracking-tight">EZ Health</p>
      </div>

      <nav aria-label={t.nav.sections} className="flex flex-col gap-0.5">
        {NAV_ITEMS.map(({ href, key, icon: Icon, tile }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-11 items-center gap-3 rounded-[10px] px-2.5 text-[17px] transition-colors",
                active ? "bg-primary text-primary-foreground" : "hover:bg-muted",
              )}
            >
              <span
                className={cn(
                  "grid size-[30px] place-items-center rounded-[7px] text-white",
                  tile,
                  active && "ring-1 ring-white/25",
                )}
              >
                <Icon aria-hidden className="size-[18px]" strokeWidth={2.25} />
              </span>
              <span className="font-medium">{t.nav[key].label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-3 pb-6 pt-4">
        {footer}
        <ThemeSwitcher />
        <LanguageSwitcher />
      </div>
    </aside>
  );
}
