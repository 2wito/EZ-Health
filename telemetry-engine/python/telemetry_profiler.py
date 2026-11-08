#!/usr/bin/env python3
"""Performance and memory-safety diagnostics for the ez-telemetry engine.

    python telemetry_profiler.py profile  export.xml --runs 5        # latency, CPU, memory
    python telemetry_profiler.py asan     export.xml --build         # AddressSanitizer + LeakSanitizer + UBSan
    python telemetry_profiler.py valgrind export.xml                 # Valgrind memcheck (slow: use a small file)
    python telemetry_profiler.py all      export.xml --report out.json

profile   Runs the release binary several times. While each run is in progress
          its resident memory and CPU time are sampled from /proc (Linux); when
          it exits, wait4() supplies the exact user/system CPU time and peak RSS.
          Reports min / median / p95 / max latency, records per second, MB/s,
          CPU utilisation (above 100 % means several cores were busy) and peak
          memory.
asan      Runs the sanitizer build (scripts/build.sh --asan, or --build to make
          it) and fails on any AddressSanitizer, LeakSanitizer or UBSan report.
valgrind  Runs memcheck on the release binary and fails on memory errors or
          definitely/indirectly lost blocks. Skipped when valgrind isn't installed.

Accepts export.xml or export.zip. Linux gives the full picture; macOS has no
/proc sampling, and Windows reports wall time only. Standard library only.

Exit codes: 0 all checks passed (or were skipped), 1 usage, 2 a check failed.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import statistics
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pipeline import ENGINE_DIR, EXE, PipelineError, prepare_input  # noqa: E402

RELEASE_BIN = ENGINE_DIR / "build" / "release" / EXE
ASAN_BIN = ENGINE_DIR / "build" / "asan" / EXE
BUILD_SCRIPT = ENGINE_DIR / "scripts" / "build.sh"
PAGE_KB = (os.sysconf("SC_PAGE_SIZE") // 1024) if hasattr(os, "sysconf") else 4


def log(message: str) -> None:
    print(f"[profiler] {message}", file=sys.stderr, flush=True)


# ─── Profiling ────────────────────────────────────────────────────────────────


@dataclass
class RunSample:
    wall_ms: float
    exit_code: int
    user_s: float | None = None
    sys_s: float | None = None
    peak_rss_kb: int | None = None
    rss_timeline_kb: list[int] = field(default_factory=list)

    @property
    def cpu_percent(self) -> float | None:
        if self.user_s is None or self.sys_s is None or self.wall_ms <= 0:
            return None
        return 100.0 * (self.user_s + self.sys_s) / (self.wall_ms / 1000)


class ProcSampler(threading.Thread):
    """Samples a process's resident memory from /proc/<pid>/statm."""

    def __init__(self, pid: int, interval: float):
        super().__init__(daemon=True)
        self.path = Path(f"/proc/{pid}/statm")
        self.interval = interval
        self.samples: list[int] = []
        self._done = threading.Event()

    def run(self) -> None:
        while not self._done.is_set():
            try:
                resident_pages = int(self.path.read_text().split()[1])
                self.samples.append(resident_pages * PAGE_KB)
            except (OSError, ValueError, IndexError):
                return  # process gone, or no /proc
            self._done.wait(self.interval)

    def stop(self) -> None:
        self._done.set()
        self.join()


def run_once(cmd: list[str], interval: float) -> RunSample:
    # stderr goes to a file, not a pipe: nobody reads a pipe until the process
    # exits, so a chatty process would fill it and block forever.
    with tempfile.TemporaryFile() as err:
        started = time.perf_counter()
        proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=err)
        sampler = ProcSampler(proc.pid, interval) if Path("/proc").is_dir() else None
        if sampler:
            sampler.start()

        if hasattr(os, "wait4"):
            _, status, usage = os.wait4(proc.pid, 0)
            wall_ms = (time.perf_counter() - started) * 1000
            proc.returncode = os.waitstatus_to_exitcode(status)
            # ru_maxrss is KB on Linux, bytes on macOS.
            peak = usage.ru_maxrss // 1024 if sys.platform == "darwin" else usage.ru_maxrss
            sample = RunSample(wall_ms, proc.returncode, usage.ru_utime, usage.ru_stime, int(peak))
        else:
            proc.wait()
            wall_ms = (time.perf_counter() - started) * 1000
            sample = RunSample(wall_ms, proc.returncode)

        if sampler:
            sampler.stop()
            sample.rss_timeline_kb = sampler.samples
        err.seek(0)
        stderr = err.read().decode("utf-8", "replace")
    if sample.exit_code != 0:
        log(f"run exited with {sample.exit_code}: {stderr.strip()[:300]}")
    return sample


