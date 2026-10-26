"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";
import { NAV_ITEMS, isActive } from "./nav-items";

/** iOS tab bar, shown below the `lg` breakpoint. */
export function TabBar() {
  const pathname = usePathname();
  const { t } = useI18n();

  return (
    <nav
      aria-label={t.nav.sections}
      className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-chrome-border bg-chrome backdrop-blur-2xl backdrop-saturate-150 lg:hidden"
    >
      <ul className="mx-auto grid max-w-xl grid-cols-5">
        {NAV_ITEMS.filter((item) => item.tab).map(({ href, key, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-[50px] flex-col items-center justify-center gap-0.5 text-[10px] font-medium",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon aria-hidden className="size-6" strokeWidth={active ? 2.4 : 1.9} />
                {t.nav[key].label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
