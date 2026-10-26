import "dotenv/config";
import { defineConfig } from "prisma/config";

// The CLI (migrate / studio) needs a direct, non-pooled connection.
// Prisma Postgres and plain Postgres: DATABASE_URL is already direct.
// Supabase: set DIRECT_URL to the port-5432 URL.
// `prisma generate` never connects, so an empty URL is fine at build time.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: process.env.DIRECT_URL || process.env.DATABASE_URL || "",
  },
});
