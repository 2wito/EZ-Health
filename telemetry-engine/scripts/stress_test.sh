#!/usr/bin/env bash
# Generates a synthetic multi-million-row Apple Health export and benchmarks
# the engine on it.
#
#   scripts/stress_test.sh                        2,000,000 rows, 3 runs per format
#   scripts/stress_test.sh --rows 10000000        bigger dataset
#   scripts/stress_test.sh --runs 5 --formats "summary json"
#   scripts/stress_test.sh --threads 4            pass --threads to the engine
#   scripts/stress_test.sh --binary build/asan/ez-telemetry
#   scripts/stress_test.sh --keep-data            keep the generated export.xml
#
# The dataset imitates a watch wearer: heart rate every minute, active energy
# every 5 minutes, steps every 10, HRV hourly, resting HR daily, and a night of
# sleep stages, with a few hundred thousand irrelevant records mixed in. Every
# run's exit code, wall time, peak memory and throughput is appended to
# logs/stress_results.csv; the full output goes to logs/stress-<timestamp>.log.
#
# Exit codes: 0 all runs passed, 1 bad usage, 2 missing binary, 3 a run failed.

set -euo pipefail

ENGINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rows=2000000
runs=3
formats="summary binary json"
threads=""
binary="$ENGINE_DIR/build/release/ez-telemetry"
keep=0
data_dir="${TMPDIR:-/tmp}/ez-telemetry-stress"

usage() { sed -n '2,19p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }
need_value() { [[ $# -ge 2 && -n "$2" ]] || { echo "stress_test.sh: $1 needs a value" >&2; exit 1; }; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rows) need_value "$@"; rows="$2"; shift ;;
    --runs) need_value "$@"; runs="$2"; shift ;;
    --formats) need_value "$@"; formats="$2"; shift ;;
    --threads) need_value "$@"; threads="$2"; shift ;;
    --binary) need_value "$@"; binary="$2"; shift ;;
    --data-dir) need_value "$@"; data_dir="$2"; shift ;;
    --keep-data) keep=1 ;;
    -h | --help) usage; exit 0 ;;
    *) echo "stress_test.sh: unknown option $1" >&2; usage >&2; exit 1 ;;
  esac
  shift
done

[[ "$rows" =~ ^[0-9]+$ && "$rows" -gt 0 ]] || { echo "stress_test.sh: --rows must be a positive number" >&2; exit 1; }
[[ "$runs" =~ ^[0-9]+$ && "$runs" -gt 0 ]] || { echo "stress_test.sh: --runs must be a positive number" >&2; exit 1; }
for f in $formats; do
  [[ "$f" == summary || "$f" == json || "$f" == binary ]] || { echo "stress_test.sh: unknown format $f" >&2; exit 1; }
done
[[ -x "$binary" ]] || { echo "stress_test.sh: $binary not found; run scripts/build.sh first" >&2; exit 2; }

LOG_DIR="$ENGINE_DIR/logs"
mkdir -p "$LOG_DIR" "$data_dir"
stamp="$(date +%Y%m%d-%H%M%S)"
LOG="$LOG_DIR/stress-$stamp.log"
CSV="$LOG_DIR/stress_results.csv"
DATA="$data_dir/export-$rows.xml"
[[ -f "$CSV" ]] || echo "timestamp,rows,format,run,exit_code,wall_ms,max_rss_kb,input_mb,output_mb,rows_per_sec,mb_per_sec" >"$CSV"

log() { printf '[stress] %s\n' "$*" | tee -a "$LOG"; }
# GNU date has %N; BSD/macOS date doesn't, so fall back to python3 there.
if [[ "$(date +%3N)" =~ ^[0-9]+$ ]]; then
  now_ms() { date +%s%3N; }
else
  now_ms() { python3 -c 'import time; print(int(time.time() * 1000))'; }
fi

cleanup() { [[ $keep -eq 1 ]] || rm -f "$DATA"; }
trap cleanup EXIT

