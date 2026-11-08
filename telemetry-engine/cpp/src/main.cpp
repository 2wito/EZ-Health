// ez-telemetry: native Apple Health export processor.
//
//   ez-telemetry [options] <export.xml>
//
// Exit codes: 0 ok, 1 bad usage, 2 I/O error, 3 not an Apple Health export,
// 4 internal error.

#include <chrono>
#include <csignal>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <exception>
#include <iostream>
#include <optional>
#include <string>
#include <string_view>
#include <system_error>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

#include "aggregator.hpp"
#include "health_records.hpp"
#include "mapped_file.hpp"
#include "output.hpp"
#include "xml_parser.hpp"

namespace {

enum Exit : int { kOk = 0, kUsage = 1, kIo = 2, kNotHealthExport = 3, kInternal = 4 };

enum class Format { Json, Binary, Summary };

struct Options {
  std::string input;
  std::string output;  // empty = stdout
  Format format = Format::Json;
  ezt::AggregatorOptions aggregator;
  std::uint64_t max_errors = 10'000;
  bool verbose = false;
};

constexpr std::string_view kUsageText = R"(Usage: ez-telemetry [options] <export.xml>

Parses an Apple Health export.xml (unzip export.zip first) and writes the
records and analytics.

Options:
  -f, --format FORMAT   json (NDJSON records + summary, default), binary, summary
  -o, --output PATH     write to PATH instead of stdout
  -t, --threads N       aggregation threads (default: all cores)
  -w, --window DAYS     rolling window for HRV / resting HR (default 7)
      --baseline DAYS   baseline length before the window (default 60)
      --max-errors N    malformed XML constructs tolerated (default 10000)
  -v, --verbose         timings and memory-pool stats on stderr
  -V, --version         print the version
  -h, --help            show this help

Exit codes: 0 ok, 1 usage, 2 I/O error, 3 not an Apple Health export, 4 internal error.
)";

[[noreturn]] void usage_error(const std::string& message) {
  std::cerr << "ez-telemetry: " << message << "\n\n" << kUsageText;
  std::exit(kUsage);
}

std::uint64_t parse_count(std::string_view flag, std::string_view value, std::uint64_t min, std::uint64_t max) {
  std::uint64_t n = 0;
  for (const char c : value) {
    if (c < '0' || c > '9' || n > max / 10) usage_error(std::string(flag) + " expects a number");
    n = n * 10 + static_cast<std::uint64_t>(c - '0');
  }
  if (value.empty() || n < min || n > max) {
    usage_error(std::string(flag) + " must be between " + std::to_string(min) + " and " + std::to_string(max));
  }
  return n;
}

Options parse_args(int argc, char** argv) {
  Options o;
  for (int i = 1; i < argc; ++i) {
    const std::string_view arg = argv[i];
    const auto next = [&]() -> std::string_view {
      if (i + 1 >= argc) usage_error(std::string(arg) + " needs a value");
      return argv[++i];
    };

    if (arg == "-h" || arg == "--help") {
      std::cout << kUsageText;
      std::exit(kOk);
    } else if (arg == "-V" || arg == "--version") {
      std::cout << "ez-telemetry " << ezt::kEngineVersion << "\n";
      std::exit(kOk);
    } else if (arg == "-f" || arg == "--format") {
      const std::string_view f = next();
      if (f == "json") o.format = Format::Json;
      else if (f == "binary") o.format = Format::Binary;
      else if (f == "summary") o.format = Format::Summary;
      else usage_error("unknown format '" + std::string(f) + "' (json, binary or summary)");
    } else if (arg == "-o" || arg == "--output") {
      o.output = next();
    } else if (arg == "-t" || arg == "--threads") {
      o.aggregator.threads = static_cast<unsigned>(parse_count(arg, next(), 1, 256));
    } else if (arg == "-w" || arg == "--window") {
      o.aggregator.window_days = static_cast<int>(parse_count(arg, next(), 1, 365));
    } else if (arg == "--baseline") {
      o.aggregator.baseline_days = static_cast<int>(parse_count(arg, next(), 7, 3650));
    } else if (arg == "--max-errors") {
      o.max_errors = parse_count(arg, next(), 0, UINT64_MAX / 10);
    } else if (arg == "-v" || arg == "--verbose") {
      o.verbose = true;
    } else if (arg.size() > 1 && arg[0] == '-') {
      usage_error("unknown option " + std::string(arg));
    } else if (o.input.empty()) {
      o.input = arg;
    } else {
      usage_error("only one input file is supported");
    }
  }
  if (o.input.empty()) usage_error("missing input file");
  return o;
}

