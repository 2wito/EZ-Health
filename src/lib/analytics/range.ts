// Time windows for the dashboards. Windows end on the latest day that has
// data rather than "today": after importing an old export, a today-anchored
// window would just be empty.

export const RANGES = { "7d": 7, "30d": 30, "90d": 90 } as const;
export type RangeKey = keyof typeof RANGES;

export function parseRange(value: string | string[] | undefined): RangeKey {
  return value === "7d" || value === "90d" ? value : "30d";
}

const DAY_MS = 86_400_000;

/** Calendar days as UTC-midnight Dates / "YYYY-MM-DD" strings (matches `@db.Date`). */
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);

export interface DayWindow {
  days: number;
  start: Date;
  end: Date;
  /** The equally long window right before, for "vs previous period". */
  prevStart: Date;
  prevEnd: Date;
}

export function windowEnding(end: Date, days: number): DayWindow {
  const start = addDays(end, -(days - 1));
  return { days, start, end, prevStart: addDays(start, -days), prevEnd: addDays(start, -1) };
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
