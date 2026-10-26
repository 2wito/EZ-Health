// Sleep metrics. Clock times are expressed as minutes since 12:00 PM the day
// before the night's wake date, so bedtimes either side of midnight average
// correctly (11:30 PM and 12:30 AM → midnight, not noon).

const MIN = 60_000;
const DAY_MIN = 1440;

/** Minutes since noon before `night` (the wake date, UTC-midnight Date) for an instant recorded at `tzOffsetMin`. */
export function minutesSinceNoon(at: Date, tzOffsetMin: number, night: Date): number {
  const local = at.getTime() + tzOffsetMin * MIN;
  const noonBefore = night.getTime() - 12 * 60 * MIN;
  return (local - noonBefore) / MIN;
}

/** 690 → "11:30 PM" */
export function clockLabel(minSinceNoon: number): string {
  // Truncate seconds like iOS (and formatClock) do, so 11:25:40 reads 11:25 everywhere.
  const m = (((Math.floor(minSinceNoon + 1e-9) + 720) % DAY_MIN) + DAY_MIN) % DAY_MIN;
  const h24 = Math.floor(m / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m % 60).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

/** 1.25 → "1 hr 15 min" */
export function durationLabel(hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h === 0 ? `${m} min` : m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

export interface NightStages {
  total: number; // hours asleep
  deep: number;
  rem: number;
  awake: number;
}

/**
 * Sleep score, 0–100. Deliberately simple so it can be explained:
 *  - Duration (50): full marks for 7–9 h, proportional below 7 h, gentle penalty past 9 h.
 *  - Restoration (30): deep + REM share of sleep, full marks at 40 %.
 *  - Continuity (20): full marks with no time awake, zero at 60 min awake.
 * Nights without stage data (older watches) are scored on duration + continuity, rescaled to 100.
 */
export function sleepScore({ total, deep, rem, awake }: NightStages): number | null {
  if (total <= 0) return null;
  const duration = total < 7 ? (50 * total) / 7 : total <= 9 ? 50 : Math.max(35, 50 - (total - 9) * 10);
  const awakeMin = awake * 60;
  const continuity = 20 * Math.max(0, 1 - awakeMin / 60);
  const hasStages = deep + rem > 0;
  if (!hasStages) return Math.round(((duration + continuity) / 70) * 100);
  const restoration = 30 * Math.min(1, (deep + rem) / total / 0.4);
  return Math.round(duration + restoration + continuity);
}

const sd = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};

/**
 * Schedule consistency, 0–100: 100 when bedtime and wake time never vary,
 * falling linearly to 0 at a 2-hour average standard deviation.
 */
export function consistencyScore(bedtimes: number[], wakeTimes: number[]): number | null {
  if (bedtimes.length < 3 || wakeTimes.length < 3) return null;
  const avgSd = (sd(bedtimes) + sd(wakeTimes)) / 2;
  return Math.max(0, Math.min(100, Math.round(100 - (avgSd / 120) * 100)));
}

const HOUR_MS = 3_600_000;

/** Heart rate is stored as hourly buckets (min/avg/max), so the dip is known to the hour. */
export interface HourlyHeartRate {
  /** Start of the hour. */
  hour: Date;
  min: number;
  /** The hour's average, used to break ties between equal minimums. */
  avg?: number | null;
}

export type DipHalf = "first" | "middle" | "second";

export interface HeartRateDip {
  /** Lowest heart rate during the night. */
  bpm: number;
  /** Start of the hour it fell in. */
  hour: Date;
  /** Where the dip's hour sits in the night: 0 = fell asleep, 1 = woke up (hour midpoint, clamped). */
  position: number;
  /**
   * First or second half of the night. An hour that straddles the midpoint is
   * "middle": hourly data can't tell which side the minimum fell on.
   */
  half: DipHalf;
}

/**
 * Sleeping heart-rate dip: the lowest hourly minimum between falling asleep
 * and waking up. Heart rate is whole numbers, so several hours often share the
 * minimum: the tie goes to the hour with the lowest average (where it stayed
 * low longest), then the earliest. Null without readings that night.
 */
export function heartRateDip(hours: HourlyHeartRate[], sleepStart: Date, sleepEnd: Date): HeartRateDip | null {
  const start = sleepStart.getTime();
  const end = sleepEnd.getTime();
  if (end <= start) return null;

  let best: HourlyHeartRate | null = null;
  for (const h of hours) {
    const t = h.hour.getTime();
    if (t >= end || t + HOUR_MS <= start) continue; // hour doesn't overlap the night
    if (!best || h.min < best.min) {
      best = h;
      continue;
    }
    if (h.min > best.min) continue;
    const [a, b] = [h.avg ?? Infinity, best.avg ?? Infinity];
    if (a < b || (a === b && t < best.hour.getTime())) best = h;
  }
  if (!best) return null;

  const from = best.hour.getTime();
  const mid = (start + end) / 2;
  const center = Math.min(end, Math.max(start, from + HOUR_MS / 2));
  return {
    bpm: best.min,
    hour: best.hour,
    position: (center - start) / (end - start),
    half: from + HOUR_MS <= mid ? "first" : from >= mid ? "second" : "middle",
  };
}
