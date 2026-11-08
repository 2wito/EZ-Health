#pragma once

// Multi-threaded aggregation over collected records.
//
//   - Daily series (HRV, resting heart rate): readings are averaged per local
//     day, then smoothed with a trailing window of calendar days (default 7).
//     A baseline (mean and SD of the days before that window) shows whether the
//     latest value is unusual.
//   - Sleep state transitions: for each night the best-measured source is kept
//     (most time asleep, as the dashboards do), its stage segments are walked in
//     order, and every change of stage is counted in a from → to matrix along
//     with awakenings (a sleep stage followed by AWAKE).
//
// Work is split into contiguous index ranges, one per thread. Each thread fills
// its own partial result and the partials are merged afterwards, so the hot
// loops take no locks.

#include <array>
#include <cstdint>
#include <span>
#include <vector>

#include "health_records.hpp"

namespace ezt {

struct AggregatorOptions {
  int window_days = 7;
  int baseline_days = 60;
  unsigned threads = 0;  // 0 = hardware concurrency
};

struct DailyValue {
  std::int32_t day;     // days since epoch, local
  double mean;          // average of that day's readings
  double rolling;       // trailing window_days average of daily means
  std::uint32_t readings;
};

struct SeriesReport {
  std::vector<DailyValue> days;  // ascending
  double latest = kNull;
  double latest_rolling = kNull;
  double baseline_mean = kNull;
  double baseline_sd = kNull;
  std::uint32_t baseline_days = 0;
};

inline constexpr std::size_t kStageCount = static_cast<std::size_t>(SleepStage::Count);
using TransitionMatrix = std::array<std::array<std::uint64_t, kStageCount>, kStageCount>;

struct NightReport {
  std::int32_t night = 0;
  std::uint16_t source = 0;
  std::array<double, kStageCount> hours{};  // per stage; IN_BED is ignored
  std::uint32_t transitions = 0;
  std::uint32_t awakenings = 0;

  [[nodiscard]] double asleep_hours() const noexcept;
};

struct SleepReport {
  std::vector<NightReport> nights;  // ascending
  TransitionMatrix transitions{};   // [from][to], indexed by SleepStage
  std::uint64_t total_transitions = 0;
  std::uint64_t total_awakenings = 0;
};

struct AggregateReport {
  SeriesReport hrv;
  SeriesReport resting_hr;
  SleepReport sleep;
  unsigned threads = 1;
  int window_days = 7;
};

[[nodiscard]] unsigned resolve_threads(unsigned requested) noexcept;

[[nodiscard]] SeriesReport daily_series(std::span<const MetricSample> samples, MetricType type,
                                        const AggregatorOptions& options);
[[nodiscard]] SleepReport sleep_transitions(std::span<const SleepSegment> segments, unsigned threads);
[[nodiscard]] AggregateReport aggregate(std::span<const MetricSample> samples, std::span<const SleepSegment> segments,
                                        const AggregatorOptions& options);

}  // namespace ezt
