#include "aggregator.hpp"

#include <algorithm>
#include <cmath>
#include <map>
#include <numeric>
#include <thread>
#include <tuple>
#include <unordered_map>

namespace ezt {

namespace {

/// Runs fn(begin, end, thread_index) over [0, n) split into contiguous ranges.
/// The calling thread takes the first range; the rest run on std::jthread,
/// which joins on scope exit.
template <class Fn>
void parallel_for(std::size_t n, unsigned threads, Fn&& fn) {
  if (n == 0) return;
  const std::size_t workers = std::clamp<std::size_t>(threads, 1, n);
  const std::size_t chunk = (n + workers - 1) / workers;
  std::vector<std::jthread> pool;
  pool.reserve(workers - 1);
  for (std::size_t t = 1; t < workers; ++t) {
    const std::size_t begin = t * chunk;
    if (begin >= n) break;
    pool.emplace_back([&fn, begin, end = std::min(n, begin + chunk), t] { fn(begin, end, t); });
  }
  fn(std::size_t{0}, std::min(n, chunk), std::size_t{0});
}

struct Acc {
  double sum = 0;
  std::uint32_t count = 0;
};

}  // namespace

unsigned resolve_threads(unsigned requested) noexcept {
  if (requested > 0) return requested;
  const unsigned hw = std::thread::hardware_concurrency();
  return hw == 0 ? 1 : hw;
}

double NightReport::asleep_hours() const noexcept {
  double total = 0;
  for (std::size_t s = 0; s < kStageCount; ++s) {
    if (is_asleep(static_cast<SleepStage>(s))) total += hours[s];
  }
  return total;
}

SeriesReport daily_series(std::span<const MetricSample> samples, MetricType type, const AggregatorOptions& options) {
  const unsigned threads = resolve_threads(options.threads);

  // 1. Per-thread daily sums, merged in day order.
  std::vector<std::unordered_map<std::int32_t, Acc>> partial(threads);
  parallel_for(samples.size(), threads, [&](std::size_t begin, std::size_t end, std::size_t t) {
    auto& days = partial[t];
    for (std::size_t i = begin; i < end; ++i) {
      const MetricSample& s = samples[i];
      if (s.type != type) continue;
      const double v = std::isnan(s.qty) ? s.avg : s.qty;
      if (std::isnan(v)) continue;
      Acc& acc = days[local_parts({s.utc_ms, s.tz_min}).day];
      acc.sum += v;
      ++acc.count;
    }
  });

  std::map<std::int32_t, Acc> merged;
  for (const auto& days : partial) {
    for (const auto& [day, acc] : days) {
      Acc& m = merged[day];
      m.sum += acc.sum;
      m.count += acc.count;
    }
  }

  SeriesReport report;
  report.days.reserve(merged.size());
  for (const auto& [day, acc] : merged) report.days.push_back({day, acc.sum / acc.count, kNull, acc.count});
  if (report.days.empty()) return report;

  // 2. Trailing window over calendar days (gaps shrink the window, they don't stretch it).
  const int window = std::max(1, options.window_days);
  double window_sum = 0;
  std::size_t tail = 0;
  for (DailyValue& dv : report.days) {
    window_sum += dv.mean;
    while (report.days[tail].day <= dv.day - window) window_sum -= report.days[tail++].mean;
    const std::size_t head = static_cast<std::size_t>(&dv - report.days.data());
    dv.rolling = window_sum / static_cast<double>(head - tail + 1);
  }

  // 3. Baseline: the baseline_days before the latest window.
  const DailyValue& last = report.days.back();
  report.latest = last.mean;
  report.latest_rolling = last.rolling;
  const std::int32_t baseline_end = last.day - window;  // inclusive
  const std::int32_t baseline_start = baseline_end - std::max(1, options.baseline_days) + 1;
  std::vector<double> base;
  for (const DailyValue& dv : report.days) {
    if (dv.day >= baseline_start && dv.day <= baseline_end) base.push_back(dv.mean);
  }
  report.baseline_days = static_cast<std::uint32_t>(base.size());
  if (base.size() >= 7) {
    const double mean = std::accumulate(base.begin(), base.end(), 0.0) / static_cast<double>(base.size());
    double sq = 0;
    for (const double v : base) sq += (v - mean) * (v - mean);
    report.baseline_mean = mean;
    report.baseline_sd = std::sqrt(sq / static_cast<double>(base.size() - 1));
  }
  return report;
}

SleepReport sleep_transitions(std::span<const SleepSegment> segments, unsigned threads) {
  SleepReport report;
  if (segments.empty()) return report;

  // 1. Order segments by (night, source, start) without moving them.
  std::vector<std::uint32_t> order(segments.size());
  std::iota(order.begin(), order.end(), 0u);
  std::sort(order.begin(), order.end(), [&](std::uint32_t a, std::uint32_t b) {
    const SleepSegment& x = segments[a];
    const SleepSegment& y = segments[b];
    return std::tie(x.night, x.source, x.start_ms) < std::tie(y.night, y.source, y.start_ms);
  });

  // 2. One [begin, end) range per (night, source); keep the best-measured source per night.
  struct Range {
    std::size_t begin, end;
    double asleep_ms;
  };
  std::vector<Range> best;
  for (std::size_t i = 0; i < order.size();) {
    const SleepSegment& first = segments[order[i]];
    std::size_t j = i;
    double asleep = 0;
    while (j < order.size() && segments[order[j]].night == first.night && segments[order[j]].source == first.source) {
      const SleepSegment& s = segments[order[j]];
      if (is_asleep(s.stage)) asleep += static_cast<double>(s.end_ms - s.start_ms);
      ++j;
    }
    if (!best.empty() && segments[order[best.back().begin]].night == first.night) {
      if (asleep > best.back().asleep_ms) best.back() = {i, j, asleep};
    } else {
      best.push_back({i, j, asleep});
    }
    i = j;
  }

  // 3. Walk each night's stages in parallel; each thread writes its own matrix.
  const unsigned workers = resolve_threads(threads);
  report.nights.resize(best.size());
  std::vector<TransitionMatrix> matrices(workers, TransitionMatrix{});
  parallel_for(best.size(), workers, [&](std::size_t begin, std::size_t end, std::size_t t) {
    TransitionMatrix& matrix = matrices[t];
    for (std::size_t n = begin; n < end; ++n) {
      NightReport& night = report.nights[n];
      const Range& r = best[n];
      night.night = segments[order[r.begin]].night;
      night.source = segments[order[r.begin]].source;

      bool has_prev = false;
      SleepStage prev = SleepStage::InBed;
      for (std::size_t k = r.begin; k < r.end; ++k) {
        const SleepSegment& s = segments[order[k]];
        if (s.stage == SleepStage::InBed) continue;  // overlaps the stages, not a state of its own
        night.hours[static_cast<std::size_t>(s.stage)] += static_cast<double>(s.end_ms - s.start_ms) / kMsPerHour;
        if (has_prev && s.stage != prev) {
          ++matrix[static_cast<std::size_t>(prev)][static_cast<std::size_t>(s.stage)];
          ++night.transitions;
          if (s.stage == SleepStage::Awake && is_asleep(prev)) ++night.awakenings;
        }
        prev = s.stage;
        has_prev = true;
      }
    }
  });

  for (const TransitionMatrix& m : matrices) {
    for (std::size_t from = 0; from < kStageCount; ++from) {
      for (std::size_t to = 0; to < kStageCount; ++to) report.transitions[from][to] += m[from][to];
    }
  }
  for (const NightReport& n : report.nights) {
    report.total_transitions += n.transitions;
    report.total_awakenings += n.awakenings;
  }
  return report;
}

AggregateReport aggregate(std::span<const MetricSample> samples, std::span<const SleepSegment> segments,
                          const AggregatorOptions& options) {
  AggregateReport report;
  report.threads = resolve_threads(options.threads);
  report.window_days = options.window_days;
  report.hrv = daily_series(samples, MetricType::HeartRateVariability, options);
  report.resting_hr = daily_series(samples, MetricType::RestingHeartRate, options);
  report.sleep = sleep_transitions(segments, report.threads);
  return report;
}

}  // namespace ezt
