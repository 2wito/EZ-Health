#include "health_records.hpp"

#include <algorithm>
#include <array>
#include <charconv>
#include <cmath>
#include <set>
#include <span>
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

// ─── Workout helpers ─────────────────────────────────────────────────────────
// Same tables and rules as src/lib/health-export/normalize.ts and buildWorkout()
// in src/lib/apple-health/xml-parser.ts.

struct UnitFactor {
  std::string_view unit;  // lower case
  double factor;
};
using UnitTable = std::span<const UnitFactor>;

constexpr std::array<UnitFactor, 3> kEnergyToKcalData{{{"kcal", 1}, {"cal", 1}, {"kj", 1 / 4.184}}};
constexpr std::array<UnitFactor, 5> kDistanceToKmData{
    {{"km", 1}, {"m", 0.001}, {"mi", 1.609344}, {"yd", 0.0009144}, {"ft", 0.0003048}}};
constexpr std::array<UnitFactor, 5> kSpeedToKmhData{
    {{"km/hr", 1}, {"km/h", 1}, {"mi/hr", 1.609344}, {"mph", 1.609344}, {"m/s", 3.6}}};
constexpr std::array<UnitFactor, 5> kLengthToMData{{{"m", 1}, {"cm", 0.01}, {"ft", 0.3048}, {"km", 1000}, {"mi", 1609.344}}};
constexpr UnitTable kEnergyToKcal{kEnergyToKcalData};
constexpr UnitTable kDistanceToKm{kDistanceToKmData};
constexpr UnitTable kSpeedToKmh{kSpeedToKmhData};
constexpr UnitTable kLengthToM{kLengthToMData};

/// qty × the unit's factor (1 when the unit is missing or unknown); NaN when qty is missing.
double convert(std::optional<double> qty, std::optional<std::string_view> unit, UnitTable table) {
  if (!qty) return kNull;
  if (unit) {
    std::string lower(*unit);
    for (char& c : lower) c = (c >= 'A' && c <= 'Z') ? static_cast<char>(c - 'A' + 'a') : c;
    for (const UnitFactor& u : table) {
      if (u.unit == lower) return *qty * u.factor;
    }
  }
  return *qty;
}

/// An attribute as a finite number, if it is present and is one.
std::optional<double> num(std::optional<std::string_view> raw) noexcept {
  return raw ? parse_number(*raw) : std::nullopt;
}

double finite_or_null(double v) noexcept { return std::isfinite(v) ? v : kNull; }
double finite_or_null(std::optional<double> v) noexcept { return v ? finite_or_null(*v) : kNull; }

