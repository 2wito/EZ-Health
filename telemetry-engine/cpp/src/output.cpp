#include "output.hpp"

#include <algorithm>
#include <bit>
#include <charconv>
#include <cmath>
#include <stdexcept>
#include <vector>

namespace ezt {

// ─── Sink ───────────────────────────────────────────────────────────────────

Sink::Sink(std::FILE* file, std::size_t buffer_bytes) : file_(file), limit_(buffer_bytes) {
  buffer_.reserve(buffer_bytes + 4096);
}

Sink::~Sink() {
  try {
    flush();
  } catch (...) {  // destructor: the caller already saw (or will ignore) the error
  }
}

void Sink::write(std::string_view bytes) {
  buffer_.append(bytes);
  if (buffer_.size() >= limit_) flush();
}

void Sink::flush() {
  if (buffer_.empty()) return;
  const std::size_t n = std::fwrite(buffer_.data(), 1, buffer_.size(), file_);
  written_ += n;
  const bool failed = n != buffer_.size();
  buffer_.clear();
  if (failed || std::fflush(file_) != 0) throw std::runtime_error("write failed (output closed?)");
}

// ─── NDJSON records ─────────────────────────────────────────────────────────

namespace {

template <class Records, class Append>
void write_lines(Sink& sink, std::string& line, std::string_view kind, const Records& records, Append append) {
  for (const auto& record : records) {
    line.assign(R"({"kind":")");
    line += kind;
    line += R"(","record":)";
    append(line, record);
    line += "}\n";
    sink.write(line);
  }
}

}  // namespace

void write_ndjson_records(Sink& sink, const HealthExportCollector& c) {
  std::string line;
  line.reserve(512);
  write_lines(sink, line, "samples", c.samples,
              [&](std::string& out, const MetricSample& s) { append_sample_json(out, s, c.sources); });
  write_lines(sink, line, "sleepStages", c.sleep,
              [&](std::string& out, const SleepSegment& s) { append_sleep_json(out, s, c.sources); });
  write_lines(sink, line, "workouts", c.workouts,
              [&](std::string& out, const WorkoutRecord& w) { append_workout_json(out, w, c.sources); });
  write_lines(sink, line, "activity", c.activity,
              [&](std::string& out, const DailyActivity& a) { append_activity_json(out, a); });
}

// ─── Binary records ─────────────────────────────────────────────────────────

namespace {

class Frame {
 public:
  void u8(std::uint8_t v) { bytes_.push_back(static_cast<char>(v)); }
  void u16(std::uint16_t v) { le(v, 2); }
  void i16(std::int16_t v) { le(static_cast<std::uint16_t>(v), 2); }
  void u32(std::uint32_t v) { le(v, 4); }
  void i32(std::int32_t v) { le(static_cast<std::uint32_t>(v), 4); }
  void i64(std::int64_t v) { le(static_cast<std::uint64_t>(v), 8); }
  void f64(double v) { le(std::bit_cast<std::uint64_t>(v), 8); }
  void raw(std::string_view s) { bytes_.append(s); }
  /// u16 length + bytes (truncated to 65535 bytes).
  void str16(std::string_view s) {
    const std::size_t len = std::min<std::size_t>(s.size(), 0xFFFF);
    u16(static_cast<std::uint16_t>(len));
    raw(s.substr(0, len));
  }
  void clear() { bytes_.clear(); }
  [[nodiscard]] std::string_view view() const noexcept { return bytes_; }

 private:
  // Byte by byte, so the encoding doesn't depend on the host's endianness.
  void le(std::uint64_t v, int n) {
    for (int i = 0; i < n; ++i) bytes_.push_back(static_cast<char>((v >> (8 * i)) & 0xFF));
  }
  std::string bytes_;
};

}  // namespace

void write_binary_header(Sink& sink) {
  Frame f;
  f.raw("EZTB");
  f.u16(kBinaryVersion);
  f.u16(0);
  sink.write(f.view());
}

