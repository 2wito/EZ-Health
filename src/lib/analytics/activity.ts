// Workout & activity helpers.

/** km/h → "5:32" (min:sec per km) */
export function paceLabel(kmh: number | null): string | null {
  if (!kmh || kmh <= 0) return null;
  const secPerKm = Math.round(3600 / kmh);
  return `${Math.floor(secPerKm / 60)}:${String(secPerKm % 60).padStart(2, "0")}`;
}

/** Minutes per km, for averaging/trending pace. */
export const paceMinPerKm = (kmh: number) => 60 / kmh;

/**
 * Running efficiency: metres covered per heartbeat (speed ÷ heart rate).
 * Rises as aerobic fitness improves (faster at the same HR, or same pace at a lower HR).
 */
export function metresPerBeat(kmh: number | null, avgHr: number | null): number | null {
  if (!kmh || !avgHr) return null;
  return (kmh * 1000) / 60 / avgHr;
}

export const isRun = (name: string) => /\brun/i.test(name);

/** 18 → "6 PM" */
export const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;