def percentile(values: list[float], p: float) -> float:
    ordered = sorted(values)
    k = (len(ordered) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(ordered) - 1)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo)


def profile(binary: Path, xml: Path, runs: int, fmt: str, threads: int | None, interval: float, warmup: bool) -> dict:
    if not binary.is_file():
        raise PipelineError(f"{binary} not found; run scripts/build.sh", 1)
    summary_cmd = [str(binary), "--format", "summary", str(xml)]
    summary = json.loads(subprocess.run(summary_cmd, capture_output=True, check=True).stdout)
    records, size_mb = summary["recordsRead"], summary["bytes"] / 1e6

    cmd = [str(binary), "--format", fmt] + (["--threads", str(threads)] if threads else []) + [str(xml)]
    if warmup:
        run_once(cmd, interval)  # fills the page cache so run 1 isn't an outlier
    samples = []
    for i in range(1, runs + 1):
        s = run_once(cmd, interval)
        samples.append(s)
        cpu = f"{s.cpu_percent:.0f}%" if s.cpu_percent is not None else "n/a"
        rss = f"{s.peak_rss_kb / 1024:.1f} MB" if s.peak_rss_kb else "n/a"
        log(f"run {i}/{runs}: {s.wall_ms:8.1f} ms  exit {s.exit_code}  cpu {cpu}  peak rss {rss}")

    ok = [s for s in samples if s.exit_code == 0]
    lat = [s.wall_ms for s in ok]
    result: dict = {
        "command": cmd,
        "input": {"path": str(xml), "mb": round(size_mb, 1), "records": records},
        "runs": runs,
        "failures": len(samples) - len(ok),
        "passed": len(ok) == len(samples),
    }
    if lat:
        median = statistics.median(lat)
        result["latency_ms"] = {
            "min": round(min(lat), 1), "median": round(median, 1),
            "p95": round(percentile(lat, 0.95), 1), "max": round(max(lat), 1),
            "stdev": round(statistics.stdev(lat), 1) if len(lat) > 1 else 0.0,
        }
        result["throughput"] = {
            "records_per_sec": round(records / (median / 1000)),
            "mb_per_sec": round(size_mb / (median / 1000), 1),
        }
        cpu = [s.cpu_percent for s in ok if s.cpu_percent is not None]
        if cpu:
            result["cpu_percent_median"] = round(statistics.median(cpu), 1)
        peaks = [s.peak_rss_kb for s in ok if s.peak_rss_kb]
        if peaks:
            result["peak_rss_mb"] = round(max(peaks) / 1024, 1)
        timeline = max((s.rss_timeline_kb for s in ok), key=len, default=[])
        if timeline:
            result["rss_samples"] = len(timeline)
            result["rss_mb_by_quartile"] = [
                round(timeline[min(len(timeline) - 1, int(q * (len(timeline) - 1)))] / 1024, 1)
                for q in (0, 0.25, 0.5, 0.75, 1)
            ]
    result["engine_pool"] = summary.get("memoryPool")
    return result


# ─── Sanitizers ───────────────────────────────────────────────────────────────

SANITIZER_PATTERNS = re.compile(r"ERROR: (AddressSanitizer|LeakSanitizer)|runtime error:|SUMMARY: UndefinedBehaviorSanitizer")


def asan(xml: Path, build: bool) -> dict:
    if not ASAN_BIN.is_file():
        if not build:
            return {"status": "skipped", "reason": f"{ASAN_BIN} missing; pass --build or run scripts/build.sh --asan"}
        if not shutil.which("bash"):
            return {"status": "skipped", "reason": "bash is needed to run scripts/build.sh"}
        log("building the sanitizer binary")
        subprocess.run(["bash", str(BUILD_SCRIPT), "--asan", "--no-verify"], check=True)

    env = dict(os.environ)
    env["ASAN_OPTIONS"] = "detect_leaks=1:halt_on_error=1:strict_string_checks=1:detect_stack_use_after_return=1"
    env["UBSAN_OPTIONS"] = "print_stacktrace=1:halt_on_error=1"
    results = {}
    # Every output path, so the encoders are covered as well as the parser.
    for fmt in ("summary", "json", "binary"):
        started = time.perf_counter()
        proc = subprocess.run([str(ASAN_BIN), "--format", fmt, str(xml)], stdout=subprocess.DEVNULL,
                              stderr=subprocess.PIPE, env=env)
        stderr = proc.stderr.decode("utf-8", "replace")
        findings = SANITIZER_PATTERNS.findall(stderr)
        results[fmt] = {
            "exit_code": proc.returncode,
            "seconds": round(time.perf_counter() - started, 2),
            "findings": len(findings),
            "report": stderr[-2000:] if findings or proc.returncode else "",
        }
        log(f"asan {fmt}: exit {proc.returncode}, {len(findings)} sanitizer report(s)")
    passed = all(r["exit_code"] == 0 and r["findings"] == 0 for r in results.values())
    return {"status": "passed" if passed else "failed", "binary": str(ASAN_BIN), "runs": results}


