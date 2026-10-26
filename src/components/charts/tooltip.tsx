"use client";

import { localeDir } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/client";

/** Frosted readout used by every chart's hover tooltip. Charts render LTR, so the box sets the page direction again. */
export function TooltipBox({ title, children }: { title: string; children: React.ReactNode }) {
  const { locale } = useI18n();
  return (
    <div
      dir={localeDir(locale)}
      className="min-w-36 rounded-xl border border-border bg-popover/90 px-3 py-2 text-[13px] shadow-lg backdrop-blur-xl"
    >
      <p className="mb-1 text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

/** Tooltip row: series key, then the value (strong) and the series name (secondary). */
export function TooltipRow({
  color,
  value,
  label,
  mark = "line",
}: {
  color: string;
  value: string;
  label: string;
  mark?: "line" | "square";
}) {
  return (
    <p className="flex items-center gap-2">
      <span
        aria-hidden
        className={mark === "line" ? "h-0.5 w-3 rounded-full" : "size-2.5 rounded-[3px]"}
        style={{ background: color }}
      />
      <span className="font-semibold tabular-nums">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </p>
  );
}
