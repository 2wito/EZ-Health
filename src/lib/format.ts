// Display helpers. Health data carries the UTC offset it was recorded in, so we
// format in *that* zone rather than the server's (Vercel runs in UTC).

const DAY_MS = 86_400_000;

const shift = (date: Date, tzOffsetMin: number) => new Date(date.getTime() + tzOffsetMin * 60_000);
const dayNumber = (shifted: Date) => Math.floor(shifted.getTime() / DAY_MS);

const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
const weekdayFmt = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" });
const shortDateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** "8:05 AM" today, "Yesterday", "Thursday" within the week, otherwise "Oct 12". */
export function formatWhen(date: Date, tzOffsetMin: number, now = new Date()) {
  return relativeDay(shift(date, tzOffsetMin), shift(now, tzOffsetMin), true);
}

/** Same as formatWhen for a calendar date (`@db.Date`, stored as UTC midnight). */
export function formatDay(day: Date, tzOffsetMin: number, now = new Date()) {
  return relativeDay(day, shift(now, tzOffsetMin), false);
}

function relativeDay(localDate: Date, localNow: Date, withTime: boolean) {
  const diff = dayNumber(localNow) - dayNumber(localDate);
  if (diff === 0) return withTime ? timeFmt.format(localDate) : "Today";
  if (diff === 1) return "Yesterday";
  if (diff > 1 && diff < 7) return weekdayFmt.format(localDate);
  return shortDateFmt.format(localDate);
}

export function formatClock(date: Date, tzOffsetMin: number) {
  return timeFmt.format(shift(date, tzOffsetMin));
}

/** Hours → [["7", "hr"], ["15", "min"]]. */
export function hoursToMeasure(hours: number): [string, string][] {
  const totalMin = Math.round(hours * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return [[String(m), "min"]];
  return m === 0 ? [[String(h), "hr"]] : [[String(h), "hr"], [String(m), "min"]];
}

export function formatNumber(value: number, maximumFractionDigits = 0) {
  return value.toLocaleString("en-US", { maximumFractionDigits });
}

const rtf = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

/** "just now", "5 minutes ago", "yesterday"… */
export function formatAgo(date: Date, now = new Date()) {
  const sec = Math.round((date.getTime() - now.getTime()) / 1000);
  if (sec > -45) return "just now";
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["minute", 60],
    ["hour", 3600],
    ["day", 86_400],
    ["week", 604_800],
  ];
  let [unit, size] = units[0];
  for (const u of units) if (Math.abs(sec) >= u[1]) [unit, size] = u;
  return rtf.format(Math.round(sec / size), unit);
}

export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

const compactFmt = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** 1204331 → "1.2M" */
export const formatCompact = (value: number) => compactFmt.format(value);
