import { ChevronRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { Card, tintColor, type Tint } from "./card";

/** A reading split into number/unit pairs, e.g. [["7", "hr"], ["15", "min"]]. */
export type Measure = [value: string, unit: string][];

/**
 * Apple Health summary card: tinted label + timestamp on top,
 * big rounded numerals with small units underneath.
 */
export function MetricTile({
  label,
  icon: Icon,
  tint,
  measure,
  caption,
  detail,
  href,
}: {
  label: string;
  icon: LucideIcon;
  tint: Tint;
  measure: Measure | null;
  /** When the reading was taken, e.g. "8:05 AM" or "Yesterday". */
  caption?: string;
  /** Secondary line under the value, e.g. the workout name. */
  detail?: string;
  href?: string;
}) {
  const body = (
    <Card tint={tint} className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-[15px] font-semibold" style={{ color: tintColor(tint) }}>
          <Icon aria-hidden className="size-4" strokeWidth={2.5} fill={tint === "heart" ? "currentColor" : "none"} />
          {label}
        </span>
        {(caption || href) && (
          <span className="flex items-center gap-0.5 text-[15px] text-muted-foreground">
            {caption}
            {href && <ChevronRight aria-hidden className="size-4 text-subtle-foreground" strokeWidth={2.5} />}
          </span>
        )}
      </div>

      <div>
        {measure ? (
          <p className="font-rounded">
            {measure.map(([value, unit], i) => (
              <span key={i} className="mr-1.5 last:mr-0">
                <span className="text-[34px] font-semibold leading-none tracking-tight">{value}</span>
                <span className="ml-1 text-[17px] font-semibold text-muted-foreground">{unit}</span>
              </span>
            ))}
          </p>
        ) : (
          <p className="text-[17px] font-medium text-subtle-foreground">No data</p>
        )}
        {detail && <p className="mt-1 truncate text-[15px] text-muted-foreground">{detail}</p>}
      </div>
    </Card>
  );

  return href ? (
    <Link href={href} className="block rounded-3xl transition-transform active:scale-[0.985]">
      {body}
    </Link>
  ) : (
    body
  );
}
