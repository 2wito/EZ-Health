# EZ-Health — Apple Health Analytics

iOS-styled dashboard for Apple Health data pushed from the **Health Auto Export** app. See `CLAUDE.md` for the product spec.

## Setup

```bash
npm install                 # also runs `prisma generate`
cp .env.example .env        # then fill in DATABASE_URL + INGEST_API_KEY
docker compose up -d        # local Postgres (or point DATABASE_URL at Supabase)
npm run db:migrate          # create tables
npm run dev
npm run ingest:sample       # POST scripts/sample-payload.json to the local API
npm run demo:import         # optional: 120 days of realistic demo data to explore
npm run demo:clear          # remove it again (also a button on /upload)
```

## Importing your full history (export.zip)

On iPhone: Health → profile picture → **Export All Health Data**, then drop `export.zip` (or `export.xml`) on **/upload**.

- The upload streams to a temp file and is parsed in the background with a SAX parser (`saxes`), so memory stays flat regardless of file size; the page shows live progress.
- Heart rate, respiratory rate and SpO2 are rolled into hourly min/avg/max buckets; active/basal energy, steps and exercise minutes into hourly totals (per source). Resting HR, HRV and VO2 max, sleep segments, workouts and Activity ring totals are stored as-is.
- Re-importing is safe: everything is upserted.
- For very large exports you can skip the browser: `npm run import:export -- path/to/export.zip`
- Uploads go through the Node server, so this needs a long-running server (local / self-hosted). Serverless hosts cap request bodies (Vercel: 4.5 MB).

## Dashboards

| Page | What it shows |
| --- | --- |
| Summary | Readiness, sleep score and the latest reading of each metric |
| Heart & Breathing | Resting vs workout heart rate, HRV, respiratory rate; 7/30/90-day trend verdicts |
| Sleep & Recovery | Last night's stage timeline, bedtime/wake schedule, stages per night, sleep score, consistency |
| Workouts & Trends | Fitness & recovery trend evaluator (7/30/90 days), weekday × hour activity heatmap, workout comparison |
| AI Coach | Rule-based readiness + a chat coach (OpenAI or Gemini via the Vercel AI SDK) |

All scores are deterministic and documented where they're computed: `src/lib/analytics/` (`trend.ts`, `sleep.ts`, `readiness.ts`) and `src/lib/queries/evaluation.ts`. The coach receives a text summary built from the same numbers (`src/lib/coach/snapshot.ts`), never raw samples.

**No authentication yet.** Anyone who can reach the server can view the dashboards, upload data and use the coach (and your AI key). Keep it on localhost or behind a private network until auth is added.

## Connecting Health Auto Export (iOS)

Automations → New → **REST API**
- URL: `https://<your-host>/api/health-ingest`
- Format: **JSON**, Export version **2** (v1 also accepted)
- Headers: `x-api-key: <INGEST_API_KEY>`
- Metrics: Heart Rate, Resting Heart Rate, Heart Rate Variability, Respiratory Rate, Active Energy, Sleep Analysis (+ optional Steps, Exercise Time, VO2 Max, Blood Oxygen)
- Include **Workouts**
- Time grouping: **Hours** (gives the most/least active hours heatmap its data)
- Sleep: either aggregated or unaggregated works; **unaggregated** additionally stores stage segments for the sleep timeline.

The endpoint is idempotent: re-sent windows overwrite existing samples rather than duplicating them.

## Layout

| Path | Purpose |
| --- | --- |
| `prisma/schema.prisma` | `MetricSample`, `SleepSession`, `SleepStage`, `Workout`, `IngestLog` |
| `src/app/api/health-ingest/route.ts` | Webhook: auth, validation, logging |
| `src/lib/health-export/schema.ts` | Zod shapes of the HAE payload (v1 + v2) |
| `src/lib/health-export/normalize.ts` | Pure parsing: dates/timezones, units, sleep-night attribution |
| `src/lib/health-export/ingest.ts` | Webhook orchestration |
| `src/lib/health-export/store.ts` | Shared idempotent bulk writers (samples, sleep, workouts, daily activity) |
| `src/lib/apple-health/xml-parser.ts` | Streaming export.xml parser (pure, no I/O) |
| `src/lib/apple-health/import.ts` | ZIP/XML import job: unzip stream → parse → save, with progress |
| `src/app/api/upload-xml/` | Upload endpoint + job status for polling |
