#!/usr/bin/env bash
# Builds the ez-telemetry engine and verifies the result.
#
#   scripts/build.sh                 release build (-O3) in build/release
#   scripts/build.sh --debug         debug build in build/debug
#   scripts/build.sh --asan          AddressSanitizer + UBSan build in build/asan
#   scripts/build.sh --wasm          WebAssembly module for the browser → public/wasm/ez-telemetry.mjs
#   scripts/build.sh --clean         remove the build directory first
#   scripts/build.sh --werror        treat warnings as errors
#   scripts/build.sh --jobs 8        parallel compile jobs (default: all cores)
#   scripts/build.sh --no-verify     skip the tests and smoke run
#
# Uses CMake when it's installed. Without CMake it compiles the same sources
# with the same flags directly through $CXX (default g++), so the engine can be
# built on a machine that only has a compiler. --wasm needs the Emscripten SDK
# (em++ on the PATH); the module is committed, so the web app's build doesn't.
#
# Exit codes: 0 ok, 1 bad usage, 2 build failed, 3 verification failed.

set -euo pipefail

ENGINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$ENGINE_DIR/.." && pwd)"
CPP_DIR="$ENGINE_DIR/cpp"

mode="release"
clean=0
verify=1
werror=0
jobs="$( (command -v nproc >/dev/null && nproc) || sysctl -n hw.ncpu 2>/dev/null || echo 4)"

usage() { sed -n '2,19p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --release) mode="release" ;;
    --debug) mode="debug" ;;
    --asan) mode="asan" ;;
    --wasm) mode="wasm" ;;
    --clean) clean=1 ;;
    --werror) werror=1 ;;
    --no-verify) verify=0 ;;
    -j | --jobs)
      [[ $# -ge 2 && "$2" =~ ^[0-9]+$ ]] || { echo "build.sh: --jobs needs a number" >&2; exit 1; }
      jobs="$2"
      shift
      ;;
    -h | --help) usage; exit 0 ;;
    *) echo "build.sh: unknown option $1" >&2; usage >&2; exit 1 ;;
  esac
  shift
done

BUILD_DIR="$ENGINE_DIR/build/$mode"
BIN="$BUILD_DIR/ez-telemetry"
TESTS="$BUILD_DIR/engine_tests"

log() { printf '\033[1m[build]\033[0m %s\n' "$*"; }
fail() { printf '\033[31m[build] %s\033[0m\n' "$*" >&2; exit "${2:-2}"; }

if [[ $clean -eq 1 && -d "$BUILD_DIR" ]]; then
  log "removing $BUILD_DIR"
  rm -rf "$BUILD_DIR"
fi
mkdir -p "$BUILD_DIR"

started=$(date +%s)

# ─── WebAssembly ──────────────────────────────────────────────────────────────

if [[ "$mode" == wasm ]]; then
  WASM_OUT="$REPO_DIR/public/wasm/ez-telemetry.mjs"
  command -v em++ >/dev/null 2>&1 ||
    fail "em++ not found: install the Emscripten SDK and run 'source emsdk_env.sh' (see telemetry-engine/README.md)"
  log "compiling to WebAssembly with $(em++ --version | head -1)"
  mkdir -p "$(dirname "$WASM_OUT")"

  # One self-contained ES module (the .wasm is embedded), loadable in a browser
  # worker and in Node for the tests. Only the parser and the record encoders go
  # in: the aggregator's threads and the CLI's file mapping stay native.
  wasm_flags=(-std=c++20 -O3 -Wall -Wextra -Wpedantic -Wshadow -I"$CPP_DIR/include")
  [[ $werror -eq 1 ]] && wasm_flags+=(-Werror)
  em++ "${wasm_flags[@]}" \
    "$CPP_DIR/src/memory_pool.cpp" "$CPP_DIR/src/xml_parser.cpp" "$CPP_DIR/src/health_records.cpp" \
    "$CPP_DIR/src/record_json.cpp" "$CPP_DIR/src/wasm_api.cpp" \
    -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createEzTelemetry \
    -sENVIRONMENT=web,worker,node -sSINGLE_FILE=1 -sFILESYSTEM=0 \
    -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=32MB -sMAXIMUM_MEMORY=2GB \
    -sEXPORTED_FUNCTIONS=_ezt_create,_ezt_destroy,_ezt_input,_ezt_feed,_ezt_records_read,_ezt_finish,_ezt_count,_ezt_page,_ezt_output,_ezt_output_size \
    -sEXPORTED_RUNTIME_METHODS=HEAPU8 \
    -o "$WASM_OUT" || fail "WebAssembly build failed"
  log "wrote $WASM_OUT ($(( $(wc -c <"$WASM_OUT") / 1024 )) KB) in $(( $(date +%s) - started ))s"
  log "check it against the TypeScript parser with: npx vitest run src/lib/apple-health/wasm-engine.test.ts"
  exit 0
