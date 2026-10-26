import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { TrendBadge } from "@/components/ui/trend-tile";
import { getI18n } from "@/lib/i18n/server";
import type { Evaluation, HorizonAssessment } from "@/lib/queries/evaluation";

const OVERALL = {
  up: { icon: ArrowUpRight, tone: "var(--good)" },
  steady: { icon: Minus, tone: "var(--gray)" },
  down: { icon: ArrowDownRight, tone: "var(--warning)" },
} as const;

/**
 * Health Trend Evaluator: fitness + recovery signals over three horizons.
 * Every verdict shows the signals behind it, so the call is explainable.
 */
export async function TrendEvaluator({ evaluation }: { evaluation: Evaluation }) {
  const { t } = await getI18n();
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h3 className="text-[17px] font-semibold">{t.evaluator.title}</h3>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{t.evaluator.desc}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {evaluation.horizons.map((h) => (
          <Horizon key={h.days} h={h} />
        ))}
      </div>
    </Card>
  );
}

async function Horizon({ h }: { h: HorizonAssessment }) {
  const { t } = await getI18n();
  const overall = h.overall ? OVERALL[h.overall] : null;
  const counted = h.signals.filter((s) => s.trend.verdict !== null);
  const count = (v: "improving" | "declining" | "stable") => counted.filter((s) => s.trend.verdict === v).length;
  const groups = (["Fitness", "Recovery"] as const)
    .map((g) => ({ g, signals: h.signals.filter((s) => s.group === g) }))
    .filter((x) => x.signals.length);

  return (
    <section aria-label={t.evaluator.lastDays(h.days)} className="rounded-2xl bg-muted/60 p-4">
      <p className="text-[13px] font-medium text-muted-foreground">{t.evaluator.lastDays(h.days)}</p>
      {overall && h.overall ? (
        <p className="mt-1 flex items-center gap-1.5 text-[20px] font-semibold">
          <overall.icon aria-hidden className="size-5" strokeWidth={2.75} style={{ color: overall.tone }} />
          {t.evaluator[h.overall]}
        </p>
      ) : (
        <p className="mt-1 text-[17px] font-semibold text-subtle-foreground">{t.evaluator.notEnough}</p>
      )}
      <p className="mt-0.5 text-[13px] text-muted-foreground">
        {counted.length
          ? t.evaluator.counts(count("improving"), count("declining"), count("stable"))
          : t.evaluator.needs(h.days * 2)}
      </p>

      {groups.map(({ g, signals }) => (
        <div key={g} className="mt-4">
          <p className="mb-1.5 text-[12px] font-semibold text-muted-foreground">{t.evaluator.groups[g]}</p>
          <ul className="space-y-1.5">
            {signals.map((s) => (
              <li key={s.key} className="flex items-center justify-between gap-2 text-[14px]">
                <span className="min-w-0">
                  {t.evaluator.signals[s.key] ?? s.label}
                  {s.trend.current !== null && (
                    <span className="ms-1.5 text-[12px] text-muted-foreground [unicode-bidi:isolate]">
                      {s.trend.current.toFixed(s.digits)} {t.unitMap[s.unit] ?? s.unit}
                    </span>
                  )}
                </span>
                {s.trend.verdict ? (
                  <TrendBadge trend={s.trend} />
                ) : (
                  <span className="shrink-0 text-[12px] text-subtle-foreground">{t.evaluator.tooFew}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
