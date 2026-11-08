#pragma once

// Output encodings of the CLI.
//
// json   NDJSON, one line per record:
//          {"kind":"samples","record":{...}}
//          {"kind":"sleepStages","record":{...}}
//          {"kind":"workouts","record":{...}}
//          {"kind":"activity","record":{...}}
//        and a last line {"kind":"summary","summary":{...}}.
//        Each "record" has exactly the shape POST /api/import/:id/batch
//        accepts (see record_json.hpp), so a consumer can group lines by kind
//        and forward them without re-encoding.
//
// binary Little-endian frames after an 8-byte header "EZTB", u16 version (2), u16 0:
//          0x01 source   u16 id, u16 length, UTF-8 bytes
//          0x02 sample   u8 type, i16 tz_min, i64 utc_ms, f64 qty, f64 min, f64 avg, f64 max, u16 source
//          0x03 sleep    u8 stage, i16 tz_min, i64 start_ms, i64 end_ms, i32 night_day, u16 source
//          0x04 activity i32 day, f64 x6 (kcal, kcal goal, exercise min, goal, stand h, goal)
//          0x05 workout  i16 tz_min, i64 start_ms, i64 end_ms, i32 local_day, i64 duration_sec, u16 source,
//                        f64 x9 (kcal, km, km/h, elevation m, steps, METs, avg/min/max HR),
//                        u16 name length, UTF-8 name
//          0xFF end      u32 length, summary JSON
//        NaN encodes "no value". Enum values follow health_records.hpp.
//
// summary Only the summary JSON object.

#include <cstdint>
#include <cstdio>
#include <string>
#include <string_view>

#include "aggregator.hpp"
#include "health_records.hpp"
#include "record_json.hpp"
#include "xml_parser.hpp"

namespace ezt {

inline constexpr std::string_view kEngineVersion = "0.2.0";
inline constexpr std::uint16_t kBinaryVersion = 2;

/// Buffered writer over a FILE*. Throws std::runtime_error when a write fails
/// (for example the reading end of a pipe went away).
class Sink {
 public:
  explicit Sink(std::FILE* file, std::size_t buffer_bytes = std::size_t{1} << 20);
  ~Sink();
  Sink(const Sink&) = delete;
  Sink& operator=(const Sink&) = delete;

  void write(std::string_view bytes);
  void flush();
  [[nodiscard]] std::uint64_t bytes_written() const noexcept { return written_ + buffer_.size(); }

 private:
  std::FILE* file_;
  std::string buffer_;
  std::size_t limit_;
  std::uint64_t written_ = 0;
};

struct RunInfo {
  std::string file;
  ParseStats parse;
  double parse_ms = 0;
  double aggregate_ms = 0;
  double total_ms = 0;
};

void write_ndjson_records(Sink& sink, const HealthExportCollector& collector);
void write_binary_header(Sink& sink);
void write_binary_records(Sink& sink, const HealthExportCollector& collector);
void write_binary_end(Sink& sink, std::string_view summary_json);

[[nodiscard]] std::string build_summary_json(const RunInfo& run, const HealthExportCollector& collector,
                                             const AggregateReport& report);

}  // namespace ezt
