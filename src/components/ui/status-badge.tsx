import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Status always pairs its color with an icon and a word. Text stays in the text color. */
export function StatusBadge({ color, icon: Icon, label, large }: { color: string; icon: LucideIcon; label: string; large?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full font-semibold text-foreground",
        large ? "mt-1 py-1 pe-2.5 ps-2 text-[15px]" : "py-0.5 pe-2 ps-1.5 text-[12px]",
      )}
      style={{ background: `color-mix(in srgb, ${color} 18%, transparent)` }}
    >
      <Icon aria-hidden className={large ? "size-4" : "size-3.5"} strokeWidth={2.5} style={{ color }} />
      {label}
    </span>
  );
}
