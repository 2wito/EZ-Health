import type { MetricSampleRecord, SleepStageRecord, WorkoutRecord } from "@/lib/health-export/normalize";
import type { DailyActivityRecord } from "@/lib/health-export/store";
import { NotAHealthExportError, type ParseResult } from "./xml-parser";

// Apple Health export parsing in WebAssembly: the C++ engine from
// telemetry-engine/ (built with `telemetry-engine/scripts/build.sh --wasm` into
// public/wasm/ez-telemetry.mjs). Produces the same ParseResult as
// AppleHealthXmlParser; wasm-engine.test.ts checks the two record for record.

/** Exports of the module (telemetry-engine/cpp/include/wasm_api.h). */
export interface EngineModule {
  HEAPU8: Uint8Array;
  _ezt_create(): number;
  _ezt_destroy(session: number): void;
  _ezt_input(session: number, bytes: number): number;
  _ezt_feed(session: number, bytes: number): number;
  _ezt_records_read(session: number): number;
  _ezt_finish(session: number): number;
  _ezt_count(session: number, kind: number): number;
  _ezt_page(session: number, kind: number, offset: number, limit: number): number;
  _ezt_output(session: number): number;
  _ezt_output_size(session: number): number;
}

/** The module's default export (Emscripten MODULARIZE factory). */
export type EngineFactory = (overrides?: object) => Promise<EngineModule>;

const KIND = { samples: 0, sleepStages: 1, workouts: 2, activity: 3 } as const;
const PAGE_SIZE = 20_000; // records decoded per call, to keep the JSON strings small
const OK = 0;
const TOO_MANY_ERRORS = 1;

/** What the engine reports after ezt_finish. */
interface EngineStats {
  recordsRead: number;
  recordsSkipped: number;
  warnings: number;
  workoutsSeen: number;
  dataFrom: string | null;
  dataTo: string | null;
}

/** A record as JSON: dates arrive as ISO strings. */
type Wire<T> = { [K in keyof T]: T[K] extends Date ? string : T[K] };

export class WasmHealthParser {
  private session: number;
  private readonly decoder = new TextDecoder();

  constructor(private readonly engine: EngineModule) {
    this.session = engine._ezt_create();
    if (!this.session) throw new Error("WebAssembly engine: couldn't create a session");
  }

  get recordsRead(): number {
    return this.session ? this.engine._ezt_records_read(this.session) : 0;
  }

  /** Parses a chunk of export.xml bytes (chunks may split tags and characters anywhere). */
  write(chunk: Uint8Array): void {
    const ptr = this.engine._ezt_input(this.session, chunk.byteLength);
    // Read HEAPU8 after the call: allocating may have grown (and replaced) the memory.
    this.engine.HEAPU8.set(chunk, ptr);
    const status = this.engine._ezt_feed(this.session, chunk.byteLength);
    if (status === TOO_MANY_ERRORS) throw new NotAHealthExportError("This file doesn't look like an Apple Health export.");
    if (status !== OK) throw new Error(`WebAssembly engine: feed failed (${status})`);
  }

  finish(): ParseResult {
    try {
      const status = this.engine._ezt_finish(this.session);
      if (status === TOO_MANY_ERRORS) throw new NotAHealthExportError("This file doesn't look like an Apple Health export.");
      if (status !== OK) throw new Error(`WebAssembly engine: finish failed (${status})`);
      const stats = this.output() as EngineStats;

      return {
        samples: this.records<MetricSampleRecord>(KIND.samples, (r) => ({
          ...r,
          timestamp: new Date(r.timestamp),
          localDate: new Date(r.localDate),
        })),
        sleepStages: this.records<SleepStageRecord>(KIND.sleepStages, (r) => ({
          ...r,
          start: new Date(r.start),
          end: new Date(r.end),
          night: new Date(r.night),
        })),
        workouts: this.records<WorkoutRecord>(KIND.workouts, (r) => ({
          ...r,
          start: new Date(r.start),
          end: new Date(r.end),
          localDate: new Date(r.localDate),
        })),
        activity: this.records<DailyActivityRecord>(KIND.activity, (r) => ({ ...r, date: new Date(r.date) })),
        recordsRead: stats.recordsRead,
        recordsSkipped: stats.recordsSkipped,
        warnings: stats.warnings,
        dataFrom: stats.dataFrom ? new Date(stats.dataFrom) : null,
        dataTo: stats.dataTo ? new Date(stats.dataTo) : null,
      };
    } finally {
      this.dispose();
    }
  }

  /** Frees the session's memory. finish() does this itself. */
  dispose(): void {
    if (this.session) {
      this.engine._ezt_destroy(this.session);
      this.session = 0;
    }
  }

  private output(): unknown {
    const ptr = this.engine._ezt_output(this.session);
    const size = this.engine._ezt_output_size(this.session);
    return JSON.parse(this.decoder.decode(this.engine.HEAPU8.subarray(ptr, ptr + size)));
  }

  private records<T>(kind: number, revive: (wire: Wire<T>) => T): T[] {
    const count = this.engine._ezt_count(this.session, kind);
    const out: T[] = [];
    for (let offset = 0; offset < count; offset += PAGE_SIZE) {
      if (this.engine._ezt_page(this.session, kind, offset, PAGE_SIZE) !== OK) {
        throw new Error(`WebAssembly engine: couldn't read records (kind ${kind})`);
      }
      for (const wire of this.output() as Wire<T>[]) out.push(revive(wire));
    }
    return out;
  }
}
