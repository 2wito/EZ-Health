import Link from "next/link";
import { RANGES, type RangeKey } from "@/lib/analytics/range";
import { cn } from "@/lib/utils";

const LABELS: Record<RangeKey, string> = { "7d": "7 days", "30d": "30 days", "90d": "90 days" };

/**
 * iOS segmented control for the dashboard window. It's a set of links, so the
 * choice lives in the URL and every chart on the page re-renders against it.
 */
export function RangePicker({ value, basePath }: { value: RangeKey; basePath: string }) {
  return (
    <nav aria-label="Time range" className="inline-grid grid-cols-3 rounded-[9px] bg-muted p-0.5">
      {(Object.keys(RANGES) as RangeKey[]).map((key) => {
        const selected = key === value;
        return (
          <Link
            key={key}
            href={key === "30d" ? basePath : `${basePath}?range=${key}`}
            scroll={false}
            aria-current={selected ? "page" : undefined}
            className={cn(
              "flex h-8 items-center justify-center rounded-[7px] px-4 text-[13px] font-medium transition-colors",
              selected
                ? "bg-segment-thumb font-semibold shadow-[0_3px_8px_rgb(0_0_0/0.12),0_1px_1px_rgb(0_0_0/0.04)]"
                : "text-foreground/80 hover:text-foreground",
            )}
          >
            {LABELS[key]}
          </Link>
        );
      })}
    </nav>
  );
}