# ─── Dataset ──────────────────────────────────────────────────────────────────

if [[ -f "$DATA" ]]; then
  log "reusing $DATA"
else
  log "generating $rows rows into $DATA"
  t0=$(now_ms)
  # awk only: date formatting uses the civil-from-days algorithm, so this works
  # with mawk / BSD awk (no strftime needed).
  awk -v rows="$rows" -v seed=42 '
    function civil(days,    z, era, doe, yoe, y, doy, mp, d, m) {
      z = days + 719468
      era = int(z / 146097)
      doe = z - era * 146097
      yoe = int((doe - int(doe / 1460) + int(doe / 36524) - int(doe / 146096)) / 365)
      y = yoe + era * 400
      doy = doe - (365 * yoe + int(yoe / 4) - int(yoe / 100))
      mp = int((5 * doy + 2) / 153)
      d = doy - int((153 * mp + 2) / 5) + 1
      m = mp < 10 ? mp + 3 : mp - 9
      return sprintf("%04d-%02d-%02d", y + (m <= 2), m, d)
    }
    # Local time in +0300, minutes since the start day.
    function stamp(minute,    day, mod) {
      day = int(minute / 1440)
      mod = minute - day * 1440
      return sprintf("%s %02d:%02d:00 +0300", civil(start_day + day), int(mod / 60), mod % 60)
    }
    function rec(type, unit, minute, value, src) {
      printf " <Record type=\"%s\" sourceName=\"%s\" unit=\"%s\" startDate=\"%s\" endDate=\"%s\" value=\"%s\"/>\n", \
        type, src, unit, stamp(minute), stamp(minute + 1), value
      written++
    }
    function sleep_seg(stage, a, b) {
      printf " <Record type=\"HKCategoryTypeIdentifierSleepAnalysis\" sourceName=\"Stress Watch\" startDate=\"%s\" endDate=\"%s\" value=\"HKCategoryValueSleepAnalysis%s\"/>\n", \
        stamp(a), stamp(b), stage
      written++
    }
    BEGIN {
      srand(seed)
      start_day = 19723  # 2024-01-01
      split("AsleepCore AsleepDeep AsleepCore AsleepREM Awake AsleepCore AsleepREM", cycle, " ")
      print "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
      print "<!DOCTYPE HealthData [\n<!ELEMENT HealthData (Record)*>\n]>"
      print "<HealthData locale=\"en_IL\">"
      written = 0
      for (minute = 0; written < rows; minute++) {
        mod = minute % 1440
        asleep = mod < 420  # 00:00-07:00
        hr = asleep ? 52 + int(rand() * 8) : 65 + int(rand() * 40)
        rec("HKQuantityTypeIdentifierHeartRate", "count/min", minute, hr, "Stress Watch")
        if (minute % 5 == 0) rec("HKQuantityTypeIdentifierActiveEnergyBurned", "Cal", minute, sprintf("%.2f", asleep ? 0.1 : rand() * 6), "Stress Watch")
        if (minute % 10 == 0 && !asleep) rec("HKQuantityTypeIdentifierStepCount", "count", minute, int(rand() * 900), "Stress iPhone")
        if (minute % 7 == 0) rec("HKQuantityTypeIdentifierDietaryWater", "mL", minute, 250, "Stress iPhone")  # skipped type
        if (mod == 180 || mod % 120 == 60) rec("HKQuantityTypeIdentifierHeartRateVariabilitySDNN", "ms", minute, sprintf("%.1f", 35 + rand() * 30), "Stress Watch")
        if (mod == 600) rec("HKQuantityTypeIdentifierRestingHeartRate", "count/min", minute, 50 + int(rand() * 8), "Stress Watch")
        if (mod == 0) {
          # A night: 7 h in 30-minute stage segments.
          for (s = 0; s < 14; s++) sleep_seg(cycle[(s % 7) + 1], minute + s * 30, minute + s * 30 + 30)
        }
      }
      print "</HealthData>"
    }' >"$DATA"
  log "generated $(du -h "$DATA" | cut -f1) in $(( $(now_ms) - t0 )) ms"
