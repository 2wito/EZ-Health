import "server-only";
import { createHash } from "node:crypto";
import { isoDay } from "@/lib/analytics/range";
import { prisma } from "@/lib/prisma";

// Daily cap on coach questions per visitor, so a public demo with an AI key
// can't be used to run up the bill. Counted in Postgres because serverless
// instances don't share memory. Days are UTC.

const DEFAULT_LIMIT = 5;

/** COACH_DAILY_LIMIT: questions per visitor per day; 0 turns the limit off. */
export function dailyLimit(raw = process.env.COACH_DAILY_LIMIT): number | null {
  if (raw === undefined || raw.trim() === "") return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return DEFAULT_LIMIT;
  return n === 0 ? null : n;
}

/** The caller's IP as the host reports it (Vercel sets x-forwarded-for; first entry is the client). */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "local";
}

/** Salted hash of IP + day: enough to count, useless for tracking. */
export function visitorKey(ip: string, day: string, salt = process.env.COACH_LIMIT_SALT || process.env.INGEST_API_KEY || "ez-health") {
  return createHash("sha256").update(`${salt}|${ip}|${day}`).digest("hex").slice(0, 32);
}

export interface Allowance {
  limit: number;
  remaining: number;
}

const today = () => isoDay(new Date());

/** How many questions this visitor has left today; null when there's no limit. */
export async function getAllowance(headers: Headers): Promise<Allowance | null> {
  const limit = dailyLimit();
  if (limit === null) return null;
  const day = today();
  const row = await prisma.coachUsage.findUnique({
    where: { visitor_day: { visitor: visitorKey(clientIp(headers), day), day: new Date(`${day}T00:00:00Z`) } },
    select: { count: true },
  });
  return { limit, remaining: Math.max(0, limit - (row?.count ?? 0)) };
}

/**
 * Uses one question. Atomic: the row only increments while under the limit,
 * so parallel requests can't overshoot it. Returns null when there's no limit.
 */
export async function consumeQuestion(headers: Headers): Promise<(Allowance & { allowed: boolean }) | null> {
  const limit = dailyLimit();
  if (limit === null) return null;
  const day = today();
  const visitor = visitorKey(clientIp(headers), day);

  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "CoachUsage" ("visitor", "day", "count") VALUES (${visitor}, ${day}::date, 1)
    ON CONFLICT ("visitor", "day") DO UPDATE SET "count" = "CoachUsage"."count" + 1
    WHERE "CoachUsage"."count" < ${limit}
    RETURNING "count"`;
  const count = rows[0]?.count;
  if (count === undefined) return { allowed: false, limit, remaining: 0 };

  // A visitor's first question of the day tidies up rows nobody needs any more.
  if (count === 1) await prisma.$executeRaw`DELETE FROM "CoachUsage" WHERE "day" < ${day}::date - 2`;
  return { allowed: true, limit, remaining: limit - count };
}
