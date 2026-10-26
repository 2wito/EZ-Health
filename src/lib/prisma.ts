import { PrismaPg } from "@prisma/adapter-pg";
import { attachDatabasePool } from "@vercel/functions";
import { Pool } from "pg";
import { PrismaClient } from "@/generated/prisma/client";

// Reuse one client across hot reloads in dev so we don't exhaust connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Works with any Postgres, including Prisma Postgres over its direct TCP URL
// (postgres://…@db.prisma.io). The Vercel integration also adds a
// prisma+postgres:// Accelerate URL, which the pg adapter can't connect to.
function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  if (connectionString.startsWith("prisma+postgres://")) {
    throw new Error(
      "DATABASE_URL is a prisma+postgres:// Accelerate URL. Use the direct postgres:// connection string instead.",
    );
  }
  // Small pool: hosted Postgres roles cap connections (Prisma Postgres's is low),
  // and every serverless instance gets its own pool.
  const pool = new Pool({ connectionString, max: Number(process.env.DB_POOL_MAX) || 3, idleTimeoutMillis: 5_000 });
  // On Vercel, closes idle connections before an instance is suspended, so
  // frozen instances don't hold the role's connections. A no-op elsewhere.
  attachDatabasePool(pool);
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

function getClient() {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;
  const client = createClient();
  // Cached in production too: one client per server instance.
  globalForPrisma.prisma = client;
  return client;
}

// Created on first use, not on import: `next build` imports every route while
// collecting page data, and must not need DATABASE_URL to do that.
export const prisma = new Proxy({} as PrismaClient, {
  get(_, prop) {
    const client = getClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
