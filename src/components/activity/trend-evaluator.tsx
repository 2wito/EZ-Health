import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { TrendBadge } from "@/components/ui/trend-tile";
import type { Evaluation, HorizonAssessment } from "@/lib/queries/evaluation";

const OVERALL = {
  up: { label: "Trending up", icon: ArrowUpRight, tone: "var(--good)" },
  steady: { label: "Holding steady", icon: Minus, tone: "var(--gray)" },
  down: { label: "Trending down", icon: ArrowDownRight, tone: "var(--warning)" },
} as const;

/**
 * Health Trend Evaluator: fitness + recovery signals over three horizons.
 * Every verdict shows the signals behind it, so the call is explainable.
 */
export function TrendEvaluator({ evaluation }: { evaluation: Evaluation }) {
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h3 className="text-[17px] font-semibold">Fitness &amp; recovery trend</h3>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Each column compares your latest days with the same number of days before. Improving signals count for, declining
          ones against.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {evaluation.horizons.map((h) => (
          <Horizon key={h.days} h={h} />
        ))}
      </div>
    </Card>
  );
}

function Horizon({ h }: { h: HorizonAssessment }) {
  const overall = h.overall ? OVERALL[h.overall] : null;
  const counted = h.signals.filter((s) => s.trend.verdict !== null);
  const groups = (["Fitness", "Recovery"] as const)
    .map((g) => ({ g, signals: h.signals.filter((s) => s.group === g) }))
    .filter((x) => x.signals.length);

  return (
    <section aria-label={`Last ${h.days} days`} className="rounded-2xl bg-muted/60 p-4">
      <p className="text-[13px] font-medium text-muted-foreground">Last {h.days} days</p>
      {overall ? (
        <p className="mt-1 flex items-center gap-1.5 text-[20px] font-semibold">
          <overall.icon aria-hidden className="size-5" strokeWidth={2.75} style={{ color: overall.tone }} />
          {overall.label}
        </p>
      ) : (
        <p className="mt-1 text-[17px] font-semibold text-subtle-foreground">Not enough history</p>
      )}
      <p className="mt-0.5 text-[13px] text-muted-foreground">
        {counted.length
          ? `${counted.filter((s) => s.trend.verdict === "improving").length} improving, ${counted.filter((s) => s.trend.verdict === "declining").length} declining, ${counted.filter((s) => s.trend.verdict === "stable").length} steady`
          : `Needs ${h.days * 2} days of data to compare`}
      </p>

      {groups.map(({ g, signals }) => (
        <div key={g} className="mt-4">
          <p className="mb-1.5 text-[12px] font-semibold text-muted-foreground">{g}</p>
          <ul className="space-y-1.5">
            {signals.map((s) => (
              <li key={s.key} className="flex items-center justify-between gap-2 text-[14px]">
                <span className="min-w-0">
                  {s.label}
                  {s.trend.current !== null && (
                    <span className="ml-1.5 text-[12px] text-muted-foreground">
                      {s.trend.current.toFixed(s.digits)} {s.unit}
                    </span>
                  )}
                </span>
                {s.trend.verdict ? (
                  <TrendBadge trend={s.trend} />
                ) : (
                  <span className="shrink-0 text-[12px] text-subtle-foreground">Too few readings</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
