#pragma once

// Apple Health records: the compact in-memory model and the XmlHandler that
// fills it from export.xml.
//
// This mirrors src/lib/apple-health/xml-parser.ts so the engine's output can be
// sent to the same /api/import endpoints as the browser importer:
//   - heart rate, respiratory rate, SpO2      → hourly min/avg/max per source
//   - active/basal energy, steps, exercise     → hourly totals per source
//   - resting HR, walking HR, HRV, VO2 max     → kept per reading
//   - sleep analysis                           → stage segments, keyed by night
//   - <ActivitySummary>                        → daily ring totals
//   - <Workout> (+ its MetadataEntry / WorkoutStatistics children) → workouts

#include <cmath>
#include <cstdint>
#include <limits>
#include <memory_resource>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_map>
#include <utility>
#include <vector>

#include "memory_pool.hpp"
#include "xml_parser.hpp"

namespace ezt {

inline constexpr double kNull = std::numeric_limits<double>::quiet_NaN();
inline constexpr std::int64_t kMsPerHour = 3'600'000;
inline constexpr std::int64_t kMsPerDay = 86'400'000;

// Same names and order as the Prisma enums in prisma/schema.prisma.
enum class MetricType : std::uint8_t {
  HeartRate,
  RestingHeartRate,
  WalkingHeartRateAvg,
  HeartRateVariability,
  RespiratoryRate,
  ActiveEnergy,
  BasalEnergy,
  StepCount,
  ExerciseTime,
  Vo2Max,
  BloodOxygen,
  Count,
};

enum class SleepStage : std::uint8_t { InBed, Awake, Asleep, Core, Deep, Rem, Count };

[[nodiscard]] std::string_view metric_name(MetricType t) noexcept;  // "HEART_RATE"
[[nodiscard]] std::string_view metric_unit(MetricType t) noexcept;  // "bpm"
[[nodiscard]] std::string_view stage_name(SleepStage s) noexcept;   // "DEEP"
[[nodiscard]] constexpr bool is_asleep(SleepStage s) noexcept {
  return s == SleepStage::Asleep || s == SleepStage::Core || s == SleepStage::Deep || s == SleepStage::Rem;
}

// ─── Time ───────────────────────────────────────────────────────────────────

/// An instant plus the UTC offset it was recorded with.
struct Timestamp {
  std::int64_t utc_ms = 0;
  std::int16_t tz_min = 0;
};

struct CivilDate {
  std::int32_t year;
  std::uint32_t month;  // 1-12
  std::uint32_t day;    // 1-31
};

[[nodiscard]] std::int32_t days_from_civil(std::int32_t y, std::uint32_t m, std::uint32_t d) noexcept;
[[nodiscard]] CivilDate civil_from_days(std::int32_t days) noexcept;

[[nodiscard]] constexpr std::int64_t floor_div(std::int64_t a, std::int64_t b) noexcept {
  return a / b - ((a % b != 0) && ((a < 0) != (b < 0)) ? 1 : 0);
}

/// Parses "2026-10-24 08:05:00 +0300", "2026-10-24T08:05:00Z" or "2026-10-24".
[[nodiscard]] std::optional<Timestamp> parse_health_date(std::string_view s) noexcept;

/// Wall-clock fields in the offset the sample was recorded with.
struct LocalParts {
  std::int32_t day;      // days since 1970-01-01
  std::uint8_t hour;     // 0-23
  std::uint8_t weekday;  // 0 = Sunday
};
[[nodiscard]] LocalParts local_parts(Timestamp t) noexcept;

/// The local date the sleeper woke up: segments ending after 18:00 belong to the next night.
[[nodiscard]] std::int32_t sleep_night(Timestamp end) noexcept;

// ─── Records ────────────────────────────────────────────────────────────────

/// NaN means "not present" in every double field below (JSON null).
struct MetricSample {
  std::int64_t utc_ms;
  double qty;
  double min;
  double avg;
  double max;
  std::int16_t tz_min;
  MetricType type;
  std::uint16_t source;
};

struct SleepSegment {
  std::int64_t start_ms;
  std::int64_t end_ms;
  std::int32_t night;  // days since epoch
  std::int16_t tz_min;
  SleepStage stage;
  std::uint16_t source;
};

struct WorkoutRecord {
  std::string name;  // as the Health app shows it, e.g. "Outdoor Run"
  std::int64_t start_ms;
  std::int64_t end_ms;
  std::int32_t local_day;  // local date of the start
  std::int64_t duration_sec;
  double active_kcal;
  double distance_km;
  double avg_speed_kmh;
  double elevation_up_m;
  double step_count;
  double intensity_met;
  double avg_hr;
  double min_hr;
  double max_hr;
  std::int16_t tz_min;
  std::uint16_t source;
};

struct DailyActivity {
  std::int32_t day;
  double active_kcal;
  double active_goal_kcal;
  double exercise_min;
  double exercise_goal_min;
  double stand_hours;
  double stand_goal_hours;
};

/// Interns device names ("Itay’s Apple Watch") to 16-bit ids.
class SourceTable {
 public:
  std::uint16_t intern(std::string_view raw);
  [[nodiscard]] const std::string& name(std::uint16_t id) const { return names_.at(id); }
  [[nodiscard]] std::size_t size() const noexcept { return names_.size(); }