def valgrind(xml: Path, threads: int | None) -> dict:
    tool = shutil.which("valgrind")
    if not tool:
        return {"status": "skipped", "reason": "valgrind is not installed (Debian/Ubuntu: sudo apt install valgrind)"}
    if not RELEASE_BIN.is_file():
        return {"status": "skipped", "reason": f"{RELEASE_BIN} missing; run scripts/build.sh"}
    if xml.stat().st_size > 50e6:
        log("valgrind runs 20-50x slower; consider a smaller export")

    cmd = [tool, "--tool=memcheck", "--leak-check=full", "--show-leak-kinds=definite,indirect",
           "--errors-for-leak-kinds=definite,indirect", "--error-exitcode=99",
           str(RELEASE_BIN), "--format", "summary", "--threads", str(threads or 2), str(xml)]
    started = time.perf_counter()
    proc = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    stderr = proc.stderr.decode("utf-8", "replace")

    def bytes_lost(kind: str) -> int:
        m = re.search(rf"{kind} lost: ([\d,]+) bytes", stderr)
        return int(m.group(1).replace(",", "")) if m else 0

    errors = re.search(r"ERROR SUMMARY: ([\d,]+) errors", stderr)
    result = {
        "exit_code": proc.returncode,
        "seconds": round(time.perf_counter() - started, 1),
        "errors": int(errors.group(1).replace(",", "")) if errors else None,
        "definitely_lost_bytes": bytes_lost("definitely"),
        "indirectly_lost_bytes": bytes_lost("indirectly"),
    }
    passed = proc.returncode == 0 and result["errors"] == 0
    result["status"] = "passed" if passed else "failed"
    if not passed:
        result["report"] = stderr[-3000:]
    log(f"valgrind: {result['status']} ({result['errors']} errors, {result['definitely_lost_bytes']} bytes definitely lost)")
    return result


# ─── CLI ──────────────────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("check", choices=("profile", "asan", "valgrind", "all"))
    parser.add_argument("input", help="export.xml or export.zip")
    parser.add_argument("--engine", type=Path, default=RELEASE_BIN, help="binary to profile (default: release build)")
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--format", choices=("summary", "json", "binary"), default="json",
                        help="engine output format while profiling (output goes to /dev/null)")
    parser.add_argument("--threads", type=int)
    parser.add_argument("--interval", type=float, default=0.01, help="memory sampling interval, seconds")
    parser.add_argument("--no-warmup", action="store_true", help="don't do an unmeasured first run")
    parser.add_argument("--build", action="store_true", help="build the sanitizer binary if it's missing")
    parser.add_argument("--report", type=Path, help="also write the full report as JSON")
    args = parser.parse_args(argv)
    if args.runs < 1:
        parser.error("--runs must be at least 1")

    report: dict = {}
    try:
        with tempfile.TemporaryDirectory(prefix="ez-telemetry-prof-") as workdir:
            xml = prepare_input(Path(args.input), Path(workdir))
            if args.check in ("profile", "all"):
                report["profile"] = profile(args.engine, xml, args.runs, args.format, args.threads,
                                            args.interval, not args.no_warmup)
            if args.check in ("asan", "all"):
                report["asan"] = asan(xml, args.build)
            if args.check in ("valgrind", "all"):
                report["valgrind"] = valgrind(xml, args.threads)
    except PipelineError as e:
        log(f"error: {e}")
        return 1
    except subprocess.CalledProcessError as e:
        log(f"error: {' '.join(map(str, e.cmd))} exited with {e.returncode}")
        return 2

    # The console gets everything but the raw tool logs; --report keeps those too.
    def without_logs(value):
        if isinstance(value, dict):
            return {k: without_logs(v) for k, v in value.items() if k not in ("report", "rss_timeline_kb")}
        return value

    print(json.dumps(without_logs(report), indent=2))
    if args.report:
        args.report.write_text(json.dumps(report, indent=2))
        log(f"report written to {args.report}")

    failed = [name for name, r in report.items()
              if r.get("status") == "failed" or r.get("passed") is False]
    if failed:
        log(f"failed: {', '.join(failed)}")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
