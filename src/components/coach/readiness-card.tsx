import { CircleAlert, CircleCheck, CircleMinus } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { Readiness, ReadinessLevel, ReadinessNote } from "@/lib/analytics/readiness";
import { getI18n } from "@/lib/i18n/server";
import type { Messages } from "@/lib/i18n/messages";

const TONE: Record<ReadinessLevel, string> = { push: "var(--good)", normal: "var(--primary)", recover: "var(--warning)" };

function noteText(t: Messages, n: ReadinessNote) {
  const w = t.readiness.notes;
  if (n.kind === "hrv") return Math.abs(n.pct) < 5 ? w.hrvNormal : w.hrv(Math.abs(n.pct), n.pct < 0);
  if (n.kind === "rhr") return Math.abs(n.diff) < 2 ? w.rhrNormal : w.rhr(Math.abs(n.diff), n.diff > 0);
  return w.sleep(n.h, n.m);
}

/** What today's readiness means for training. Rules, not AI, so it's always available. */
export async function ReadinessCard({ readiness }: { readiness: Readiness | null }) {
  const { t } = await getI18n();
  if (!readiness) {
    return (
      <Card>
        <h2 className="text-[17px] font-semibold">{t.readiness.title}</h2>
        <p className="mt-1 text-[15px] text-muted-foreground">{t.readiness.needs}</p>
      </Card>
    );
  }

  const tone = TONE[readiness.level];
  const today = t.readiness.plans[readiness.level];
  const R = 34;
  const C = 2 * Math.PI * R;

  return (
    <Card className="flex flex-col gap-5">
      <div className="flex items-center gap-4">
        <svg viewBox="0 0 80 80" className="size-20 shrink-0 -rotate-90" role="img" aria-label={t.readiness.aria(readiness.score)}>
          <circle cx="40" cy="40" r={R} fill="none" stroke="var(--muted)" strokeWidth="8" />
          <circle
            cx="40"
            cy="40"
            r={R}
            fill="none"
            stroke={tone}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${(readiness.score / 100) * C} ${C}`}
          />
          <text x="40" y="40" transform="rotate(90 40 40)" textAnchor="middle" dominantBaseline="central" className="fill-foreground font-rounded text-[22px] font-semibold">
            {readiness.score}
          </text>
        </svg>
        <div>
          <p className="text-[13px] font-medium text-muted-foreground">{t.readiness.title}</p>
          <p className="text-[22px] font-semibold leading-tight">{t.readiness.levels[readiness.level]}</p>
        </div>
      </div>

      <ul className="space-y-2 text-[15px]">
        {readiness.notes.map((n) => {
          const Icon = n.tone === "good" ? CircleCheck : n.tone === "bad" ? CircleAlert : CircleMinus;
          const color = n.tone === "good" ? "var(--good)" : n.tone === "bad" ? "var(--warning)" : "var(--gray)";
          return (
            <li key={n.kind} className="flex items-start gap-2">
              <Icon aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2.5} style={{ color }} />
              {noteText(t, n)}
            </li>
          );
        })}
      </ul>

      <div className="rounded-2xl bg-muted/60 p-4">
        <p className="text-[13px] font-medium text-muted-foreground">{t.readiness.today}</p>
        <p className="mt-0.5 font-semibold">{today.title}</p>
        <p className="mt-1 text-[14px] leading-[20px] text-muted-foreground">{today.body}</p>
      </div>
    </Card>
  );
}
