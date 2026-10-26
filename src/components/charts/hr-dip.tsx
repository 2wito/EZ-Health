import { CircleAlert, CircleCheck, CircleMinus, HeartPulse, type LucideIcon } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import type { DipHalf } from "@/lib/analytics/sleep";
import { getI18n } from "@/lib/i18n/server";
import type { SleepData } from "@/lib/queries/sleep";
import { ChartCard } from "./chart-card";

// Same validated status palette as readiness. A dip in the middle hour is
// gray: hourly data can't say which half it fell in.
const HALF: Record<DipHalf, { color: string; icon: LucideIcon }> = {
  first: { color: "var(--ready-high)", icon: CircleCheck },
  middle: { color: "var(--gray)", icon: CircleMinus },
  second: { color: "var(--ready-moderate)", icon: CircleAlert },
};

/**
 * Sleeping heart-rate dip: when last night's heart rate bottomed out, on a bar
 * from falling asleep to waking, plus how often the dip came early this period.
 */
export async function HeartRateDipCard({ dip }: { dip: SleepData["hrDip"] }) {
  const { t, f } = await getI18n();
  const d = t.sleep.dip;
  const hourRange = (from: number) => t.sleep.span(f.clockLabel(from), f.clockLabel(from + 60));
  const { last, nights } = dip;

  const counts = { first: 0, middle: 0, second: 0 } satisfies Record<DipHalf, number>;
  for (const n of nights) counts[n.half]++;

  return (
    <ChartCard
      title={d.title}
      description={d.desc}
      table={{
        columns: [t.common.night, d.lowest, d.hour, d.half],
        rows: nights
          .toReversed()
          .map((n) => [f.chartDay(n.day, 0, true), `${n.bpm} ${t.units.bpm}`, hourRange(n.from), d.short[n.half]]),
      }}
    >
      {!last ? (
        <p className="text-[15px] text-muted-foreground">{d.none}</p>
      ) : (
        <div className="grid gap-5 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] md:gap-8">
          <div>
            <p className="text-[13px] text-muted-foreground">{d.night(f.chartDay(last.day, 0, true))}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="font-rounded">
                <span className="text-[34px] font-semibold leading-none tracking-tight [unicode-bidi:isolate]">{last.bpm}</span>
                <span className="ms-1 text-[17px] font-semibold text-muted-foreground [unicode-bidi:isolate]">{t.units.bpm}</span>
              </p>
              <StatusBadge color={HALF[last.half].color} icon={HALF[last.half].icon} label={d.halves[last.half]} />
            </div>
            <p className="mt-1 text-[15px] text-muted-foreground">{d.around(hourRange(last.from))}</p>
            <NightBar
              bed={last.bed}
              wake={last.wake}
              from={last.from}
              color={HALF[last.half].color}
              labels={{ asleep: d.asleep, woke: d.woke, midpoint: d.midpoint }}
              clock={(m) => f.clockLabel(m)}
            />
          </div>

          <div className="border-t border-border pt-4 md:border-s md:border-t-0 md:ps-8 md:pt-0">
            <p className="flex items-start gap-2 text-[15px] font-semibold">
              <HeartPulse aria-hidden className="mt-0.5 size-4 shrink-0 text-heart" strokeWidth={2.5} />
              {d.period(counts.first, nights.length)}
            </p>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              {(["first", "middle", "second"] as const).map((half) => (
                <div key={half} className="rounded-xl bg-muted/60 px-2 py-2.5">
                  <dt className="flex items-center justify-center gap-1 text-[12px] text-muted-foreground">
                    <HalfIcon half={half} />
                    {d.short[half]}
                  </dt>
                  <dd className="font-rounded text-[22px] font-semibold tabular-nums">{counts[half]}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-[12px] leading-[17px] text-subtle-foreground">{d.precision}</p>
          </div>
        </div>
      )}
    </ChartCard>
  );
}

function HalfIcon({ half }: { half: DipHalf }) {
  const { icon: Icon, color } = HALF[half];
  return <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={2.5} style={{ color }} />;
}

/** Falling asleep → waking, with the midpoint and the dip's hour marked. Time runs left to right in every language. */
function NightBar({
  bed,
  wake,
  from,
  color,
  labels,
  clock,
}: {
  bed: number;
  wake: number;
  from: number;
  color: string;
  labels: { asleep: string; woke: string; midpoint: string };
  clock: (m: number) => string;
}) {
  const span = Math.max(1, wake - bed);
  const pct = (m: number) => Math.min(100, Math.max(0, ((m - bed) / span) * 100));
  const left = pct(from);
  const width = Math.max(1.5, pct(from + 60) - left);

  return (
    <div dir="ltr" className="mt-5" aria-hidden>
      <div className="relative h-3 rounded-full bg-muted">
        <div className="absolute inset-y-0 rounded-full" style={{ left: `${left}%`, width: `${width}%`, background: color }} />
        <div className="absolute -inset-y-1.5 left-1/2 w-px bg-foreground/45" />
      </div>
      <div className="mt-1.5 grid grid-cols-3 text-[12px] text-muted-foreground">
        <span>
          {labels.asleep}
          <br />
          <span className="font-semibold text-foreground">{clock(bed)}</span>
        </span>
        <span className="text-center">{labels.midpoint}</span>
        <span className="text-end">
          {labels.woke}
          <br />
          <span className="font-semibold text-foreground">{clock(wake)}</span>
        </span>
      </div>
    </div>
  );
}
