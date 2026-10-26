"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { LanguageToggleButton } from "./language-switcher";
import { ThemeToggleButton } from "./theme-switcher";

/**
 * iOS large title. Once it scrolls away, a compact frosted bar with the
 * inline title takes over — the same hand-off as a UINavigationBar.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setCollapsed(!entry.isIntersecting), {
      rootMargin: "-44px 0px 0px 0px",
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div
        className={cn(
          "sticky top-0 z-30 mx-[calc(50%-50cqw)] flex h-11 items-center justify-center border-b px-4 transition-[background-color,border-color] duration-200 sm:px-6 lg:px-10",
          collapsed
            ? "border-chrome-border bg-chrome backdrop-blur-2xl backdrop-saturate-150"
            : "border-transparent bg-transparent",
        )}
      >
        <span
          aria-hidden={!collapsed}
          className={cn(
            "text-[17px] font-semibold transition-opacity duration-200",
            collapsed ? "opacity-100" : "opacity-0",
          )}
        >
          {title}
        </span>
        {/* Phones have no sidebar, so the appearance and language controls live here. */}
        <div className="absolute end-4 flex items-center gap-2 sm:end-6 lg:hidden">
          <LanguageToggleButton />
          <ThemeToggleButton />
        </div>
      </div>

      <header className="flex items-end justify-between gap-4 pb-6 pt-1">
        <div>
          {subtitle && <p className="text-[15px] font-medium text-muted-foreground">{subtitle}</p>}
          <h1 className="font-display text-[34px] font-bold leading-[41px] tracking-[0.01em]">{title}</h1>
          <div ref={sentinel} aria-hidden className="h-0" />
        </div>
        {actions}
      </header>
    </>
  );
}