void write_binary_records(Sink& sink, const HealthExportCollector& c) {
  Frame f;
  for (std::size_t id = 0; id < c.sources.size(); ++id) {
    f.clear();
    f.u8(0x01);
    f.u16(static_cast<std::uint16_t>(id));
    f.str16(c.sources.name(static_cast<std::uint16_t>(id)));
    sink.write(f.view());
  }
  for (const MetricSample& s : c.samples) {
    f.clear();
    f.u8(0x02);
    f.u8(static_cast<std::uint8_t>(s.type));
    f.i16(s.tz_min);
    f.i64(s.utc_ms);
    f.f64(s.qty);
    f.f64(s.min);
    f.f64(s.avg);
    f.f64(s.max);
    f.u16(s.source);
    sink.write(f.view());
  }
  for (const SleepSegment& s : c.sleep) {
    f.clear();
    f.u8(0x03);
    f.u8(static_cast<std::uint8_t>(s.stage));
    f.i16(s.tz_min);
    f.i64(s.start_ms);
    f.i64(s.end_ms);
    f.i32(s.night);
    f.u16(s.source);
    sink.write(f.view());
  }
  for (const DailyActivity& a : c.activity) {
    f.clear();
    f.u8(0x04);
    f.i32(a.day);
    for (const double v : {a.active_kcal, a.active_goal_kcal, a.exercise_min, a.exercise_goal_min, a.stand_hours,
                           a.stand_goal_hours}) {
      f.f64(v);
    }
    sink.write(f.view());
  }
  for (const WorkoutRecord& w : c.workouts) {
    f.clear();
    f.u8(0x05);
    f.i16(w.tz_min);
    f.i64(w.start_ms);
    f.i64(w.end_ms);
    f.i32(w.local_day);
    f.i64(w.duration_sec);
    f.u16(w.source);
    for (const double v : {w.active_kcal, w.distance_km, w.avg_speed_kmh, w.elevation_up_m, w.step_count,
                           w.intensity_met, w.avg_hr, w.min_hr, w.max_hr}) {
      f.f64(v);
    }
    f.str16(w.name);
    sink.write(f.view());
  }
}

void write_binary_end(Sink& sink, std::string_view summary_json) {
  Frame f;
  f.u8(0xFF);
  f.u32(static_cast<std::uint32_t>(summary_json.size()));
  f.raw(summary_json);
  sink.write(f.view());
}

// ─── Summary ────────────────────────────────────────────────────────────────

namespace {

/// Minimal JSON builder that inserts commas itself.
class JsonBuilder {
 public:
  std::string out;

  JsonBuilder& begin_object() { return open('{'); }
  JsonBuilder& end_object() { return close('}'); }
  JsonBuilder& begin_array() { return open('['); }
  JsonBuilder& end_array() { return close(']'); }

  JsonBuilder& key(std::string_view k) {
    separate();
    append_json_string(out, k);
    out += ':';
    after_key_ = true;
    return *this;
  }
  JsonBuilder& string(std::string_view v) {
    value();
    append_json_string(out, v);
    return *this;
  }
  JsonBuilder& number(double v) {
    value();
    append_json_number(out, v);
    return *this;
  }
  JsonBuilder& integer(std::int64_t v) {
    value();
    out += std::to_string(v);
    return *this;
  }
  JsonBuilder& null() {
    value();
    out += "null";
    return *this;
  }
  JsonBuilder& iso(std::int64_t utc_ms) {
    value();
    append_iso_ms(out, utc_ms);
    return *this;
  }
  JsonBuilder& date(std::int32_t day) {
    value();
    append_date(out, day);
    return *this;
  }

 private:
  JsonBuilder& open(char c) {
    value();
    out += c;
    first_.push_back(true);
    return *this;
  }
  JsonBuilder& close(char c) {
    first_.pop_back();
    out += c;
    return *this;
  }
  void value() {
    if (after_key_) {
      after_key_ = false;
    } else {
      separate();
    }
  }
  void separate() {
    if (first_.empty()) return;
    if (!first_.back()) out += ',';
    first_.back() = false;
  }

  std::vector<bool> first_;
  bool after_key_ = false;
};

double round_to(double v, double places) {
  const double f = std::pow(10.0, places);
  return std::round(v * f) / f;
}

void series_json(JsonBuilder& j, const SeriesReport& s) {
  j.begin_object();
  j.key("days").integer(static_cast<std::int64_t>(s.days.size()));
  j.key("latest").number(round_to(s.latest, 2));
  j.key("latestRolling").number(round_to(s.latest_rolling, 2));
  j.key("baselineMean").number(round_to(s.baseline_mean, 2));
  j.key("baselineSd").number(round_to(s.baseline_sd, 2));
  j.key("baselineDays").integer(s.baseline_days);
  j.key("series").begin_array();
  for (const DailyValue& d : s.days) {
    j.begin_object();
    j.key("date").date(d.day);
    j.key("mean").number(round_to(d.mean, 2));
    j.key("rolling").number(round_to(d.rolling, 2));
    j.key("readings").integer(d.readings);
    j.end_object();
  }
  j.end_array();
  j.end_object();
}

constexpr std::array<SleepStage, 5> kReportedStages{SleepStage::Awake, SleepStage::Asleep, SleepStage::Core,
                                                    SleepStage::Deep, SleepStage::Rem};

}  // namespace