fi

# ─── Native ───────────────────────────────────────────────────────────────────

if command -v cmake >/dev/null 2>&1; then
  case "$mode" in
    release) build_type="Release"; sanitize="OFF" ;;
    debug) build_type="Debug"; sanitize="OFF" ;;
    asan) build_type="Debug"; sanitize="ON" ;;
  esac
  generator=()
  command -v ninja >/dev/null 2>&1 && generator=(-G Ninja)
  log "configuring ($build_type, sanitizers $sanitize) with $(cmake --version | head -1)"
  cmake -S "$CPP_DIR" -B "$BUILD_DIR" ${generator[@]+"${generator[@]}"} \
    -DCMAKE_BUILD_TYPE="$build_type" \
    -DEZT_SANITIZE="$sanitize" \
    -DEZT_WERROR="$([[ $werror -eq 1 ]] && echo ON || echo OFF)" >/dev/null ||
    fail "cmake configure failed"
  log "compiling with $jobs jobs"
  cmake --build "$BUILD_DIR" --parallel "$jobs" || fail "compile failed"
else
  CXX="${CXX:-g++}"
  command -v "$CXX" >/dev/null 2>&1 || fail "neither cmake nor $CXX is installed"
  log "cmake not found; compiling directly with $($CXX --version | head -1)"

  flags=(-std=c++20 -Wall -Wextra -Wpedantic -Wshadow -pthread -I"$CPP_DIR/include")
  case "$mode" in
    release) flags+=(-O3 -DNDEBUG) ;;
    debug) flags+=(-O0 -g) ;;
    asan) flags+=(-O1 -g -fsanitize=address,undefined -fno-omit-frame-pointer) ;;
  esac
  [[ $werror -eq 1 ]] && flags+=(-Werror)

  # Compile each source to an object in parallel, then link both executables.
  objects=()
  pids=()
  for src in "$CPP_DIR"/src/*.cpp; do
    name="$(basename "$src" .cpp)"
    obj="$BUILD_DIR/$name.o"
    objects+=("$obj")
    "$CXX" "${flags[@]}" -c "$src" -o "$obj" &
    pids+=($!)
    if [[ ${#pids[@]} -ge $jobs ]]; then
      wait "${pids[0]}" || fail "compile failed ($src)"
      pids=("${pids[@]:1}")
    fi
  done
  for pid in "${pids[@]}"; do wait "$pid" || fail "compile failed"; done

  core=()
  for obj in "${objects[@]}"; do [[ "$(basename "$obj")" == "main.o" ]] || core+=("$obj"); done
  "$CXX" "${flags[@]}" "${objects[@]}" -o "$BIN" || fail "link failed (ez-telemetry)"
  "$CXX" "${flags[@]}" "$CPP_DIR/tests/engine_tests.cpp" "${core[@]}" -o "$TESTS" || fail "link failed (engine_tests)"
fi

[[ -x "$BIN" ]] || fail "expected binary missing: $BIN"
log "built $BIN in $(( $(date +%s) - started ))s"

if [[ $verify -eq 0 ]]; then
  exit 0
fi

# ─── Verification ─────────────────────────────────────────────────────────────

log "verifying"
version="$("$BIN" --version)" || fail "$BIN --version failed" 3
log "  $version"

if [[ -x "$TESTS" ]]; then
  "$TESTS" "$REPO_DIR/scripts/sample-export.xml" || fail "unit tests failed" 3
fi

sample="$REPO_DIR/scripts/sample-export.xml"
if [[ -f "$sample" ]]; then
  out="$("$BIN" --format json "$sample")" || fail "smoke run on $sample exited with $?" 3
  records=$(grep -cE '^\{"kind":"(samples|sleepStages|workouts|activity)"' <<<"$out" || true)
  summary=$(grep -c '"kind":"summary"' <<<"$out" || true)
  [[ "$records" -gt 0 && "$summary" -eq 1 ]] || fail "smoke run produced $records records and $summary summaries" 3
  log "  smoke run: $records records from $(basename "$sample")"

  set +e
  "$BIN" "$CPP_DIR/CMakeLists.txt" >/dev/null 2>&1
  code=$?
  set -e
  [[ $code -eq 3 ]] || fail "a non-Health file should exit 3, got $code" 3
  log "  rejects non-Health input (exit 3)"
fi

log "ok"
