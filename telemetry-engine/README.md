# EZ Health Telemetry Engine

A native C++20 processor for Apple Health `export.xml`, plus Python and Bash tooling around it. It produces the same records as the web importer (`src/lib/apple-health/xml-parser.ts`), sends them to the app through its existing import API, and computes rolling HRV and resting-heart-rate trends and sleep-stage transitions.

On a synthetic 2-million-record export (361 MB), a full parse plus JSON output takes about 0.3 s (around 7 million records/s) with peak memory near 75 MB. The CLI importer in `scripts/import-export.mts` needs about 58 s for 1.38 million records.

```
telemetry-engine/
├── cpp/
│   ├── CMakeLists.txt
│   ├── include/  memory_pool.hpp  xml_parser.hpp  health_records.hpp  aggregator.hpp  output.hpp
│   ├── src/      memory_pool.cpp  xml_parser.cpp  health_records.cpp  aggregator.cpp  output.cpp  main.cpp
│   └── tests/    engine_tests.cpp
├── python/
│   ├── pipeline.py            # engine → batches → /api/import
│   └── telemetry_profiler.py  # latency / CPU / memory, ASan, Valgrind
└── scripts/
    ├── build.sh               # CMake (or plain g++) build + verification
    └── stress_test.sh         # synthetic multi-million-row benchmark
```

## Quick start

Linux, macOS or WSL, with g++ 11+ or clang 14+, and Python 3.10+. CMake 3.20+ is optional.

```bash
cd telemetry-engine
scripts/build.sh                                   # → build/release/ez-telemetry, runs the tests
build/release/ez-telemetry --format summary ../scripts/sample-export.xml
python3 python/pipeline.py analyze path/to/export.zip
python3 python/pipeline.py import  path/to/export.zip --api-url http://localhost:3000
```

## How it works

| Part | What it does |
| --- | --- |
| `xml_parser` | Memory-maps the file and scans it once. Element names and attribute values are `string_view`s into the mapping, so nothing is copied and no DOM is built. It skips the DOCTYPE internal subset, comments, CDATA and processing instructions, and recovers from malformed tags. Pages already parsed are released every 64 MB (`MADV_DONTNEED`), so resident memory stays flat however large the file is. |
| `memory_pool` | Fixed-block pool with O(1) allocation and deallocation: an intrusive free list plus a bump pointer, with memory taken from the system a chunk at a time. `PoolResource` exposes it as a `std::pmr::memory_resource`. The hourly-aggregation hash map gets its nodes from the pool, about 31,500 node allocations per million records and none of them through `malloc`. |
| `health_records` | Maps HealthKit records exactly as the web importer does. Heart rate, respiratory rate and SpO2 become hourly min/avg/max per source; energy, steps and exercise become hourly totals; HRV, resting HR, walking HR and VO2 max are kept per reading. Sleep segments are attributed to the night you woke up, and `<ActivitySummary>` rows are kept. Dates keep their original UTC offset. |
| `aggregator` | Per-day HRV and resting-HR means with a trailing N-day average and a 60-day baseline (mean and SD). For each night it picks the best-measured source, then builds a from→to sleep-stage transition matrix and counts awakenings. Work is split across `std::jthread`s that each fill their own partial result, so the hot loops take no locks. |
| `output` | `json`: NDJSON records shaped exactly like the `/api/import/:id/batch` schema, followed by a summary line. `binary`: compact little-endian frames (format in `output.hpp`). `summary`: the analytics only. |

The engine was checked against the TypeScript parser: on the project's 120-day demo export (`npm run demo:export`), all 12,829 records, the counters and the date range are identical.

## CLI

```
ez-telemetry [options] <export.xml>
  -f, --format json|binary|summary   -o, --output PATH   -t, --threads N
  -w, --window DAYS (7)   --baseline DAYS (60)   --max-errors N   -v, --verbose
Exit: 0 ok · 1 usage · 2 I/O · 3 not an Apple Health export · 4 internal
```

## Pipeline → EZ Health

`pipeline.py import` follows the same protocol as the browser importer:

1. `POST /api/import` opens the job.
2. Records go to `/api/import/:id/batch` in batches of up to 5,000 records and 3 MB.
3. `/api/import/:id/finish` closes the job.

Server errors are retried with backoff. Because the server upserts, a retried batch never duplicates data.

The pipeline writes through the API rather than straight into Postgres on purpose. The API already owns zod validation, the bulk upserts and the sleep-night rebuild, so the dashboards always see data in the shape they expect.

`--dry-run` parses and batches without uploading, and `--wire binary` reads the binary format instead of NDJSON. Note that the import routes have no authentication yet (see the main README), so only point `--api-url` at a deployment you mean to write to.

## Diagnostics

```bash
scripts/build.sh --asan                                     # AddressSanitizer + UBSan build
python3 python/telemetry_profiler.py all export.xml --report report.json
scripts/stress_test.sh --rows 5000000 --runs 3              # results → logs/stress_results.csv
```

## Limitations

- **Workouts** are counted (and included in the date range) but not converted yet. Import `export.zip` on `/upload` as well to include them; re-importing is safe.
- **Parsing is single-threaded** because it's one sequential scan. Threads speed up the aggregation stage only, and at this data size that stage takes a few milliseconds.
- **Windows:** the code has an untested `MapViewOfFile` path and is not wired into CI. Build and run it under WSL.
