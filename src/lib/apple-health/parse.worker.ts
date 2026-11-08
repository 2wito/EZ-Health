import JSZip from "jszip";
import { WasmHealthParser, type EngineFactory } from "./wasm-engine";
import { AppleHealthXmlParser, NotAHealthExportError, type ParseResult } from "./xml-parser";

// Parses export.zip / export.xml in the browser, off the main thread. Only the
// compact parsed records leave the device, in small batches, so the upload
// never hits a host's body limit.
//
// The parser is the C++ engine compiled to WebAssembly (telemetry-engine/,
// served from public/wasm). If it can't load, or fails partway, the same file
// is parsed again with the TypeScript parser, which produces identical records.

export type ParseErrorCode = "damaged" | "noXml" | "notExport" | "empty" | "generic";
export type ParseEngine = "wasm" | "js";

export type WorkerMessage =
  | {
      type: "progress";
      phase: "open" | "read";
      bytesRead: number;
      bytesTotal: number;
      recordsRead: number;
      engine: ParseEngine | null;
    }
  | { type: "done"; result: ParseResult; bytesTotal: number; engine: ParseEngine }
  | { type: "error"; code: ParseErrorCode };

// tsconfig has the DOM lib, not the worker one; this is the slice of the worker scope we use.
const scope = self as unknown as {
  postMessage(message: WorkerMessage): void;
  onmessage: ((e: MessageEvent<{ file: File }>) => void) | null;
};
const post = (m: WorkerMessage) => scope.postMessage(m);

class ParseFailure extends Error {
  constructor(readonly code: ParseErrorCode) {
    super(code);
  }
}

/** A parser fed raw export.xml bytes. */
interface ChunkParser {
  readonly engine: ParseEngine;
  readonly recordsRead: number;
  write(chunk: Uint8Array): void;
  finish(): ParseResult;
  dispose(): void;
}

// Served as a static file and loaded at runtime, so the bundler leaves it alone.
const WASM_ENGINE_URL = "/wasm/ez-telemetry.mjs";
let wasmFactory: Promise<EngineFactory> | null = null;

async function wasmParser(): Promise<ChunkParser> {
  wasmFactory ??= import(/* webpackIgnore: true */ /* turbopackIgnore: true */ WASM_ENGINE_URL).then(
    (m: { default: EngineFactory }) => m.default,
  );
  const parser = new WasmHealthParser(await (await wasmFactory)());
  return {
    engine: "wasm",
    get recordsRead() {
      return parser.recordsRead;
    },
    write: (chunk) => parser.write(chunk),
    finish: () => parser.finish(),
    dispose: () => parser.dispose(),
  };
}

function jsParser(): ChunkParser {
  const parser = new AppleHealthXmlParser();
  const decoder = new TextDecoder(); // { stream: true } keeps multi-byte characters intact across chunks
  return {
    engine: "js",
    get recordsRead() {
      return parser.recordsRead;
    },
    write: (chunk) => parser.write(decoder.decode(chunk, { stream: true })),
    finish: () => {
      parser.write(decoder.decode());
      return parser.finish();
    },
    dispose: () => {},
  };
}

async function parseFile(file: File, parser: ChunkParser): Promise<{ result: ParseResult; bytesTotal: number }> {
  try {
    const { chunks, bytesTotal } = await openExportXml(file);
    let bytesRead = 0;
    let lastReport = 0;
    for await (const chunk of chunks) {
      bytesRead += chunk.byteLength;
      parser.write(chunk);
      if (Date.now() - lastReport > 250) {
        lastReport = Date.now();
        post({ type: "progress", phase: "read", bytesRead, bytesTotal, recordsRead: parser.recordsRead, engine: parser.engine });
      }
    }
    return { result: parser.finish(), bytesTotal: bytesTotal || bytesRead };
  } finally {
    parser.dispose();
  }
}

scope.onmessage = async (e) => {
  const file = e.data.file;
  try {
    post({ type: "progress", phase: "open", bytesRead: 0, bytesTotal: 0, recordsRead: 0, engine: null });

    let parser: ChunkParser;
    try {
      parser = await wasmParser();
    } catch (err) {
      console.warn("[import] WebAssembly engine unavailable, using the JavaScript parser:", err);
      parser = jsParser();
    }

    let parsed: { result: ParseResult; bytesTotal: number };
    try {
      parsed = await parseFile(file, parser);
    } catch (err) {
      // Bad input fails the same way in both parsers; anything else in the engine gets a second try in JS.
      if (parser.engine !== "wasm" || err instanceof ParseFailure || err instanceof NotAHealthExportError) throw err;
      console.warn("[import] WebAssembly engine failed, parsing again with the JavaScript parser:", err);
      parser = jsParser();
      parsed = await parseFile(file, parser);
    }

    const { result, bytesTotal } = parsed;
    if (result.recordsRead === 0 && result.workouts.length === 0) throw new ParseFailure("empty");
    post({ type: "done", result, bytesTotal, engine: parser.engine });
  } catch (err) {
    if (!(err instanceof ParseFailure)) console.error("[import] parse failed:", err);
    post({
      type: "error",
      code: err instanceof ParseFailure ? err.code : err instanceof NotAHealthExportError ? "notExport" : "generic",
    });
  }
};

/** export.xml as byte chunks, unzipping first if needed (sniffed, not trusted from the name). */
async function openExportXml(file: File): Promise<{ chunks: AsyncIterable<Uint8Array>; bytesTotal: number }> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const isZip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  if (!isZip) return { chunks: readStream(file.stream()), bytesTotal: file.size };

  // JSZip keeps the (compressed) archive in memory; export.xml is inflated as a stream.
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new ParseFailure("damaged");
  }
  const entry = Object.values(zip.files).find((f) => !f.dir && /(^|\/)export\.xml$/i.test(f.name));
  if (!entry) throw new ParseFailure("noXml");
  // Not part of JSZip's typings, but present on every loaded entry.
  const bytesTotal = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
  return { chunks: zipEntryChunks(entry), bytesTotal };
}

async function* readStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    yield value;
  }
}

interface ZipStream {
  on(event: "data", cb: (chunk: Uint8Array) => void): ZipStream;
  on(event: "error", cb: (err: Error) => void): ZipStream;
  on(event: "end", cb: () => void): ZipStream;
  pause(): ZipStream;
  resume(): ZipStream;
}

/** Adapts JSZip's push-style stream to an async iterable, pausing it while the parser catches up. */
async function* zipEntryChunks(entry: JSZip.JSZipObject): AsyncGenerator<Uint8Array> {
  const queue: Uint8Array[] = [];
  let ended = false;
  let failure: unknown = null;
  let wake: (() => void) | null = null;
  const notify = () => {
    wake?.();
    wake = null;
  };

  // Public in JSZip (used by nodeStream), just missing from its typings.
  const stream = (entry as unknown as { internalStream(type: "uint8array"): ZipStream }).internalStream("uint8array");
  stream
    .on("data", (chunk: Uint8Array) => {
      queue.push(chunk);
      if (queue.length > 8) stream.pause();
      notify();
    })
    .on("error", (err: Error) => {
      failure = err;
      notify();
    })
    .on("end", () => {
      ended = true;
      notify();
    })
    .resume();

  for (;;) {
    if (failure) throw new ParseFailure("damaged");
    const next = queue.shift();
    if (next) {
      if (queue.length < 2) stream.resume();
      yield next;
      continue;
    }
    if (ended) return;
    await new Promise<void>((resolve) => (wake = resolve));
  }
}
