import { CircleAlert, CircleCheck, CircleMinus, Sparkles, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { Readiness, ReadinessDriver, ReadinessLevel } from "@/lib/analytics/readiness";
import type { Format } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";
import type { Messages } from "@/lib/i18n/messages";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

// Readiness bands and driver tones share one validated status palette
// (--ready-*, see globals.css). Color never carries meaning alone: every band
// and driver also has an icon and a word.

const BAND: Record<ReadinessLevel, { color: string; icon: LucideIcon }> = {
  push: { color: "var(--ready-high)", icon: CircleCheck },
  normal: { color: "var(--ready-moderate)", icon: CircleMinus },
  recover: { color: "var(--ready-low)", icon: CircleAlert },
};

/** A driver's status. "Neutral" HRV or resting HR is simply normal (gray); neutral sleep is a bit short (amber). */
function toneOf(d: ReadinessDriver): { color: string; icon: LucideIcon } {
  if (d.tone === "good") return BAND.push;
  if (d.tone === "bad") return BAND.recover;
  return d.kind === "sleep" ? BAND.normal : { color: "var(--gray)", icon: CircleMinus };
}

/** Contribution bars encode amount, not status, so they share one quiet ink. */
const BAR = "color-mix(in srgb, var(--foreground) 55%, transparent)";

/**
 * Today's readiness as a frosted card: a gauge, the band and what it means for
 * training, and how much each signal (HRV, resting HR, sleep) contributed.
 * Sizes itself to its container, so it works full width or in a sidebar column.
 */
export async function ReadinessCard({
  readiness,
  day,
  sleepScore,
  coachHref,
}: {
  readiness: Readiness | null;
  /** "YYYY-MM-DD" the score describes. */
  day: string | null;
  /** Last night's sleep score, shown next to its duration (not part of the formula). */
  sleepScore?: number | null;
  /** Adds a link to the coach (on the Summary page). */
  coachHref?: string;
}) {
  const { t, f } = await getI18n();

  if (!readiness) {
    return (
      <Glass color="var(--gray)">
        <h2 className="text-[17px] font-semibold">{t.readiness.title}</h2>
        <p className="mt-1 max-w-xl text-[15px] leading-[22px] text-muted-foreground">{t.readiness.needs}</p>
      </Glass>
    );
  }

  const band = BAND[readiness.level];
  const bandName = t.readiness.bands[readiness.level];
  const plan = t.readiness.plans[readiness.level];

  return (
    <Glass color={band.color}>
      <div className="grid gap-6 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] @3xl:gap-10">
        <div className="flex flex-col gap-5 @md:flex-row @md:items-center @md:gap-6">
          <Gauge score={readiness.score} color={band.color} label={t.readiness.meter(readiness.score, bandName)} outOf={t.readiness.outOf} />
          <div className="min-w-0">
            <h2 className="text-[13px] font-medium text-muted-foreground">{t.readiness.title}</h2>
            <StatusBadge color={band.color} icon={band.icon} label={bandName} large />
            <p className="mt-2.5 text-[22px] font-semibold leading-[27px] tracking-tight">{plan.title}</p>
            <p className="mt-1.5 text-[15px] leading-[22px] text-muted-foreground">{plan.body}</p>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
              {day && <span className="text-subtle-foreground">{t.readiness.basedOn(f.chartDay(day, 0, true))}</span>}
              {coachHref && (
                <Link href={coachHref} className="inline-flex items-center gap-1 font-medium text-primary">
                  <Sparkles aria-hidden className="size-3.5" strokeWidth={2.25} />
                  {t.summary.askCoach}
                </Link>
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-border pt-5 @3xl:border-t-0 @3xl:border-s @3xl:ps-10 @3xl:pt-0">
          <h3 className="mb-4 text-[13px] font-medium text-muted-foreground">{t.readiness.drivers}</h3>
          <ul className="space-y-4">
            {readiness.drivers.map((d) => (
              <DriverRow key={d.kind} driver={d} t={t} f={f} sleepScore={sleepScore ?? null} />
            ))}
          </ul>
        </div>
      </div>
    </Glass>
  );
}

/** Frosted surface with a soft glow in the band's color behind the content. */
function Glass({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <section
      className={cn(
        "@container relative isolate overflow-hidden rounded-3xl border p-5 sm:p-6",
        "border-white/70 bg-card/75 backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-card/70",
        // Card shadow plus a hairline top highlight, like light catching the glass edge.
        "[box-shadow:var(--card-shadow),inset_0_1px_0_rgb(255_255_255/0.6)] dark:[box-shadow:inset_0_1px_0_rgb(255_255_255/0.06)]",
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -start-24 -top-32 -z-10 size-96 rounded-full opacity-20 blur-3xl dark:opacity-25"
        style={{ background: color }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 -end-24 -z-10 size-80 rounded-full opacity-10 blur-3xl dark:opacity-15"
        style={{ background: color }}
      />
      {children}
    </section>
  );
}

const R = 52;
const STROKE = 12;
const LENGTH = 2 * Math.PI * R;

/** Circular gauge that fills once when it appears (instantly with reduced motion). */
function Gauge({ score, color, label, outOf }: { score: number; color: string; label: string; outOf: string }) {
  const clamped = Math.max(0, Math.min(100, score));
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      aria-label={label}
      className="relative grid size-[136px] shrink-0 place-items-center"
    >
      <svg viewBox="0 0 128 128" aria-hidden className="absolute inset-0 -rotate-90">
        <circle cx="64" cy="64" r={R} fill="none" stroke="var(--muted)" strokeWidth={STROKE} />
        <circle
          cx="64"
          cy="64"
          r={R}
          fill="none"
          stroke={color}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={`${LENGTH} ${LENGTH}`}
          strokeDashoffset={LENGTH * (1 - clamped / 100)}
          className="motion-reduce:[animation:none]"
          style={{ ["--gauge-length" as string]: LENGTH, animation: "gauge-fill 900ms cubic-bezier(0.2, 0.8, 0.2, 1) both" }}
        />
      </svg>
      <div className="text-center" aria-hidden>
        <span className="block font-rounded text-[40px] font-semibold leading-none tracking-tight">{clamped}</span>
        <span className="mt-1 block text-[12px] font-medium text-muted-foreground">{outOf}</span>
      </div>
    </div>
  );
}

function DriverRow({ driver: d, t, f, sleepScore }: { driver: ReadinessDriver; t: Messages; f: Format; sleepScore: number | null }) {
  const tone = toneOf(d);
  const share = d.max > 0 ? d.points / d.max : 0;
  const pct = Math.round(share * 100);
  const detail =
    d.kind === "hrv"
      ? t.readiness.detail.hrv(d.latest, d.baseline, d.pct)
      : d.kind === "rhr"
        ? t.readiness.detail.rhr(d.latest, d.baseline, d.diff)
        : [t.readiness.detail.sleep(f.duration(d.h + d.m / 60)), sleepScore !== null ? t.readiness.detail.sleepScore(sleepScore) : null]
            .filter(Boolean)
            .join(", ");

  return (
    <li>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold leading-tight">{t.readiness.driverNames[d.kind]}</p>
          <p className="mt-0.5 text-[13px] leading-[18px] text-muted-foreground">{detail}</p>
        </div>
        <StatusBadge color={tone.color} icon={tone.icon} label={t.readiness.status[d.kind][d.tone]} />
      </div>
      <div className="mt-2 flex items-center gap-3">
        <div aria-hidden className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full" style={{ width: `${Math.max(2, pct)}%`, background: BAR }} />
        </div>
        <span className="w-11 shrink-0 text-end text-[13px] font-semibold tabular-nums">{pct}%</span>
        <span className="sr-only">{t.readiness.contribution(d.points, d.max)}</span>
      </div>
    </li>
  );
}
