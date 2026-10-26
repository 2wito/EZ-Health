import { describe, expect, it } from "vitest";
import { clientIp, dailyLimit, visitorKey } from "./limit";

describe("dailyLimit", () => {
  it("defaults to 5 and reads COACH_DAILY_LIMIT", () => {
    expect(dailyLimit(undefined)).toBe(5);
    expect(dailyLimit("")).toBe(5);
    expect(dailyLimit("20")).toBe(20);
  });

  it("treats 0 as no limit and ignores nonsense", () => {
    expect(dailyLimit("0")).toBeNull();
    expect(dailyLimit("-3")).toBe(5);
    expect(dailyLimit("lots")).toBe(5);
    expect(dailyLimit("2.5")).toBe(5);
  });
});

describe("clientIp", () => {
  it("takes the client from x-forwarded-for, then x-real-ip", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(new Headers())).toBe("local");
  });
});

describe("visitorKey", () => {
  it("is stable within a day, changes the next day, and doesn't contain the IP", () => {
    const a = visitorKey("203.0.113.7", "2026-10-26", "salt");
    expect(visitorKey("203.0.113.7", "2026-10-26", "salt")).toBe(a);
    expect(visitorKey("203.0.113.7", "2026-10-27", "salt")).not.toBe(a);
    expect(visitorKey("203.0.113.8", "2026-10-26", "salt")).not.toBe(a);
    expect(visitorKey("203.0.113.7", "2026-10-26", "other")).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });
});
