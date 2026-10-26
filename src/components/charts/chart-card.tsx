import { Card, type Tint } from "@/components/ui/card";
import type { Format } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";

export interface LegendItem {
  label: string;
  color: string;
  /** Mirror the mark: line for lines, dot for dots, square for bars/areas. */
  kind: "line" | "dot" | "square";
}

/**
 * Card around a chart: title, legend (only for 2+ series), the chart, and a
 * "Show as table" twin so no value depends on hovering.
 */
export async function ChartCard({
  title,
  description,
  legend,
  tint,
  table,
  children,
}: {
  title: string;
  description?: string;
  legend?: LegendItem[];
  tint?: Tint;
  table?: { columns: string[]; rows: (string | number | null)[][] };
  children: React.ReactNode;
}) {
  const { t } = await getI18n();
  return (
    <Card tint={tint} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div>
          <h3 className="text-[17px] font-semibold">{title}</h3>
          {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
        </div>
        {legend && legend.length > 1 && (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
            {legend.map((item) => (
              <li key={item.label} className="flex items-center gap-1.5">
                {item.kind === "dot" ? (
                  <span aria-hidden className="size-2 rounded-full" style={{ background: item.color }} />
                ) : item.kind === "square" ? (
                  <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: item.color }} />
                ) : (
                  <span aria-hidden className="h-0.5 w-3.5 rounded-full" style={{ background: item.color }} />
                )}
                {item.label}
              </li>
            ))}
          </ul>
        )}
      </div>

      {children}

      {table && table.rows.length > 0 && (
        <details className="group text-[13px]">
          <summary className="cursor-pointer select-none font-medium text-primary marker:content-none">
            <span className="group-open:hidden">{t.common.showTable}</span>
            <span className="hidden group-open:inline">{t.common.hideTable}</span>
          </summary>
          <div className="mt-3 max-h-72 overflow-auto rounded-xl border border-border">
            <table className="w-full text-start tabular-nums">
              <thead className="sticky top-0 bg-card-elevated text-muted-foreground">
                <tr>
                  {table.columns.map((c) => (
                    <th key={c} scope="col" className="px-3 py-2 font-medium">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {table.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j} className="px-3 py-1.5">
                        {cell ?? "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </Card>
  );
}

/** Table rows from daily data: newest first, only days that have a value. */
export function dailyTableRows<T extends { day: string }>(
  days: T[],
  cells: ((d: T) => number | string | null)[],
  f: Format,
): (string | number | null)[][] {
  return days
    .filter((d) => cells.some((c) => c(d) !== null))
    .reverse()
    .map((d) => [f.chartDay(d.day, 0, true), ...cells.map((c) => c(d))]);
}
