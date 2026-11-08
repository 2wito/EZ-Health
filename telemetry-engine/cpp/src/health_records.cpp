#include "health_records.hpp"

#include <algorithm>
#include <array>
#include <charconv>
#include <set>
#include <stdexcept>
#include <utility>

namespace ezt {

// ─── Names ──────────────────────────────────────────────────────────────────

namespace {

struct MetricInfo {
  std::string_view name;
  std::string_view unit;
};

constexpr std::array<MetricInfo, static_cast<std::size_t>(MetricType::Count)> kMetrics{{
    {"HEART_RATE", "bpm"},
    {"RESTING_HEART_RATE", "bpm"},
    {"WALKING_HEART_RATE_AVG", "bpm"},
    {"HEART_RATE_VARIABILITY", "ms"},
    {"RESPIRATORY_RATE", "breaths/min"},
    {"ACTIVE_ENERGY", "kcal"},
    {"BASAL_ENERGY", "kcal"},
    {"STEP_COUNT", "count"},
    {"EXERCISE_TIME", "min"},
    {"VO2_MAX", "ml/kg/min"},
    {"BLOOD_OXYGEN", "%"},
}};

constexpr std::array<std::string_view, static_cast<std::size_t>(SleepStage::Count)> kStages{
    "IN_BED", "AWAKE", "ASLEEP", "CORE", "DEEP", "REM"};

enum class Aggregation : std::uint8_t { Sample, Stats, Sum };

struct RecordSpec {
  std::string_view hk_type;
  MetricType type;
  Aggregation agg;
  bool energy;
  double scale;
};

// Most frequent types first: the lookup is a linear scan.
constexpr std::array<RecordSpec, 11> kRecordSpecs{{
    {"HKQuantityTypeIdentifierHeartRate", MetricType::HeartRate, Aggregation::Stats, false, 1},
    {"HKQuantityTypeIdentifierActiveEnergyBurned", MetricType::ActiveEnergy, Aggregation::Sum, true, 1},
    {"HKQuantityTypeIdentifierBasalEnergyBurned", MetricType::BasalEnergy, Aggregation::Sum, true, 1},
    {"HKQuantityTypeIdentifierStepCount", MetricType::StepCount, Aggregation::Sum, false, 1},
    {"HKQuantityTypeIdentifierRespiratoryRate", MetricType::RespiratoryRate, Aggregation::Stats, false, 1},
    {"HKQuantityTypeIdentifierOxygenSaturation", MetricType::BloodOxygen, Aggregation::Stats, false, 100},
    {"HKQuantityTypeIdentifierAppleExerciseTime", MetricType::ExerciseTime, Aggregation::Sum, false, 1},
    {"HKQuantityTypeIdentifierHeartRateVariabilitySDNN", MetricType::HeartRateVariability, Aggregation::Sample, false, 1},
    {"HKQuantityTypeIdentifierRestingHeartRate", MetricType::RestingHeartRate, Aggregation::Sample, false, 1},
    {"HKQuantityTypeIdentifierWalkingHeartRateAverage", MetricType::WalkingHeartRateAvg, Aggregation::Sample, false, 1},
    {"HKQuantityTypeIdentifierVO2Max", MetricType::Vo2Max, Aggregation::Sample, false, 1},
}};

struct SleepValue {
  std::string_view hk_value;
  SleepStage stage;
};

constexpr std::array<SleepValue, 7> kSleepValues{{
    {"HKCategoryValueSleepAnalysisAsleepCore", SleepStage::Core},
    {"HKCategoryValueSleepAnalysisAsleepDeep", SleepStage::Deep},
    {"HKCategoryValueSleepAnalysisAsleepREM", SleepStage::Rem},
    {"HKCategoryValueSleepAnalysisAwake", SleepStage::Awake},
    {"HKCategoryValueSleepAnalysisInBed", SleepStage::InBed},
    {"HKCategoryValueSleepAnalysisAsleep", SleepStage::Asleep},
    {"HKCategoryValueSleepAnalysisAsleepUnspecified", SleepStage::Asleep},
}};

const RecordSpec* find_spec(std::string_view hk_type) noexcept {
  for (const RecordSpec& spec : kRecordSpecs) {
    if (spec.hk_type == hk_type) return &spec;
  }
  return nullptr;
}

/// Hourly buckets of these metrics hold a total; the others an average.
constexpr bool is_hourly_total(MetricType t) noexcept {
  for (const RecordSpec& spec : kRecordSpecs) {
    if (spec.type == t) return spec.agg == Aggregation::Sum;
  }
  return false;
}

std::optional<SleepStage> find_stage(std::string_view value) noexcept {
  for (const SleepValue& v : kSleepValues) {
    if (v.hk_value == value) return v.stage;
  }
  return std::nullopt;
}

bool iequals(std::string_view a, std::string_view b) noexcept {
  return a.size() == b.size() && std::equal(a.begin(), a.end(), b.begin(), [](char x, char y) {
           const auto lower = [](char c) { return c >= 'A' && c <= 'Z' ? static_cast<char>(c - 'A' + 'a') : c; };
           return lower(x) == lower(y);
         });
}

/// Multiplier to kcal for an energy unit ("Cal", "kcal", "kJ"); 1 when unknown.
double energy_factor(std::string_view unit) noexcept {
  if (iequals(unit, "kj")) return 1.0 / 4.184;
  return 1.0;
}

/// Finite number, or nullopt. Accepts surrounding spaces and a leading '+'.
std::optional<double> parse_number(std::string_view s) noexcept {
  while (!s.empty() && s.front() == ' ') s.remove_prefix(1);
  while (!s.empty() && s.back() == ' ') s.remove_suffix(1);
  if (!s.empty() && s.front() == '+') s.remove_prefix(1);
  if (s.empty()) return std::nullopt;
  double v = 0;
  const auto [ptr, ec] = std::from_chars(s.data(), s.data() + s.size(), v);
  if (ec != std::errc{} || ptr != s.data() + s.size() || !std::isfinite(v)) return std::nullopt;
  return v;
}

bool read_digits(std::string_view s, std::size_t pos, std::size_t count, int& out) noexcept {
  if (pos + count > s.size()) return false;
  int v = 0;
  for (std::size_t i = pos; i < pos + count; ++i) {
    const char c = s[i];
    if (c < '0' || c > '9') return false;
    v = v * 10 + (c - '0');
  }
  out = v;
  return true;
}

}  // namespace

std::string_view metric_name(MetricType t) noexcept { return kMetrics[static_cast<std::size_t>(t)].name; }
std::string_view metric_unit(MetricType t) noexcept { return kMetrics[static_cast<std::size_t>(t)].unit; }
std::string_view stage_name(SleepStage s) noexcept { return kStages[static_cast<std::size_t>(s)]; }

// ─── Time ───────────────────────────────────────────────────────────────────

// Howard Hinnant's days_from_civil / civil_from_days (proleptic Gregorian).
std::int32_t days_from_civil(std::int32_t y, std::uint32_t m, std::uint32_t d) noexcept {
  y -= m <= 2 ? 1 : 0;
  const std::int32_t era = (y >= 0 ? y : y - 399) / 400;
  const auto yoe = static_cast<std::uint32_t>(y - era * 400);
  const std::uint32_t doy = (153 * (m > 2 ? m - 3 : m + 9) + 2) / 5 + d - 1;
  const std::uint32_t doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097 + static_cast<std::int32_t>(doe) - 719468;
}

CivilDate civil_from_days(std::int32_t days) noexcept {
  const std::int32_t z = days + 719468;
  const std::int32_t era = (z >= 0 ? z : z - 146096) / 146097;
  const auto doe = static_cast<std::uint32_t>(z - era * 146097);
  const std::uint32_t yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  const std::int32_t y = static_cast<std::int32_t>(yoe) + era * 400;
  const std::uint32_t doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  const std::uint32_t mp = (5 * doy + 2) / 153;
  const std::uint32_t d = doy - (153 * mp + 2) / 5 + 1;
  const std::uint32_t m = mp < 10 ? mp + 3 : mp - 9;
  return {y + (m <= 2 ? 1 : 0), m, d};
}

std::optional<Timestamp> parse_health_date(std::string_view s) noexcept {
  while (!s.empty() && s.front() == ' ') s.remove_prefix(1);
  while (!s.empty() && s.back() == ' ') s.remove_suffix(1);

  int year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0, millis = 0;
  if (!read_digits(s, 0, 4, year) || s.size() < 10 || s[4] != '-' || !read_digits(s, 5, 2, month) || s[7] != '-' ||
      !read_digits(s, 8, 2, day)) {
    return std::nullopt;
  }

  std::size_t pos = 10;
  int tz = 0;
  if (pos < s.size()) {
    if ((s[pos] != ' ' && s[pos] != 'T') || !read_digits(s, pos + 1, 2, hour) || pos + 3 >= s.size() ||
        s[pos + 3] != ':' || !read_digits(s, pos + 4, 2, minute)) {
      return std::nullopt;
    }
    pos += 6;
    if (pos < s.size() && s[pos] == ':') {
      if (!read_digits(s, pos + 1, 2, second)) return std::nullopt;
      pos += 3;
    }
    if (pos < s.size() && s[pos] == '.') {  // fractional seconds: keep milliseconds
      ++pos;
      int scale = 100;
      while (pos < s.size() && s[pos] >= '0' && s[pos] <= '9') {
        millis += (s[pos] - '0') * scale;
        scale /= 10;
        ++pos;
      }
    }
    while (pos < s.size() && s[pos] == ' ') ++pos;
    if (pos < s.size()) {
      if (s[pos] == 'Z') {
        ++pos;
      } else if (s[pos] == '+' || s[pos] == '-') {
        const int sign = s[pos] == '-' ? -1 : 1;
        int tz_h = 0, tz_m = 0;
        if (!read_digits(s, pos + 1, 2, tz_h)) return std::nullopt;
        pos += 3;
        if (pos < s.size() && s[pos] == ':') ++pos;
        if (!read_digits(s, pos, 2, tz_m)) return std::nullopt;
        pos += 2;
        tz = sign * (tz_h * 60 + tz_m);
      }
      if (pos != s.size()) return std::nullopt;
    }
  }

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 60 || tz < -14 * 60 ||
      tz > 14 * 60) {
    return std::nullopt;
  }

