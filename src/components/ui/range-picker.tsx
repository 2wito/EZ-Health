import Link from "next/link";
import { RANGE_DAYS, RANGE_KEYS, type RangeKey } from "@/lib/analytics/range";
import { getI18n } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

/**
 * iOS segmented control for the dashboard window. It's a set of links, so the
 * choice lives in the URL and every chart on the page re-renders against it.
 */
export async function RangePicker({ value, basePath }: { value: RangeKey; basePath: string }) {
  const { t } = await getI18n();
  return (
    <nav aria-label={t.common.range} className="inline-grid grid-cols-4 rounded-[9px] bg-muted p-0.5">
      {RANGE_KEYS.map((key) => {
        const selected = key === value;
        return (
          <Link
            key={key}
            href={key === "30d" ? basePath : `${basePath}?range=${key}`}
            scroll={false}
            aria-current={selected ? "page" : undefined}
            className={cn(
              "flex h-8 items-center justify-center whitespace-nowrap rounded-[7px] px-3 text-[13px] font-medium transition-colors sm:px-4",
              selected
                ? "bg-segment-thumb font-semibold shadow-[0_3px_8px_rgb(0_0_0/0.12),0_1px_1px_rgb(0_0_0/0.04)]"
                : "text-foreground/80 hover:text-foreground",
            )}
          >
            {key === "all" ? t.common.rangeAll : t.common.rangeDays(RANGE_DAYS[key])}
          </Link>
        );
      })}
    </nav>
  );
}