std::string build_summary_json(const RunInfo& run, const HealthExportCollector& c, const AggregateReport& r) {
  JsonBuilder j;
  j.begin_object();
  j.key("engine").string("ez-telemetry");
  j.key("version").string(kEngineVersion);
  j.key("file").string(run.file);
  j.key("bytes").integer(static_cast<std::int64_t>(run.parse.bytes));
  j.key("xmlElements").integer(static_cast<std::int64_t>(run.parse.elements));
  j.key("xmlErrors").integer(static_cast<std::int64_t>(run.parse.errors));
  j.key("recordsRead").integer(static_cast<std::int64_t>(c.stats.records_read));
  j.key("recordsSkipped").integer(static_cast<std::int64_t>(c.stats.records_skipped));
  j.key("parseWarnings").integer(static_cast<std::int64_t>(c.stats.warnings + run.parse.errors));
  j.key("workoutsSeen").integer(static_cast<std::int64_t>(c.stats.workouts_seen));
  if (c.stats.has_range()) {
    j.key("dataFrom").iso(c.stats.data_from_ms);
    j.key("dataTo").iso(c.stats.data_to_ms);
  } else {
    j.key("dataFrom").null();
    j.key("dataTo").null();
  }

  j.key("counts").begin_object();
  j.key("samples").integer(static_cast<std::int64_t>(c.samples.size()));
  j.key("sleepStages").integer(static_cast<std::int64_t>(c.sleep.size()));
  j.key("sleepNights").integer(static_cast<std::int64_t>(c.sleep_night_count()));
  j.key("workouts").integer(static_cast<std::int64_t>(c.workouts.size()));
  j.key("activityDays").integer(static_cast<std::int64_t>(c.activity.size()));
  j.key("sources").integer(static_cast<std::int64_t>(c.sources.size()));
  j.end_object();

  const double seconds = run.parse_ms / 1000.0;
  j.key("timings").begin_object();
  j.key("parseMs").number(round_to(run.parse_ms, 2));
  j.key("aggregateMs").number(round_to(run.aggregate_ms, 2));
  j.key("totalMs").number(round_to(run.total_ms, 2));
  j.key("recordsPerSec").number(seconds > 0 ? std::round(static_cast<double>(c.stats.records_read) / seconds) : kNull);
  j.key("mbPerSec").number(seconds > 0 ? round_to(static_cast<double>(run.parse.bytes) / 1e6 / seconds, 1) : kNull);
  j.end_object();

  const PoolStats pool = c.pool_stats();
  j.key("memoryPool").begin_object();
  j.key("blockBytes").integer(static_cast<std::int64_t>(pool.block_size));
  j.key("chunks").integer(static_cast<std::int64_t>(pool.chunks));
  j.key("reservedBytes").integer(static_cast<std::int64_t>(pool.reserved_bytes()));
  j.key("peakBlocksInUse").integer(static_cast<std::int64_t>(pool.peak_blocks_in_use));
  j.key("blocksInUse").integer(static_cast<std::int64_t>(pool.blocks_in_use));
  j.key("allocations").integer(static_cast<std::int64_t>(pool.allocations));
  j.key("upstreamAllocations").integer(static_cast<std::int64_t>(pool.upstream_allocations));
  j.end_object();

  j.key("analytics").begin_object();
  j.key("threads").integer(r.threads);
  j.key("windowDays").integer(r.window_days);
  j.key("hrv");
  series_json(j, r.hrv);
  j.key("restingHeartRate");
  series_json(j, r.resting_hr);

  const SleepReport& s = r.sleep;
  const double nights = static_cast<double>(s.nights.size());
  j.key("sleep").begin_object();
  j.key("nights").integer(static_cast<std::int64_t>(s.nights.size()));
  j.key("avgTransitionsPerNight").number(nights > 0 ? round_to(static_cast<double>(s.total_transitions) / nights, 2) : kNull);
  j.key("avgAwakeningsPerNight").number(nights > 0 ? round_to(static_cast<double>(s.total_awakenings) / nights, 2) : kNull);
  j.key("stages").begin_array();
  for (const SleepStage st : kReportedStages) j.string(stage_name(st));
  j.end_array();
  j.key("transitionMatrix").begin_array();
  for (const SleepStage from : kReportedStages) {
    j.begin_array();
    for (const SleepStage to : kReportedStages) {
      j.integer(static_cast<std::int64_t>(s.transitions[static_cast<std::size_t>(from)][static_cast<std::size_t>(to)]));
    }
    j.end_array();
  }
  j.end_array();
  j.key("recentNights").begin_array();
  const std::size_t recent = std::min<std::size_t>(s.nights.size(), 14);
  for (std::size_t i = s.nights.size() - recent; i < s.nights.size(); ++i) {
    const NightReport& n = s.nights[i];
    j.begin_object();
    j.key("night").date(n.night);
    j.key("source").string(c.sources.name(n.source));
    j.key("asleepHours").number(round_to(n.asleep_hours(), 2));
    const auto hours = [&](SleepStage st) { return round_to(n.hours[static_cast<std::size_t>(st)], 2); };
    j.key("coreHours").number(hours(SleepStage::Core));
    j.key("deepHours").number(hours(SleepStage::Deep));
    j.key("remHours").number(hours(SleepStage::Rem));
    j.key("awakeHours").number(hours(SleepStage::Awake));
    j.key("transitions").integer(n.transitions);
    j.key("awakenings").integer(n.awakenings);
    j.end_object();
  }
  j.end_array();
  j.end_object();  // sleep
  j.end_object();  // analytics
  j.end_object();
  return std::move(j.out);
}

}  // namespace ezt
