// Time windows for the dashboards. Windows end on the latest day that has
// data rather than "today": after importing an old export, a today-anchored
// window would just be empty.

export const RANGE_KEYS = ["7d", "30d", "90d", "all"] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];

/** Length of the fixed windows; "all" runs from the first day with data. */
export const RANGE_DAYS = { "7d": 7, "30d": 30, "90d": 90 } as const;

export function parseRange(value: string | string[] | undefined): RangeKey {
  return value === "7d" || value === "90d" || value === "all" ? value : "30d";
}

const DAY_MS = 86_400_000;

/** Calendar days as UTC-midnight Dates / "YYYY-MM-DD" strings (matches `@db.Date`). */
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY_MS);

export interface DayWindow {
  days: number;
  /** What the page shows: charts, tables and headline averages. */
  start: Date;
  end: Date;
  /**
   * What trends compare: `recent` against `prev`. For a fixed window that's
   * the window against the equally long one before it; for all time, the
   * second half of the history against the first.
   */
  recentStart: Date;
  recentEnd: Date;
  prevStart: Date;
  prevEnd: Date;
  /** "previous": vs the period before. "halves": second half vs first. */
  comparison: "previous" | "halves";
  /** Earliest day queries need to read. */
  from: Date;
}

export function windowEnding(end: Date, days: number): DayWindow {
  const start = addDays(end, -(days - 1));
  const prevStart = addDays(start, -days);
  return {
    days,
    start,
    end,
    recentStart: start,
    recentEnd: end,
    prevStart,
    prevEnd: addDays(start, -1),
    comparison: "previous",
    from: prevStart,
  };
}

/** The window for a range picker value. `first` is the earliest day with data (needed for "all"). */
export function rangeWindow(range: RangeKey, end: Date, first: Date | null): DayWindow {
  if (range !== "all") return windowEnding(end, RANGE_DAYS[range]);
  const start = first && first < end ? first : end;
  const days = daysBetween(start, end) + 1;
  const recentStart = addDays(start, Math.floor(days / 2));
  return {
    days,
    start,
    end,
    recentStart,
    recentEnd: end,
    prevStart: start,
    prevEnd: addDays(recentStart, -1),
    comparison: "halves",
    from: start,
  };
}

export function eachDay(start: Date, end: Date): string[] {
  const out: string[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += DAY_MS) out.push(isoDay(new Date(t)));
  return out;
}

export const inWindow = (day: Date | string, from: Date, to: Date) => {
  const s = typeof day === "string" ? day : isoDay(day);
  return s >= isoDay(from) && s <= isoDay(to);
};

// ─── Chart buckets ───────────────────────────────────────────────────────────

/** Charts show days up to ~4 months, then weeks, then (past two years) months. */
export type Granularity = "day" | "week" | "month";

export const granularityFor = (days: number): Granularity => (days <= 120 ? "day" : days <= 730 ? "week" : "month");

/** First day of the bucket holding `day` ("YYYY-MM-DD"). Weeks start on Sunday. */
export function bucketStart(day: string, g: Granularity): string {
  if (g === "day") return day;
  if (g === "month") return `${day.slice(0, 8)}01`;
  const d = new Date(`${day}T00:00:00Z`);
  return isoDay(addDays(d, -d.getUTCDay()));
}

/**
 * Averages day rows into week or month rows (each numeric field: mean of the
 * days that have it). Row `day` becomes the bucket's first day.
 */
export function bucketRows<T extends { day: string }>(rows: T[], g: Granularity, fields: (keyof T)[]): T[] {
  if (g === "day") return rows;
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const key = bucketStart(r.day, g);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups].map(([day, group]) => {
    const out = { ...group[0], day } as T;
    for (const f of fields) {
      const values = group.map((r) => r[f]).filter((v): v is T[keyof T] & number => typeof v === "number");
      (out as Record<keyof T, unknown>)[f] = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    }
    return out;
  });
}
