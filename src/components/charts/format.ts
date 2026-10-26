// Chart days are "YYYY-MM-DD" calendar dates; format them in UTC so the
// viewer's timezone can't shift them by a day.

const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const monthDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const full = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/** Axis label: "Mon" for a week, "Oct 5" otherwise; `long` for tooltips. */
export function formatChartDay(day: string, windowDays: number, long = false) {
  const d = new Date(`${day}T00:00:00Z`);
  if (long) return full.format(d);
  return windowDays <= 7 ? weekday.format(d) : monthDay.format(d);
}
