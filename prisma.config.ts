import "dotenv/config";
import { defineConfig } from "prisma/config";

// The CLI (migrate / studio) needs a direct, non-pooled connection.
// With Supabase that's the port-5432 URL; elsewhere DATABASE_URL is fine.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: process.env.DIRECT_URL || process.env.DATABASE_URL || "",
  },
});