  const std::int64_t days =
      days_from_civil(year, static_cast<std::uint32_t>(month), static_cast<std::uint32_t>(day));
  const std::int64_t local_ms = ((days * 24 + hour) * 60 + minute) * 60'000 + std::int64_t{second} * 1000 + millis;
  return Timestamp{local_ms - std::int64_t{tz} * 60'000, static_cast<std::int16_t>(tz)};
}

LocalParts local_parts(Timestamp t) noexcept {
  const std::int64_t local_ms = t.utc_ms + std::int64_t{t.tz_min} * 60'000;
  const std::int64_t day = floor_div(local_ms, kMsPerDay);
  const std::int64_t ms_of_day = local_ms - day * kMsPerDay;
  const std::int64_t weekday = ((day % 7) + 7 + 4) % 7;  // 1970-01-01 was a Thursday
  return {static_cast<std::int32_t>(day), static_cast<std::uint8_t>(ms_of_day / kMsPerHour),
          static_cast<std::uint8_t>(weekday)};
}

std::int32_t sleep_night(Timestamp end) noexcept {
  return local_parts({end.utc_ms + 6 * kMsPerHour, end.tz_min}).day;
}

// ─── SourceTable ────────────────────────────────────────────────────────────

std::uint16_t SourceTable::intern(std::string_view raw) {
  if (const auto it = ids_.find(raw); it != ids_.end()) return it->second;
  if (names_.size() > std::numeric_limits<std::uint16_t>::max()) {
    throw std::length_error("more than 65536 distinct data sources");
  }
  const auto id = static_cast<std::uint16_t>(names_.size());
  names_.push_back(decode_entities(raw));
  ids_.emplace(std::string(raw), id);
  return id;
}

// ─── Collector ──────────────────────────────────────────────────────────────

std::size_t HealthExportCollector::BucketKeyHash::operator()(const BucketKey& k) const noexcept {
  // splitmix64 finaliser over the packed key.
  std::uint64_t x = static_cast<std::uint64_t>(k.hour_start_ms) ^
                    (static_cast<std::uint64_t>(k.source) << 48) ^ (static_cast<std::uint64_t>(k.type) << 40);
  x ^= x >> 30;
  x *= 0xbf58476d1ce4e5b9ULL;
  x ^= x >> 27;
  x *= 0x94d049bb133111ebULL;
  x ^= x >> 31;
  return static_cast<std::size_t>(x);
}

HealthExportCollector::HealthExportCollector() : pool_(kNodeBlockBytes, 8192), buckets_(&pool_) {}

void HealthExportCollector::on_open(const Element& e) {
  const std::string_view name = e.name;
  if (name == "Record") {
    ++stats.records_read;
    on_record(e);
  } else if (name == "ActivitySummary") {
    on_activity_summary(e);
  } else if (name == "Workout") {
    // Not converted yet, but part of the export's date range (as in the web importer).
    ++stats.workouts_seen;
    if (const auto start = parse_health_date(e.attr("startDate"))) track(start->utc_ms);
  } else if (name == "HealthData") {
    saw_root_ = true;
  }
}

void HealthExportCollector::track(std::int64_t utc_ms) noexcept {
  stats.data_from_ms = std::min(stats.data_from_ms, utc_ms);
  stats.data_to_ms = std::max(stats.data_to_ms, utc_ms);
}

void HealthExportCollector::on_record(const Element& e) {
  const std::string_view hk_type = e.attr("type");
  if (hk_type == "HKCategoryTypeIdentifierSleepAnalysis") return on_sleep(e);

  const RecordSpec* spec = find_spec(hk_type);
  if (spec == nullptr) {
    ++stats.records_skipped;
    return;
  }

  const std::optional<Timestamp> when = parse_health_date(e.attr("startDate"));
  std::optional<double> value = parse_number(e.attr("value"));
  if (!when || !value) {
    ++stats.warnings;
    return;
  }
  double v = *value * spec->scale;
  if (spec->energy) v *= energy_factor(e.attr("unit"));
  track(when->utc_ms);

  const std::uint16_t source = sources.intern(e.attr("sourceName"));
  if (spec->agg == Aggregation::Sample) {
    samples.push_back(MetricSample{when->utc_ms, v, kNull, kNull, kNull, when->tz_min, spec->type, source});
    return;
  }

  // Bucket on the local hour (works for half-hour offsets too).
  const std::int64_t offset_ms = std::int64_t{when->tz_min} * 60'000;
  const std::int64_t hour_start = floor_div(when->utc_ms + offset_ms, kMsPerHour) * kMsPerHour - offset_ms;
  const auto [it, inserted] =
      buckets_.try_emplace(BucketKey{hour_start, source, spec->type}, Bucket{v, v, v, 1, when->tz_min});
  if (!inserted) {
    Bucket& b = it->second;
    b.sum += v;
    ++b.count;
    b.min = std::min(b.min, v);
    b.max = std::max(b.max, v);
  }
}

void HealthExportCollector::on_sleep(const Element& e) {
  const std::optional<SleepStage> stage = find_stage(e.attr("value"));
  const std::optional<Timestamp> start = parse_health_date(e.attr("startDate"));
  const std::optional<Timestamp> end = parse_health_date(e.attr("endDate"));
  if (!stage || !start || !end || end->utc_ms <= start->utc_ms) {
    ++stats.warnings;
    return;
  }
  track(start->utc_ms);
  sleep.push_back(SleepSegment{start->utc_ms, end->utc_ms, sleep_night(*end), end->tz_min, *stage,
                               sources.intern(e.attr("sourceName"))});
}

void HealthExportCollector::on_activity_summary(const Element& e) {
  const std::optional<Timestamp> day = parse_health_date(e.attr("dateComponents"));
  if (!day) return;
  const auto num = [&](std::string_view key) { return parse_number(e.attr(key)).value_or(kNull); };

  const double energy = num("activeEnergyBurned");
  const double exercise = num("appleExerciseTime");
  // Apple writes empty rows for days before you had a watch.
  const auto present = [](double v) { return !std::isnan(v) && v != 0; };
  if (!present(energy) && !present(exercise)) return;

  const double kcal = energy_factor(e.attr("activeEnergyBurnedUnit"));
  activity.push_back(DailyActivity{local_parts(*day).day, energy * kcal, num("activeEnergyBurnedGoal") * kcal, exercise,
                                   num("appleExerciseTimeGoal"), num("appleStandHours"), num("appleStandHoursGoal")});
}

void HealthExportCollector::finish() {
  samples.reserve(samples.size() + buckets_.size());
  for (const auto& [key, b] : buckets_) {
    const double avg = b.sum / b.count;
    if (key.type == MetricType::HeartRate) {
      // Heart rate keeps the min/avg/max shape the webhook uses.
      samples.push_back(MetricSample{key.hour_start_ms, kNull, b.min, avg, b.max, b.tz_min, key.type, key.source});
    } else {
      const double qty = is_hourly_total(key.type) ? b.sum : avg;
      samples.push_back(MetricSample{key.hour_start_ms, qty, kNull, kNull, kNull, b.tz_min, key.type, key.source});
    }
  }
  buckets_.clear();
}

std::size_t HealthExportCollector::sleep_night_count() const {
  std::set<std::pair<std::int32_t, std::uint16_t>> nights;
  for (const SleepSegment& s : sleep) nights.emplace(s.night, s.source);
  return nights.size();
}

}  // namespace ezt
