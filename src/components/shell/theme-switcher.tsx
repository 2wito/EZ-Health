"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useTheme } from "next-themes";
import { useEffect, useId, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "light", label: "light", icon: Sun },
  { value: "dark", label: "dark", icon: Moon },
  { value: "system", label: "auto", icon: Monitor },
] as const;

/** iOS segmented control for Light / Dark / Auto. */
export function ThemeSwitcher({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();
  const [mounted, setMounted] = useState(false);
  const reduceMotion = useReducedMotion();
  const thumbId = useId();

  // The stored theme is only known on the client.
  useEffect(() => setMounted(true), []);
  const current = mounted ? (theme ?? "system") : null;

  return (
    <div
      role="radiogroup"
      aria-label={t.shell.appearance}
      className={cn("grid grid-cols-3 rounded-[9px] bg-muted p-0.5", compact ? "w-[108px]" : "w-full", className)}
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const selected = current === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={compact ? t.shell[label] : undefined}
            onClick={() => setTheme(value)}
            className="relative flex h-7 items-center justify-center gap-1.5 rounded-[7px] text-[13px] font-medium"
          >
            {selected && (
              <motion.span
                layoutId={thumbId}
                transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 38 }}
                className="absolute inset-0 rounded-[7px] bg-segment-thumb shadow-[0_3px_8px_rgb(0_0_0/0.12),0_1px_1px_rgb(0_0_0/0.04)]"
              />
            )}
            <Icon aria-hidden className="relative size-3.5" strokeWidth={2.25} />
            {!compact && <span className="relative">{t.shell[label]}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Single round button for tight spaces (phone nav bar): flips light ⇄ dark. */
export function ThemeToggleButton({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const { t } = useI18n();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const dark = mounted && resolvedTheme === "dark";
  const Icon = dark ? Sun : Moon;
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? t.shell.toLight : t.shell.toDark}
      className={cn("grid size-8 place-items-center rounded-full bg-muted text-primary", className)}
    >
      {mounted && <Icon aria-hidden className="size-[17px]" strokeWidth={2.25} />}
    </button>
  );
}