double ms_since(std::chrono::steady_clock::time_point t) {
  return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t).count();
}

int run(const Options& o) {
  const auto started = std::chrono::steady_clock::now();

  std::optional<ezt::MappedFile> file;
  try {
    file.emplace(o.input);
  } catch (const std::system_error& e) {
    std::cerr << "ez-telemetry: " << e.what() << "\n";
    return kIo;
  }

  // Parse.
  ezt::HealthExportCollector collector;
  ezt::ParseOptions parse_options;
  parse_options.max_errors = o.max_errors;
  parse_options.on_progress = [&](std::size_t offset) { file->release_before(offset); };
  ezt::XmlStreamParser parser(parse_options);
  ezt::RunInfo run;
  run.file = o.input;
  run.parse = parser.parse(file->view(), collector);
  collector.finish();
  run.parse_ms = ms_since(started);

  if (run.parse.aborted || !collector.saw_health_data()) {
    std::cerr << "ez-telemetry: " << o.input << " doesn't look like an Apple Health export"
              << (run.parse.aborted ? " (too many XML errors)" : " (no <HealthData> element)") << "\n";
    return kNotHealthExport;
  }

  // Aggregate.
  const auto aggregate_started = std::chrono::steady_clock::now();
  const ezt::AggregateReport report = ezt::aggregate(collector.samples, collector.sleep, o.aggregator);
  run.aggregate_ms = ms_since(aggregate_started);
  run.total_ms = ms_since(started);
  const std::string summary = ezt::build_summary_json(run, collector, report);

  // Write.
  std::FILE* out = stdout;
  if (!o.output.empty()) {
    out = std::fopen(o.output.c_str(), o.format == Format::Binary ? "wb" : "w");
    if (out == nullptr) {
      std::cerr << "ez-telemetry: can't write " << o.output << "\n";
      return kIo;
    }
  }
#ifdef _WIN32
  if (out == stdout && o.format == Format::Binary) _setmode(_fileno(stdout), _O_BINARY);
#endif

  int status = kOk;
  try {
    ezt::Sink sink(out);
    switch (o.format) {
      case Format::Json:
        ezt::write_ndjson_records(sink, collector);
        sink.write(R"({"kind":"summary","summary":)");
        sink.write(summary);
        sink.write("}\n");
        break;
      case Format::Binary:
        ezt::write_binary_header(sink);
        ezt::write_binary_records(sink, collector);
        ezt::write_binary_end(sink, summary);
        break;
      case Format::Summary:
        sink.write(summary);
        sink.write("\n");
        break;
    }
    sink.flush();
  } catch (const std::runtime_error& e) {
    std::cerr << "ez-telemetry: " << e.what() << "\n";
    status = kIo;
  }
  if (out != stdout && std::fclose(out) != 0 && status == kOk) status = kIo;

  if (o.verbose) {
    const ezt::PoolStats pool = collector.pool_stats();
    std::cerr << "ez-telemetry: " << collector.stats.records_read << " records, " << collector.samples.size()
              << " samples, " << collector.sleep.size() << " sleep segments in " << run.parse_ms << " ms (parse) + "
              << run.aggregate_ms << " ms (aggregate, " << report.threads << " threads)\n"
              << "memory pool: " << pool.allocations << " allocations, peak " << pool.peak_blocks_in_use
              << " blocks of " << pool.block_size << " B in " << pool.chunks << " chunks, "
              << pool.upstream_allocations << " upstream\n";
  }
  return status;
}

}  // namespace

int main(int argc, char** argv) {
#ifdef SIGPIPE
  // A closed pipe should surface as a write error (exit 2), not kill the process.
  std::signal(SIGPIPE, SIG_IGN);
#endif
  const Options options = parse_args(argc, argv);
  try {
    return run(options);
  } catch (const std::bad_alloc&) {
    std::cerr << "ez-telemetry: out of memory\n";
  } catch (const std::exception& e) {
    std::cerr << "ez-telemetry: internal error: " << e.what() << "\n";
  }
  return kInternal;
}
