// Display helpers. Health data carries the UTC offset it was recorded in, so we
// format in *that* zone rather than the server's (Vercel runs in UTC).
// Every formatter is bound to a locale: `createFormat("he")` gives Hebrew words
// and the 24-hour clock used in Israel.

import { intlTag, type Locale } from "@/lib/i18n/config";

const DAY_MS = 86_400_000;
const DAY_MIN = 1440;

const shift = (date: Date, tzOffsetMin: number) => new Date(date.getTime() + tzOffsetMin * 60_000);
const dayNumber = (shifted: Date) => Math.floor(shifted.getTime() / DAY_MS);

const WORDS = {
  en: { today: "Today", yesterday: "Yesterday", justNow: "just now", hr: "hr", min: "min", h: "h", m: "m" },
  he: { today: "היום", yesterday: "אתמול", justNow: "הרגע", hr: "שע׳", min: "דק׳", h: " ש׳", m: " ד׳" },
} as const;

export type Format = ReturnType<typeof buildFormat>;

const cache = new Map<Locale, Format>();

export function createFormat(locale: Locale): Format {
  let f = cache.get(locale);
  if (!f) cache.set(locale, (f = buildFormat(locale)));
  return f;
}

function buildFormat(locale: Locale) {
  const tag = intlTag(locale);
  const w = WORDS[locale];
  const h12 = locale === "en";

  const timeFmt = new Intl.DateTimeFormat(tag, { hour: "numeric", minute: "2-digit", hour12: h12, timeZone: "UTC" });
  const weekdayFmt = new Intl.DateTimeFormat(tag, { weekday: "long", timeZone: "UTC" });
  const shortDateFmt = new Intl.DateTimeFormat(tag, { month: "short", day: "numeric", timeZone: "UTC" });
  // Chart days are "YYYY-MM-DD" calendar dates, formatted in UTC so the
  // viewer's timezone can't shift them by a day.
  const chartWeekday = new Intl.DateTimeFormat(tag, { weekday: "short", timeZone: "UTC" });
  const chartFull = new Intl.DateTimeFormat(tag, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const monthYearFmt = new Intl.DateTimeFormat(tag, { month: "short", year: "numeric" });
  const todayFmt = new Intl.DateTimeFormat(tag, { weekday: "long", month: "long", day: "numeric" });
  const rtf = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
  const compactFmt = new Intl.NumberFormat(tag, { notation: "compact", maximumFractionDigits: 1 });
  const weekdayNames = (style: "long" | "short" | "narrow") => {
    const fmt = new Intl.DateTimeFormat(tag, { weekday: style, timeZone: "UTC" });
    // 1970-01-04 was a Sunday.
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(1970, 0, 4 + i))));
  };

  function relativeDay(localDate: Date, localNow: Date, withTime: boolean) {
    const diff = dayNumber(localNow) - dayNumber(localDate);
    if (diff === 0) return withTime ? timeFmt.format(localDate) : w.today;
    if (diff === 1) return w.yesterday;
    if (diff > 1 && diff < 7) return weekdayFmt.format(localDate);
    return shortDateFmt.format(localDate);
  }

  /** Hours → [["7", "hr"], ["15", "min"]]. */
  function hoursToMeasure(hours: number): [string, string][] {
    const totalMin = Math.round(hours * 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h === 0) return [[String(m), w.min]];
    return m === 0 ? [[String(h), w.hr]] : [[String(h), w.hr], [String(m), w.min]];
  }

  /** A clock time split into [time, period]: ["11:30", "PM"], or ["23:30", ""] on a 24-hour clock. */
  function clockParts(minSinceNoon: number): [string, string] {
    // Truncate seconds like iOS does, so 11:25:40 reads 11:25 everywhere.
    const m = (((Math.floor(minSinceNoon + 1e-9) + 720) % DAY_MIN) + DAY_MIN) % DAY_MIN;
    const h24 = Math.floor(m / 60);
    const mm = String(m % 60).padStart(2, "0");
    if (!h12) return [`${String(h24).padStart(2, "0")}:${mm}`, ""];
    return [`${h24 % 12 === 0 ? 12 : h24 % 12}:${mm}`, h24 < 12 ? "AM" : "PM"];
  }

  return {
    locale,

    /** "8:05 AM" today, "Yesterday", "Thursday" within the week, otherwise "Oct 12". */
    when: (date: Date, tzOffsetMin: number, now = new Date()) =>
      relativeDay(shift(date, tzOffsetMin), shift(now, tzOffsetMin), true),

    /** Same as `when` for a calendar date (`@db.Date`, stored as UTC midnight). */
    day: (day: Date, tzOffsetMin: number, now = new Date()) => relativeDay(day, shift(now, tzOffsetMin), false),

    clock: (date: Date, tzOffsetMin: number) => timeFmt.format(shift(date, tzOffsetMin)),

    /** Minutes since noon (see analytics/sleep) → "11:30 PM" / "23:30". */
    clockLabel: (minSinceNoon: number) => clockParts(minSinceNoon).filter(Boolean).join(" "),
    clockParts,
    /** Axis label: "11 PM" / "23". */
    clockTick: (minSinceNoon: number) => {
      const [time, period] = clockParts(minSinceNoon);
      return [time.replace(":00", ""), period].filter(Boolean).join(" ");
    },

    /** Hour of day → "6 PM" / "18:00". */
    hour: (h: number) => (h12 ? `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}` : `${String(h).padStart(2, "0")}:00`),
    /** Compact heatmap axis label: "6p" / "18". */
    hourTick: (h: number) => (h12 ? `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "a" : "p"}` : String(h)),

    hoursToMeasure,
    /** 1.25 → "1 hr 15 min" */
    duration: (hours: number) => hoursToMeasure(hours).map(([v, u]) => `${v} ${u}`).join(" "),
    /** 7.43 → "7h 26m" */
    compactDuration: (hours: number) => {
      const total = Math.round(hours * 60);
      return `${Math.floor(total / 60)}${w.h} ${total % 60}${w.m}`;
    },

    number: (value: number, maximumFractionDigits = 0) => value.toLocaleString(tag, { maximumFractionDigits }),
    /** 1204331 → "1.2M" */
    compact: (value: number) => compactFmt.format(value),
    bytes: (bytes: number) => {
      if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
      if (bytes < 1024 ** 3) return `${Math.round(bytes / 1024 ** 2)} MB`;
      return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
    },

    /** "just now", "5 minutes ago", "yesterday"… */
    ago: (date: Date, now = new Date()) => {
      const sec = Math.round((date.getTime() - now.getTime()) / 1000);
      if (sec > -45) return w.justNow;
      const units: [Intl.RelativeTimeFormatUnit, number][] = [
        ["minute", 60],
        ["hour", 3600],
        ["day", 86_400],
        ["week", 604_800],
      ];
      let [unit, size] = units[0];
      for (const u of units) if (Math.abs(sec) >= u[1]) [unit, size] = u;
      return rtf.format(Math.round(sec / size), unit);
    },

    /** Axis label: "Mon" for a week, "Oct 5" otherwise; `long` for tooltips. */
    chartDay: (day: string, windowDays: number, long = false) => {
      const d = new Date(`${day}T00:00:00Z`);
      if (long) return chartFull.format(d);
      return windowDays <= 7 ? chartWeekday.format(d) : shortDateFmt.format(d);
    },

    monthYear: (iso: string) => monthYearFmt.format(new Date(iso)),
    /** "Monday, October 26" in the viewer's own timezone. */
    today: (date = new Date()) => todayFmt.format(date),

    /** Sunday-first weekday names. */
    weekdays: weekdayNames("long"),
    /** Row labels for narrow axes: "Mon" / "ב׳". */
    weekdaysAxis: weekdayNames(h12 ? "short" : "narrow"),
  };
}