fi

input_bytes=$(wc -c <"$DATA")
input_mb=$(awk -v b="$input_bytes" 'BEGIN { printf "%.1f", b / 1e6 }')

# ─── Benchmark ────────────────────────────────────────────────────────────────

time_cmd=()
if /usr/bin/time -f '%M' true >/dev/null 2>&1; then
  time_cmd=(/usr/bin/time -f '%M' -o "$data_dir/rss.txt")
else
  log "GNU time not found: peak memory won't be recorded"
fi

extra=()
[[ -n "$threads" ]] && extra=(--threads "$threads")
failures=0

# Did the run end with its summary? (The summary can be hundreds of KB on long
# histories, so look at where it starts, not at a fixed-size tail.) No pipes:
# under pipefail, `grep -q` closing a pipe early would read as a failure.
summary_ok() {
  local text
  case "$1" in
    summary)
      text="$(head -c 4096 "$2")"
      [[ "$text" == '{"engine":"ez-telemetry"'*'"recordsRead"'* ]]
      ;;
    json)
      text="$(tail -n 1 "$2")"
      [[ "$text" == '{"kind":"summary","summary":{"engine":"ez-telemetry"'* ]]
      ;;
    binary)
      text="$(head -c 4 "$2")"
      [[ "$text" == "EZTB" ]] && LC_ALL=C grep -aq '"engine":"ez-telemetry"' "$2"
      ;;
  esac
}

log "binary: $binary ($("$binary" --version))"
log "input:  $input_mb MB, $rows rows"
printf '[stress] %-8s %-4s %-5s %9s %10s %10s %13s %8s\n' format run exit wall_ms rss_kb out_mb rows/s MB/s | tee -a "$LOG"

for format in $formats; do
  for run in $(seq 1 "$runs"); do
    out="$data_dir/out.$format"
    rm -f "$data_dir/rss.txt"
    t0=$(now_ms)
    set +e
    # ${a[@]+"${a[@]}"}: expands an empty array safely under set -u in bash 3.2 (macOS) too.
    ${time_cmd[@]+"${time_cmd[@]}"} "$binary" --format "$format" ${extra[@]+"${extra[@]}"} --output "$out" "$DATA" 2>>"$LOG"
    code=$?
    set -e
    wall=$(( $(now_ms) - t0 ))
    [[ $wall -gt 0 ]] || wall=1
    rss=$(tail -1 "$data_dir/rss.txt" 2>/dev/null || echo "")
    out_mb=$(awk -v b="$(wc -c <"$out" 2>/dev/null || echo 0)" 'BEGIN { printf "%.1f", b / 1e6 }')
    rps=$(awk -v r="$rows" -v w="$wall" 'BEGIN { printf "%.0f", r / (w / 1000) }')
    mbps=$(awk -v b="$input_bytes" -v w="$wall" 'BEGIN { printf "%.1f", b / 1e6 / (w / 1000) }')

    status="ok"
    if [[ $code -ne 0 ]]; then
      status="FAILED"
      failures=$((failures + 1))
    elif ! summary_ok "$format" "$out"; then
      status="NO-SUMMARY"
      failures=$((failures + 1))
    fi

    printf '[stress] %-8s %-4s %-5s %9s %10s %10s %13s %8s %s\n' \
      "$format" "$run" "$code" "$wall" "${rss:--}" "$out_mb" "$rps" "$mbps" "$([[ $status == ok ]] || echo "$status")" | tee -a "$LOG"
    echo "$stamp,$rows,$format,$run,$code,$wall,${rss},$input_mb,$out_mb,$rps,$mbps" >>"$CSV"
    rm -f "$out"
  done
done

log "results appended to $CSV"
if [[ $failures -gt 0 ]]; then
  log "$failures run(s) failed; see $LOG"
  exit 3
fi
log "all runs passed"
