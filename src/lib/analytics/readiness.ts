// Readiness: how recovered you are today, from the latest HRV, resting heart
// rate and last night's sleep, each against your own 30-day baseline.
// Deterministic on purpose: it works without an AI key, and the coach is given
// the same numbers so its advice can't contradict the dashboard.
// Calibrated so a day exactly at baseline lands near 70 ("Train as planned");
// full marks need HRV ~10% up, resting HR ~3 bpm down and 8 h of sleep.

export interface ReadinessInput {
  hrv: { latest: number; baseline: number } | null;
  rhr: { latest: number; baseline: number } | null;
  sleepHours: number | null;
}

export type ReadinessLevel = "push" | "normal" | "recover";

/** A plain-language reason: English `text` for the coach briefing, plus the numbers so the UI can word it in any language. */
export type ReadinessNote = { text: string; tone: "good" | "neutral" | "bad" } & (
  | { kind: "hrv"; pct: number }
  | { kind: "rhr"; diff: number }
  | { kind: "sleep"; h: number; m: number }
);

export interface Readiness {
  score: number;
  level: ReadinessLevel;
  label: string;
  /** Plain-language reasons, worst first. */
  notes: ReadinessNote[];
}

const lerp = (x: number, x0: number, x1: number, y0: number, y1: number) =>
  y0 + (Math.min(Math.max(x, Math.min(x0, x1)), Math.max(x0, x1)) - x0) * ((y1 - y0) / (x1 - x0));

export function computeReadiness({ hrv, rhr, sleepHours }: ReadinessInput): Readiness | null {
  const parts: { points: number; max: number; note: ReadinessNote; severity: number }[] = [];

  if (hrv && hrv.baseline > 0) {
    const ratio = hrv.latest / hrv.baseline;
    const pct = Math.round((ratio - 1) * 100);
    parts.push({
      points: lerp(ratio, 0.75, 1.1, 5, 35),
      max: 35,
      severity: -pct,
      note: {
        kind: "hrv",
        pct,
        text: Math.abs(pct) < 5 ? "HRV is in your normal range" : `HRV is ${Math.abs(pct)}% ${pct < 0 ? "below" : "above"} your 30-day average`,
        tone: pct <= -10 ? "bad" : pct >= 5 ? "good" : "neutral",
      },
    });
  }
  if (rhr) {
    const diff = Math.round(rhr.latest - rhr.baseline);
    parts.push({
      points: lerp(diff, -3, 5, 30, 5),
      max: 30,
      severity: diff * 3,
      note: {
        kind: "rhr",
        diff,
        text: Math.abs(diff) < 2 ? "Resting heart rate is at your baseline" : `Resting heart rate is ${Math.abs(diff)} bpm ${diff > 0 ? "above" : "below"} your baseline`,
        tone: diff >= 3 ? "bad" : diff <= -2 ? "good" : "neutral",
      },
    });
  }
  if (sleepHours !== null) {
    const totalMin = Math.round(sleepHours * 60); // round once, so 7.99 h reads "8h 0m", not "7h 60m"
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    parts.push({
      points: lerp(sleepHours, 5, 8, 5, 35),
      max: 35,
      severity: (7.5 - sleepHours) * 10,
      note: {
        kind: "sleep",
        h,
        m,
        text: `You slept ${h}h ${m}m last night`,
        tone: sleepHours < 6.5 ? "bad" : sleepHours >= 7.5 ? "good" : "neutral",
      },
    });
  }

  // Needs at least two of the three signals to say anything.
  if (parts.length < 2) return null;
  const score = Math.round((parts.reduce((a, p) => a + p.points, 0) / parts.reduce((a, p) => a + p.max, 0)) * 100);
  const level: ReadinessLevel = score >= 75 ? "push" : score >= 50 ? "normal" : "recover";
  return {
    score,
    level,
    label: level === "push" ? "Ready to push" : level === "normal" ? "Train as planned" : "Prioritize recovery",
    notes: parts.sort((a, b) => b.severity - a.severity).map((p) => p.note),
  };
}
