#!/usr/bin/env bash
# Builds the ez-telemetry engine and verifies the result.
#
#   scripts/build.sh                 release build (-O3) in build/release
#   scripts/build.sh --debug         debug build in build/debug
#   scripts/build.sh --asan          AddressSanitizer + UBSan build in build/asan
#   scripts/build.sh --clean         remove the build directory first
#   scripts/build.sh --werror        treat warnings as errors
#   scripts/build.sh --jobs 8        parallel compile jobs (default: all cores)
#   scripts/build.sh --no-verify     skip the tests and smoke run
#
# Uses CMake when it's installed. Without CMake it compiles the same sources
# with the same flags directly through $CXX (default g++), so the engine can be
# built on a machine that only has a compiler.
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

usage() { sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --release) mode="release" ;;
    --debug) mode="debug" ;;
    --asan) mode="asan" ;;
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
  "$TESTS" || fail "unit tests failed" 3
fi

sample="$REPO_DIR/scripts/sample-export.xml"
if [[ -f "$sample" ]]; then
  out="$("$BIN" --format json "$sample")" || fail "smoke run on $sample exited with $?" 3
  records=$(grep -c '"kind":"samples"\|"kind":"sleepStages"\|"kind":"activity"' <<<"$out" || true)
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
