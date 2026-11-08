#!/usr/bin/env python3
"""Runs the native ez-telemetry engine and feeds its output into EZ Health.

    python pipeline.py import  export.zip                   # parse + upload to http://localhost:3000
    python pipeline.py import  export.zip --api-url https://my-host
    python pipeline.py import  export.xml --dry-run          # parse and batch, don't upload
    python pipeline.py analyze export.zip                    # HRV / resting HR / sleep report
    python pipeline.py records export.xml --wire binary      # decoded records as NDJSON

How an import works:
  1. export.zip is unpacked (streamed, never fully in memory) to a temp folder.
  2. A quick `--format summary` pass gives the totals the import job records.
  3. POST /api/import opens the job, exactly like the browser importer.
  4. The engine streams records; they're grouped per kind into batches of at
     most 5,000 records / 3 MB (the limits in src/lib/apple-health/batches.ts,
     safely under Vercel's 4.5 MB body limit) and sent to
     POST /api/import/:id/batch. The server validates every batch with zod and
     upserts it, so a retried batch never duplicates data.
  5. POST /api/import/:id/finish closes the job (or marks it failed).

Data goes through the app's API rather than straight into Postgres on purpose:
the API owns validation, the idempotent bulk upserts and the sleep-night
rebuild, so the pipeline can't drift from what the dashboards expect.

Workouts aren't converted by the engine yet. Import export.zip on /upload to
include them (re-importing is safe).

Only the Python standard library is used. Exit codes: 0 ok, 1 usage,
2 engine failed, 3 API error, 130 interrupted.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import IO, Iterator

ENGINE_DIR = Path(__file__).resolve().parent.parent
EXE = "ez-telemetry.exe" if os.name == "nt" else "ez-telemetry"
DEFAULT_ENGINE = ENGINE_DIR / "build" / "release" / EXE

# Mirrors src/lib/apple-health/batches.ts.
MAX_BATCH_RECORDS = 5_000
MAX_BATCH_BYTES = 3_000_000

KINDS = ("samples", "sleepStages", "activity")
NDJSON_PREFIX = {kind: f'{{"kind":"{kind}","record":' for kind in KINDS}

# Enum order of cpp/include/health_records.hpp.
METRICS = (
    ("HEART_RATE", "bpm"),
    ("RESTING_HEART_RATE", "bpm"),
    ("WALKING_HEART_RATE_AVG", "bpm"),
    ("HEART_RATE_VARIABILITY", "ms"),
    ("RESPIRATORY_RATE", "breaths/min"),
    ("ACTIVE_ENERGY", "kcal"),
    ("BASAL_ENERGY", "kcal"),
    ("STEP_COUNT", "count"),
    ("EXERCISE_TIME", "min"),
    ("VO2_MAX", "ml/kg/min"),
    ("BLOOD_OXYGEN", "%"),
)
STAGES = ("IN_BED", "AWAKE", "ASLEEP", "CORE", "DEEP", "REM")

EXIT_USAGE, EXIT_ENGINE, EXIT_API, EXIT_INTERRUPTED = 1, 2, 3, 130


class PipelineError(Exception):
    def __init__(self, message: str, code: int):
        super().__init__(message)
        self.code = code


def log(message: str) -> None:
    print(f"[pipeline] {message}", file=sys.stderr, flush=True)


# ─── Input ────────────────────────────────────────────────────────────────────


def prepare_input(path: Path, workdir: Path) -> Path:
    """Returns the export.xml to parse, unpacking export.zip into workdir if needed."""
    if not path.is_file():
        raise PipelineError(f"{path} not found", EXIT_USAGE)
    if path.suffix.lower() == ".xml":
        return path
    if path.suffix.lower() != ".zip":
        raise PipelineError("expected export.zip or export.xml from the Health app", EXIT_USAGE)

    with zipfile.ZipFile(path) as archive:
        # apple_health_export/export.xml (not export_cda.xml, the clinical records).
        members = [m for m in archive.infolist() if Path(m.filename).name == "export.xml"]
        if not members:
            raise PipelineError(f"{path} has no export.xml inside", EXIT_USAGE)
        target = workdir / "export.xml"  # fixed name: no path from the archive is used
        log(f"unpacking {members[0].filename} ({members[0].file_size / 1e6:.1f} MB)")
        with archive.open(members[0]) as src, open(target, "wb") as dst:
            shutil.copyfileobj(src, dst, length=1 << 20)
    return target


# ─── Engine ───────────────────────────────────────────────────────────────────


@dataclass
class Engine:
    binary: Path
    threads: int | None = None

    def __post_init__(self) -> None:
        if not self.binary.is_file():
            raise PipelineError(
                f"engine not found at {self.binary}; build it with telemetry-engine/scripts/build.sh",
                EXIT_ENGINE,
            )

    def command(self, xml: Path, fmt: str) -> list[str]:
        cmd = [str(self.binary), "--format", fmt]
        if self.threads:
            cmd += ["--threads", str(self.threads)]
        return cmd + [str(xml)]

    def summary(self, xml: Path) -> dict:
        result = subprocess.run(self.command(xml, "summary"), capture_output=True, text=True, encoding="utf-8")
        if result.returncode != 0:
            raise PipelineError(f"engine exited with {result.returncode}: {result.stderr.strip()}", EXIT_ENGINE)
        return json.loads(result.stdout)

    def stream(self, xml: Path, wire: str) -> Iterator[tuple[str, str | dict]]:
        """Yields (kind, record JSON text) and finally ("summary", dict)."""
        proc = subprocess.Popen(self.command(xml, wire), stdout=subprocess.PIPE, bufsize=1 << 20)
        assert proc.stdout is not None
        try:
            yield from (iter_ndjson(proc.stdout) if wire == "json" else iter_binary(proc.stdout))
        finally:
            if proc.poll() is None:
                proc.kill()
            proc.stdout.close()
            code = proc.wait()
        if code != 0:
            raise PipelineError(f"engine exited with {code}", EXIT_ENGINE)


def iter_ndjson(stream: IO[bytes]) -> Iterator[tuple[str, str | dict]]:
    # The record is forwarded as the exact text the engine wrote: no decode/encode per record.
    for raw in stream:
        line = raw.decode("utf-8", "replace").rstrip("\n")
        for kind, prefix in NDJSON_PREFIX.items():
            if line.startswith(prefix):
                yield kind, line[len(prefix) : -1]
                break
        else:
            message = json.loads(line)
            if message.get("kind") != "summary":
                raise PipelineError(f"unexpected engine output: {line[:120]}", EXIT_ENGINE)
            yield "summary", message["summary"]


# ─── Binary wire format (see cpp/include/output.hpp) ──────────────────────────

EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
SAMPLE = struct.Struct("<BhqddddH")
SLEEP = struct.Struct("<BhqqiH")
ACTIVITY = struct.Struct("<idddddd")


def _read(stream: IO[bytes], n: int) -> bytes:
    data = stream.read(n)
    if len(data) != n:
        raise PipelineError("engine output ended mid-record", EXIT_ENGINE)
    return data


def _num(v: float) -> float | None:
    return None if math.isnan(v) else v


def iso_ms(ms: int) -> str:
    dt = EPOCH + timedelta(milliseconds=ms)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{ms % 1000:03d}Z"


def iso_day(day: int) -> str:
    return (EPOCH + timedelta(days=day)).strftime("%Y-%m-%dT00:00:00.000Z")


def iter_binary(stream: IO[bytes]) -> Iterator[tuple[str, str | dict]]:
    header = _read(stream, 8)
    if header[:4] != b"EZTB":
        raise PipelineError("engine output isn't the EZTB binary format", EXIT_ENGINE)
    sources: dict[int, str] = {}
    dumps = json.JSONEncoder(separators=(",", ":"), ensure_ascii=False).encode

    while tag := stream.read(1):
        t = tag[0]
        if t == 0x01:
            sid, length = struct.unpack("<HH", _read(stream, 4))
            sources[sid] = _read(stream, length).decode("utf-8", "replace")
        elif t == 0x02:
            mtype, tz, ms, qty, mn, avg, mx, sid = SAMPLE.unpack(_read(stream, SAMPLE.size))
            local = ms + tz * 60_000
            day, rest = divmod(local, 86_400_000)
            name, unit = METRICS[mtype]
            yield "samples", dumps({
                "type": name, "timestamp": iso_ms(ms), "tzOffsetMin": tz,
                "localDate": iso_day(day), "localHour": rest // 3_600_000, "localWeekday": (day + 4) % 7,
                "qty": _num(qty), "min": _num(mn), "avg": _num(avg), "max": _num(mx),
                "unit": unit, "source": sources[sid],
            })
        elif t == 0x03:
            stage, tz, start, end, night, sid = SLEEP.unpack(_read(stream, SLEEP.size))
            yield "sleepStages", dumps({
                "stage": STAGES[stage], "start": iso_ms(start), "end": iso_ms(end),
                "tzOffsetMin": tz, "source": sources[sid], "night": iso_day(night),
            })
        elif t == 0x04:
            day, *values = ACTIVITY.unpack(_read(stream, ACTIVITY.size))
            keys = ("activeEnergyKcal", "activeEnergyGoal", "exerciseMin", "exerciseGoalMin", "standHours", "standGoalHours")
            yield "activity", dumps({"date": iso_day(day), **{k: _num(v) for k, v in zip(keys, values)}})
        elif t == 0xFF:
            (length,) = struct.unpack("<I", _read(stream, 4))
            yield "summary", json.loads(_read(stream, length))
        else:
            raise PipelineError(f"unknown binary frame 0x{t:02x}", EXIT_ENGINE)


# ─── Batching ─────────────────────────────────────────────────────────────────


@dataclass
class Batcher:
    max_records: int = MAX_BATCH_RECORDS
    max_bytes: int = MAX_BATCH_BYTES
    _records: dict[str, list[str]] = field(default_factory=lambda: {k: [] for k in KINDS})
    _bytes: dict[str, int] = field(default_factory=lambda: {k: 0 for k in KINDS})

    def _body(self, kind: str) -> bytes:
        body = f'{{"kind":"{kind}","records":[{",".join(self._records[kind])}]}}'.encode("utf-8")
        self._records[kind] = []
        self._bytes[kind] = 0
        return body

    def add(self, kind: str, record: str) -> bytes | None:
        """Adds a record; returns a full batch body when one is ready."""
        size = len(record.encode("utf-8")) + 1
        ready = None
        if self._records[kind] and self._bytes[kind] + size + 64 > self.max_bytes:
            ready = self._body(kind)
        self._records[kind].append(record)
        self._bytes[kind] += size
        if ready is None and len(self._records[kind]) >= self.max_records:
            ready = self._body(kind)
        return ready

    def drain(self) -> Iterator[bytes]:
        for kind in KINDS:
            if self._records[kind]:
                yield self._body(kind)


# ─── API ──────────────────────────────────────────────────────────────────────


@dataclass
class ApiClient:
    base_url: str
    retries: int = 3
    timeout: float = 120.0

    def post(self, path: str, body: bytes | dict) -> dict:
        data = body if isinstance(body, bytes) else json.dumps(body).encode("utf-8")
        url = self.base_url.rstrip("/") + path
        for attempt in range(1, self.retries + 1):
            request = urllib.request.Request(
                url, data=data, method="POST",
                headers={"Content-Type": "application/json", "User-Agent": "ez-telemetry-pipeline/0.1"},
            )
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    return json.loads(response.read() or b"{}")
            except urllib.error.HTTPError as e:
                detail = e.read().decode("utf-8", "replace")[:300]
                # 4xx means the request itself is wrong: retrying won't help.
                if e.code < 500 or attempt == self.retries:
                    raise PipelineError(f"POST {path} → {e.code}: {detail}", EXIT_API) from e
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                if attempt == self.retries:
                    raise PipelineError(f"POST {url} failed: {e}", EXIT_API) from e
            time.sleep(2 ** (attempt - 1))  # 1 s, 2 s, ...
        raise AssertionError("unreachable")


# ─── Commands ─────────────────────────────────────────────────────────────────


def cmd_import(args: argparse.Namespace, engine: Engine, xml: Path) -> int:
    source = Path(args.input)
    pre = engine.summary(xml)
    log(f"{pre['recordsRead']:,} records ({pre['counts']['samples']:,} samples, "
        f"{pre['counts']['sleepStages']:,} sleep segments) in {pre['timings']['totalMs']:.0f} ms")
    if pre.get("workoutsSeen"):
        log(f"note: {pre['workoutsSeen']} workouts are not converted by the engine; import the file on /upload to add them")

    api = None if args.dry_run else ApiClient(args.api_url)
    job_id = None
    if api:
        job_id = api.post("/api/import", {
            "fileName": source.name[:255],
            "fileBytes": source.stat().st_size,
            "bytesTotal": xml.stat().st_size,
            "recordsRead": pre["recordsRead"],
            "recordsSkipped": pre["recordsSkipped"],
            "parseWarnings": pre["parseWarnings"],
            "dataFrom": pre["dataFrom"],
            "dataTo": pre["dataTo"],
        })["jobId"]
        log(f"import job {job_id} started on {args.api_url}")

    batcher = Batcher(max_records=args.batch_records, max_bytes=args.batch_bytes)
    sent = records = 0
    started = time.monotonic()
    summary: dict = {}

    def send(body: bytes) -> None:
        nonlocal sent
        if api:
            api.post(f"/api/import/{job_id}/batch", body)
        sent += 1
        if sent % 25 == 0:
            log(f"  {sent} batches, {records:,} records, {time.monotonic() - started:.1f} s")

    try:
        for kind, record in engine.stream(xml, args.wire):
            if kind == "summary":
                summary = record  # type: ignore[assignment]
                continue
            records += 1
            if body := batcher.add(kind, record):  # type: ignore[arg-type]
                send(body)
        for body in batcher.drain():
            send(body)

        counts = summary.get("counts", pre["counts"])
        if api:
            api.post(f"/api/import/{job_id}/finish", {
                "status": "DONE",
                "sleepNights": counts["sleepNights"],
                "workoutsSaved": 0,
                "activityDays": counts["activityDays"],
            })
    except BaseException as e:
        if api and job_id:
            reason = "Cancelled" if isinstance(e, KeyboardInterrupt) else str(e)
            try:
                api.post(f"/api/import/{job_id}/finish", {"status": "FAILED", "error": reason[:500]})
            except PipelineError:
                pass
        raise

    verb = "prepared (dry run)" if args.dry_run else "sent"
    log(f"done: {records:,} records {verb} in {sent} batches, {time.monotonic() - started:.1f} s")
    return 0


def cmd_analyze(args: argparse.Namespace, engine: Engine, xml: Path) -> int:
    summary = engine.summary(xml)
    if args.json:
        print(json.dumps(summary, indent=2, ensure_ascii=False))
        return 0

    a = summary["analytics"]
    print(f"{summary['recordsRead']:,} records, {summary['dataFrom']} → {summary['dataTo']}")
    print(f"parsed at {summary['timings']['mbPerSec']} MB/s ({summary['timings']['recordsPerSec']:,.0f} records/s)\n")
    for label, key, unit in (("HRV", "hrv", "ms"), ("Resting heart rate", "restingHeartRate", "bpm")):
        s = a[key]
        if not s["days"]:
            print(f"{label}: no data")
            continue
        base = (f"baseline {s['baselineMean']} ± {s['baselineSd']} {unit} over {s['baselineDays']} days"
                if s["baselineMean"] is not None else "not enough history for a baseline")
        print(f"{label}: latest {s['latest']} {unit}, {a['windowDays']}-day average {s['latestRolling']} {unit} ({base})")
    sleep = a["sleep"]
    print(f"\nSleep: {sleep['nights']} nights, {sleep['avgTransitionsPerNight']} stage changes "
          f"and {sleep['avgAwakeningsPerNight']} awakenings per night")
    if sleep["nights"]:
        names = sleep["stages"]
        width = max(map(len, names)) + 2
        print("transitions (row → column):")
        print(" " * width + "".join(n.rjust(width) for n in names))
        for name, row in zip(names, sleep["transitionMatrix"]):
            print(name.ljust(width) + "".join(str(v).rjust(width) for v in row))
    return 0


def cmd_records(args: argparse.Namespace, engine: Engine, xml: Path) -> int:
    out = sys.stdout
    for kind, record in engine.stream(xml, args.wire):
        if kind != "summary":
            out.write(f'{{"kind":"{kind}","record":{record}}}\n')
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--engine", type=Path, default=Path(os.environ.get("EZT_ENGINE", DEFAULT_ENGINE)),
                        help=f"engine binary (default {DEFAULT_ENGINE.relative_to(ENGINE_DIR.parent)})")
    parser.add_argument("--threads", type=int, help="engine aggregation threads")
    sub = parser.add_subparsers(dest="command", required=True)

    p_import = sub.add_parser("import", help="parse an export and upload it to EZ Health")
    p_import.add_argument("input", help="export.zip or export.xml")
    p_import.add_argument("--api-url", default=os.environ.get("EZ_HEALTH_URL", "http://localhost:3000"),
                          help="EZ Health base URL (env EZ_HEALTH_URL, default http://localhost:3000)")
    p_import.add_argument("--dry-run", action="store_true", help="parse and batch without uploading")
    p_import.add_argument("--wire", choices=("json", "binary"), default="json", help="engine output format to read")
    p_import.add_argument("--batch-records", type=int, default=MAX_BATCH_RECORDS)
    p_import.add_argument("--batch-bytes", type=int, default=MAX_BATCH_BYTES)

    p_analyze = sub.add_parser("analyze", help="print the engine's HRV, resting HR and sleep analysis")
    p_analyze.add_argument("input")
    p_analyze.add_argument("--json", action="store_true", help="print the raw summary JSON")

    p_records = sub.add_parser("records", help="write the decoded records as NDJSON to stdout")
    p_records.add_argument("input")
    p_records.add_argument("--wire", choices=("json", "binary"), default="json")

    args = parser.parse_args(argv)
    if args.command == "import" and not (1 <= args.batch_records <= MAX_BATCH_RECORDS):
        parser.error(f"--batch-records must be between 1 and {MAX_BATCH_RECORDS} (the server's limit)")
    if args.command == "import" and not (10_000 <= args.batch_bytes <= MAX_BATCH_BYTES):
        parser.error(f"--batch-bytes must be between 10000 and {MAX_BATCH_BYTES}")

    commands = {"import": cmd_import, "analyze": cmd_analyze, "records": cmd_records}
    try:
        engine = Engine(args.engine, args.threads)
        with tempfile.TemporaryDirectory(prefix="ez-telemetry-") as workdir:
            xml = prepare_input(Path(args.input), Path(workdir))
            return commands[args.command](args, engine, xml)
    except PipelineError as e:
        log(f"error: {e}")
        return e.code
    except KeyboardInterrupt:
        log("interrupted")
        return EXIT_INTERRUPTED


if __name__ == "__main__":
    sys.exit(main())
