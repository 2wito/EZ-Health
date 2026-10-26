// POSTs scripts/sample-payload.json to a running dev server.
// Usage: npm run ingest:sample [-- http://localhost:3000]
import "dotenv/config";
import { readFileSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3000";
const body = readFileSync(new URL("./sample-payload.json", import.meta.url), "utf8");

const res = await fetch(`${base}/api/health-ingest`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-api-key": process.env.INGEST_API_KEY ?? "" },
  body,
});
console.log(res.status, JSON.stringify(await res.json(), null, 2));