/// "4500 cm" / "9.5 kcal/hr·kg" → {4500, "cm"} (the leading number and the trimmed rest).
std::optional<std::pair<double, std::string_view>> quantity(std::optional<std::string_view> raw) {
  if (!raw) return std::nullopt;
  std::string_view s = *raw;
  const auto space = [](char c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v'; };
  while (!s.empty() && space(s.front())) s.remove_prefix(1);
  std::size_t n = 0;
  if (n < s.size() && s[n] == '-') ++n;
  const std::size_t digits_start = n;
  while (n < s.size() && ((s[n] >= '0' && s[n] <= '9') || s[n] == '.')) ++n;
  if (n == digits_start) return std::nullopt;
  double value = 0;
  const auto [ptr, ec] = std::from_chars(s.data(), s.data() + n, value);
  if (ec != std::errc{} || ptr != s.data() + n || !std::isfinite(value)) return std::nullopt;
  std::string_view rest = s.substr(n);
  while (!rest.empty() && space(rest.front())) rest.remove_prefix(1);
  while (!rest.empty() && space(rest.back())) rest.remove_suffix(1);
  return std::pair{value, rest};
}

/// HKWorkoutActivityType suffix → the name the Health app shows.
std::string workout_name(std::string_view activity_type, bool indoor) {
  constexpr std::string_view prefix = "HKWorkoutActivityType";
  std::string_view key = activity_type.starts_with(prefix) ? activity_type.substr(prefix.size()) : activity_type;

  if (key == "Running") return indoor ? "Indoor Run" : "Outdoor Run";
  if (key == "Walking") return indoor ? "Indoor Walk" : "Outdoor Walk";
  if (key == "Cycling") return indoor ? "Indoor Cycle" : "Outdoor Cycle";
  if (key == "HighIntensityIntervalTraining") return "HIIT";
  if (key == "MixedCardio") return "Mixed Cardio";
  if (key == "StairClimbing") return "Stair Stepper";
  if (key.empty()) return "Workout";

  // "TraditionalStrengthTraining" → "Traditional Strength Training"
  std::string out;
  out.reserve(key.size() + 8);
  for (std::size_t i = 0; i < key.size(); ++i) {
    out += key[i];
    const bool lower = key[i] >= 'a' && key[i] <= 'z';
    if (lower && i + 1 < key.size() && key[i + 1] >= 'A' && key[i + 1] <= 'Z') out += ' ';
  }
  return out;
}

using Fields = HealthExportCollector::Fields;

std::optional<std::string_view> get_field(const Fields& fields, std::string_view key) noexcept {
  for (const auto& [k, v] : fields) {
    if (k == key) return std::string_view(v);
  }
  return std::nullopt;
}

void set_field(Fields& fields, std::string_view key, std::string_view value) {
  for (auto& [k, v] : fields) {
    if (k == key) {
      v = value;
      return;
    }
  }
  fields.emplace_back(std::string(key), std::string(value));
}

Fields copy_fields(const Element& e) {
  Fields fields;
  fields.reserve(e.attributes.size());
  for (const Attribute& a : e.attributes) set_field(fields, a.name, a.value);
  return fields;
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
  const int depth = depth_++;
  const std::string_view name = e.name;
  const bool in_workout = workout_ && depth == workout_->depth + 1;  // direct child of the open <Workout>

  if (name == "Record") {
    ++stats.records_read;
    on_record(e);
  } else if (name == "MetadataEntry") {
    if (in_workout && !e.attr("key").empty()) set_field(workout_->meta, e.attr("key"), e.attr("value"));
  } else if (name == "WorkoutStatistics") {
    if (in_workout && !e.attr("type").empty()) {
      Fields fields = copy_fields(e);
      auto& list = workout_->stats;
      const auto it = std::find_if(list.begin(), list.end(), [&](const auto& s) { return s.first == e.attr("type"); });
      if (it != list.end()) {
        it->second = std::move(fields);  // a repeat replaces the values but keeps its place
      } else {
        list.emplace_back(std::string(e.attr("type")), std::move(fields));
      }
    }
  } else if (name == "Workout") {
    ++stats.workouts_seen;
    workout_.emplace();
    workout_->attrs = copy_fields(e);
    workout_->depth = depth;
  } else if (name == "ActivitySummary") {
    on_activity_summary(e);
  } else if (name == "HealthData") {
    saw_root_ = true;
  }
}

void HealthExportCollector::on_close(std::string_view name) {
  if (depth_ > 0) --depth_;
  if (name == "Workout" && workout_) close_workout();
}

void HealthExportCollector::close_workout() {
  const OpenWorkout w = std::move(*workout_);
  workout_.reset();

  const auto attr = [&](std::string_view k) { return get_field(w.attrs, k); };
  const auto stat = [&](std::string_view type) -> const Fields* {
    for (const auto& [t, fields] : w.stats) {
      if (t == type) return &fields;
    }
    return nullptr;
  };

  const std::optional<Timestamp> start = parse_health_date(attr("startDate").value_or(""));
  const std::optional<Timestamp> end = parse_health_date(attr("endDate").value_or(""));
  if (!start || !end) {
    ++stats.warnings;
    return;
  }

  // Duration: the attribute (in its unit), else end - start. Math.round semantics.
  double duration;
  if (const std::optional<double> d = num(attr("duration"))) {
    const std::string_view unit = attr("durationUnit").value_or("");
    duration = *d * (unit == "s" ? 1 : unit == "hr" ? 3600 : 60);
  } else {
    duration = static_cast<double>(end->utc_ms - start->utc_ms) / 1000;
  }
  const auto duration_sec = static_cast<std::int64_t>(std::floor(duration + 0.5));

  // iOS 16+ puts totals in <WorkoutStatistics>; older exports use attributes.
  double kcal;
  if (const Fields* s = stat("HKQuantityTypeIdentifierActiveEnergyBurned")) {
    kcal = convert(num(get_field(*s, "sum")), get_field(*s, "unit"), kEnergyToKcal);
  } else {
    kcal = convert(num(attr("totalEnergyBurned")), attr("totalEnergyBurnedUnit"), kEnergyToKcal);
  }

  const Fields* distance_stat = nullptr;
  for (const auto& [t, fields] : w.stats) {
    if (t.starts_with("HKQuantityTypeIdentifierDistance")) {
      distance_stat = &fields;
      break;
    }
  }
  const double distance_km =
      distance_stat ? convert(num(get_field(*distance_stat, "sum")), get_field(*distance_stat, "unit"), kDistanceToKm)
                    : convert(num(attr("totalDistance")), attr("totalDistanceUnit"), kDistanceToKm);

  double speed = kNull;
  if (const Fields* s = stat("HKQuantityTypeIdentifierRunningSpeed")) {
    speed = convert(num(get_field(*s, "average")), get_field(*s, "unit"), kSpeedToKmh);
  }
  // `distanceKm && durationSec > 0`: zero and missing distances are both falsy.
  if (std::isnan(speed) && !std::isnan(distance_km) && distance_km != 0 && duration_sec > 0) {
    speed = distance_km / (static_cast<double>(duration_sec) / 3600);
  }

  const Fields* hr = stat("HKQuantityTypeIdentifierHeartRate");
  const Fields* steps = stat("HKQuantityTypeIdentifierStepCount");
  const auto hr_value = [&](std::string_view k) { return hr ? finite_or_null(num(get_field(*hr, k))) : kNull; };
  const auto elevation = quantity(get_field(w.meta, "HKElevationAscended"));
  const auto mets = quantity(get_field(w.meta, "HKAverageMETs"));
  const std::optional<std::string_view> indoor = get_field(w.meta, "HKIndoorWorkout");

  WorkoutRecord record{
      workout_name(attr("workoutActivityType").value_or(""), indoor && *indoor == "1"),
      start->utc_ms,
      end->utc_ms,
      local_parts(*start).day,
      duration_sec,
      finite_or_null(kcal),
      finite_or_null(distance_km),
      finite_or_null(speed),
      elevation ? finite_or_null(convert(elevation->first, elevation->second, kLengthToM)) : kNull,
      steps ? finite_or_null(num(get_field(*steps, "sum"))) : kNull,
      mets ? mets->first : kNull,
      hr_value("average"),
      hr_value("minimum"),
      hr_value("maximum"),
      start->tz_min,
      sources.intern(attr("sourceName").value_or("")),
  };
  track(record.start_ms);
  workouts.push_back(std::move(record));
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
