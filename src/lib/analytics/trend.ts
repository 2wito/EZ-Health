// Is a metric getting better or worse? Compares the mean of the current window
// with the mean of the previous window of the same length. Changes smaller
// than the metric's normal day-to-day noise count as "stable".

export type Better = "lower" | "higher" | "neutral";
export type Verdict = "improving" | "declining" | "stable";

export interface Trend {
  current: number | null;
  previous: number | null;
  delta: number | null;
  /** null when either window has too little data to compare. */
  verdict: Verdict | null;
  /** For neutral metrics, which way it moved (verdict is then "stable" or null). */
  direction: "up" | "down" | "flat" | null;
  better: Better;
}

export interface TrendOptions {
  better: Better;
  /** Smallest change that isn't noise, in the metric's unit. */
  threshold: number;
  /** Minimum readings needed in each window. */
  minPoints?: number;
}

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function computeTrend(current: number[], previous: number[], opts: TrendOptions): Trend {
  const { better, threshold, minPoints = 2 } = opts;
  const cur = mean(current);
  const prev = mean(previous);
  const base = { current: cur, previous: prev, better };

  if (cur === null || prev === null || current.length < minPoints || previous.length < minPoints) {
    return { ...base, delta: null, verdict: null, direction: null };
  }

  const delta = cur - prev;
  const direction = Math.abs(delta) < threshold ? "flat" : delta > 0 ? "up" : "down";
  if (direction === "flat") return { ...base, delta, verdict: "stable", direction };
  if (better === "neutral") return { ...base, delta, verdict: null, direction };

  const improved = (better === "lower") === (direction === "down");
  return { ...base, delta, verdict: improved ? "improving" : "declining", direction };
}

/**
 * Trend for a dashboard window. The headline (`current`) is the mean over
 * everything shown; the change compares the window's recent span with its
 * previous one (the period before, or for all time, the first half).
 */
export function windowTrend(shown: number[], recent: number[], previous: number[], opts: TrendOptions): Trend {
  return { ...computeTrend(recent, previous, opts), current: mean(shown) };
}

/** Splits day-keyed values into what a window shows, its recent span and the span it's compared with. */
export function splitByWindow(
  points: Iterable<readonly [day: string, value: number]>,
  w: { start: Date; end: Date; recentStart: Date; recentEnd: Date; prevStart: Date; prevEnd: Date },
) {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const [s, e, rs, re, ps, pe] = [w.start, w.end, w.recentStart, w.recentEnd, w.prevStart, w.prevEnd].map(iso);
  const shown: number[] = [];
  const recent: number[] = [];
  const previous: number[] = [];
  for (const [day, v] of points) {
    if (day >= s && day <= e) shown.push(v);
    if (day >= rs && day <= re) recent.push(v);
    if (day >= ps && day <= pe) previous.push(v);
  }
  return [shown, recent, previous] as const;
}
