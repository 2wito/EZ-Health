import { describe, expect, it } from "vitest";
import { en } from "./en";
import { he } from "./he";

// Lookup tables that only some languages need (en shows names as recorded).
const OPEN_MAPS = new Set(["unitMap", "workoutNames"]);

type Entry = { path: string; value: unknown };

function walk(value: unknown, path = ""): Entry[] {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([k, v]) => (OPEN_MAPS.has(k) ? [] : walk(v, path ? `${path}.${k}` : k)));
  }
  return [{ path, value }];
}

describe("translations", () => {
  const enEntries = walk(en);
  const heEntries = walk(he);

  it("Hebrew has exactly the English keys", () => {
    expect(heEntries.map((e) => e.path).sort()).toEqual(enEntries.map((e) => e.path).sort());
  });

  it("matches the shape of every entry (string, list length, function)", () => {
    const heByPath = new Map(heEntries.map((e) => [e.path, e.value]));
    for (const { path, value } of enEntries) {
      const other = heByPath.get(path);
      const shape = (v: unknown) => (Array.isArray(v) ? `array:${v.length}` : typeof v);
      expect(shape(other), path).toBe(shape(value));
    }
  });

  it("has no empty strings", () => {
    for (const { path, value } of [...enEntries, ...heEntries]) {
      if (typeof value === "string") expect(value.trim(), path).not.toBe("");
      if (Array.isArray(value)) for (const s of value) expect(typeof s === "string" && s.length > 0, path).toBe(true);
    }
  });

  it("fills in values in Hebrew templates", () => {
    expect(he.trend.moved("ממוצע", "3 פעימות/דק׳", "גבוה", "30 ימים")).toBe("ממוצע, גבוה ב־3 פעימות/דק׳ לעומת התקופה הקודמת.");
    expect(he.activity.peakTimeValue("יום שני", "18:00")).toBe("ימי שני, 18:00");
    expect(he.readiness.notes.hrv(12, true)).toContain("נמוך ב־12%");
  });
});
