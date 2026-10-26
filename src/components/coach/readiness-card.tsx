import { CircleAlert, CircleCheck, CircleMinus } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { Readiness, ReadinessLevel } from "@/lib/analytics/readiness";

const TONE: Record<ReadinessLevel, string> = { push: "var(--good)", normal: "var(--primary)", recover: "var(--warning)" };

/** What today's readiness means for training. Rules, not AI, so it's always available. */
const TODAY: Record<ReadinessLevel, { title: string; body: string }> = {
  push: {
    title: "A good day for a hard session",
    body: "Intervals, a tempo run or heavy lifting. Warm up well and stop if it feels off.",
  },
  normal: {
    title: "Train as planned",
    body: "A steady run or your usual strength session. Save maximum efforts for a fresher day.",
  },
  recover: {
    title: "Make it an easy day",
    body: "Rest, or 20 to 40 minutes of walking, mobility or easy cycling at a pace where you can talk.",
  },
};

export function ReadinessCard({ readiness }: { readiness: Readiness | null }) {
  if (!readiness) {
    return (
      <Card>
        <h2 className="text-[17px] font-semibold">Readiness</h2>
        <p className="mt-1 text-[15px] text-muted-foreground">
          Needs at least two of HRV, resting heart rate and last night&apos;s sleep, plus a few weeks of history for a
          baseline.
        </p>
      </Card>
    );
  }

  const tone = TONE[readiness.level];
  const today = TODAY[readiness.level];
  const R = 34;
  const C = 2 * Math.PI * R;

  return (
    <Card className="flex flex-col gap-5">
      <div className="flex items-center gap-4">
        <svg viewBox="0 0 80 80" className="size-20 shrink-0 -rotate-90" role="img" aria-label={`Readiness ${readiness.score} out of 100`}>
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
          <p className="text-[13px] font-medium text-muted-foreground">Readiness</p>
          <p className="text-[22px] font-semibold leading-tight">{readiness.label}</p>
        </div>
      </div>

      <ul className="space-y-2 text-[15px]">
        {readiness.notes.map((n) => {
          const Icon = n.tone === "good" ? CircleCheck : n.tone === "bad" ? CircleAlert : CircleMinus;
          const color = n.tone === "good" ? "var(--good)" : n.tone === "bad" ? "var(--warning)" : "var(--gray)";
          return (
            <li key={n.text} className="flex items-start gap-2">
              <Icon aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2.5} style={{ color }} />
              {n.text}
            </li>
          );
        })}
      </ul>

      <div className="rounded-2xl bg-muted/60 p-4">
        <p className="text-[13px] font-medium text-muted-foreground">Today</p>
        <p className="mt-0.5 font-semibold">{today.title}</p>
        <p className="mt-1 text-[14px] leading-[20px] text-muted-foreground">{today.body}</p>
      </div>
    </Card>
  );
}