 private:
  struct Hash {
    using is_transparent = void;
    std::size_t operator()(std::string_view s) const noexcept { return std::hash<std::string_view>{}(s); }
  };
  std::unordered_map<std::string, std::uint16_t, Hash, std::equal_to<>> ids_;  // keyed by raw attribute text
  std::vector<std::string> names_;                                             // decoded
};

struct CollectorStats {
  std::uint64_t records_read = 0;
  std::uint64_t records_skipped = 0;  // types we don't track (dietary, audio exposure, ...)
  std::uint64_t warnings = 0;         // unparseable values or dates
  std::uint64_t workouts_seen = 0;    // <Workout> elements, converted or not
  std::int64_t data_from_ms = std::numeric_limits<std::int64_t>::max();
  std::int64_t data_to_ms = std::numeric_limits<std::int64_t>::min();

  [[nodiscard]] bool has_range() const noexcept { return data_from_ms <= data_to_ms; }
};

class HealthExportCollector final : public XmlHandler {
 public:
  /// Pool block size for the hourly-bucket hash nodes (checked in the tests).
  static constexpr std::size_t kNodeBlockBytes = 64;

  HealthExportCollector();

  void on_open(const Element& element) override;
  void on_close(std::string_view name) override;

  /// Turns the open hourly buckets into samples. Call once, after parsing.
  void finish();

  [[nodiscard]] bool saw_health_data() const noexcept { return saw_root_; }
  [[nodiscard]] PoolStats pool_stats() const noexcept { return pool_.stats(); }
  /// Distinct (night, source) pairs, as the web importer counts nights.
  [[nodiscard]] std::size_t sleep_night_count() const;

  std::vector<MetricSample> samples;
  std::vector<SleepSegment> sleep;
  std::vector<WorkoutRecord> workouts;
  std::vector<DailyActivity> activity;
  SourceTable sources;
  CollectorStats stats;

  /// Owned key/value pairs in document order (element views don't outlive a callback).
  using Fields = std::vector<std::pair<std::string, std::string>>;

 private:
  /// A <Workout> whose closing tag hasn't been seen yet.
  struct OpenWorkout {
    Fields attrs;
    Fields meta;                                       // MetadataEntry key → value
    std::vector<std::pair<std::string, Fields>> stats;  // WorkoutStatistics type → attributes, first-seen order
    int depth = 0;
  };

  struct BucketKey {
    std::int64_t hour_start_ms;
    std::uint16_t source;
    MetricType type;
    bool operator==(const BucketKey&) const = default;
  };
  struct BucketKeyHash {
    std::size_t operator()(const BucketKey& k) const noexcept;
  };
  struct Bucket {
    double sum;
    double min;
    double max;
    std::uint32_t count;
    std::int16_t tz_min;
  };

  void on_record(const Element& e);
  void on_sleep(const Element& e);
  void on_activity_summary(const Element& e);
  void close_workout();
  void track(std::int64_t utc_ms) noexcept;

  PoolResource pool_;  // must outlive buckets_
  std::pmr::unordered_map<BucketKey, Bucket, BucketKeyHash> buckets_;
  std::optional<OpenWorkout> workout_;
  int depth_ = 0;  // elements currently open
  bool saw_root_ = false;
};

}  // namespace ezt
