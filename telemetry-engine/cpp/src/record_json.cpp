#include "record_json.hpp"

#include <charconv>
#include <cmath>

namespace ezt {

namespace {

void put_digits(std::string& out, std::int64_t value, int width) {
  char buf[24];
  int n = 0;
  // Through unsigned so INT64_MIN doesn't overflow.
  std::uint64_t v = value < 0 ? 0 - static_cast<std::uint64_t>(value) : static_cast<std::uint64_t>(value);
  do {
    buf[n++] = static_cast<char>('0' + v % 10);
    v /= 10;
  } while (v > 0);
  if (value < 0) out += '-';
  for (int i = n; i < width; ++i) out += '0';
  while (n > 0) out += buf[--n];
}

void append_civil(std::string& out, std::int32_t day) {
  const CivilDate c = civil_from_days(day);
  put_digits(out, c.year, 4);
  out += '-';
  put_digits(out, c.month, 2);
  out += '-';
  put_digits(out, c.day, 2);
}

}  // namespace

void append_json_string(std::string& out, std::string_view s) {
  static constexpr char kHex[] = "0123456789abcdef";
  out += '"';
  for (const char ch : s) {
    const auto c = static_cast<unsigned char>(ch);
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (c < 0x20) {
          out += "\\u00";
          out += kHex[c >> 4];
          out += kHex[c & 0xF];
        } else {
          out += ch;  // UTF-8 passes through
        }
    }
  }
  out += '"';
}

void append_json_number(std::string& out, double v) {
  if (!std::isfinite(v)) {
    out += "null";
    return;
  }
  char buf[32];
  const auto [ptr, ec] = std::to_chars(buf, buf + sizeof buf, v);  // shortest round-trip form
  out.append(buf, ec == std::errc{} ? static_cast<std::size_t>(ptr - buf) : 0);
}

void append_json_int(std::string& out, std::int64_t v) { put_digits(out, v, 1); }

void append_iso_ms(std::string& out, std::int64_t utc_ms) {
  const std::int64_t day = floor_div(utc_ms, kMsPerDay);
  std::int64_t rest = utc_ms - day * kMsPerDay;
  out += '"';
  append_civil(out, static_cast<std::int32_t>(day));
  out += 'T';
  put_digits(out, rest / kMsPerHour, 2);
  rest %= kMsPerHour;
  out += ':';
  put_digits(out, rest / 60'000, 2);
  rest %= 60'000;
  out += ':';
  put_digits(out, rest / 1000, 2);
  out += '.';
  put_digits(out, rest % 1000, 3);
  out += "Z\"";
}

void append_iso_day(std::string& out, std::int32_t day) {
  out += '"';
  append_civil(out, day);
  out += "T00:00:00.000Z\"";
}

void append_date(std::string& out, std::int32_t day) {
  out += '"';
  append_civil(out, day);
  out += '"';
}

void append_sample_json(std::string& out, const MetricSample& s, const SourceTable& sources) {
  const LocalParts lp = local_parts({s.utc_ms, s.tz_min});
  out += R"({"type":")";
  out += metric_name(s.type);
  out += R"(","timestamp":)";
  append_iso_ms(out, s.utc_ms);
  out += R"(,"tzOffsetMin":)";
  append_json_int(out, s.tz_min);
  out += R"(,"localDate":)";
  append_iso_day(out, lp.day);
  out += R"(,"localHour":)";
  append_json_int(out, lp.hour);
  out += R"(,"localWeekday":)";
  append_json_int(out, lp.weekday);
  out += R"(,"qty":)";
  append_json_number(out, s.qty);
  out += R"(,"min":)";
  append_json_number(out, s.min);
  out += R"(,"avg":)";
  append_json_number(out, s.avg);
  out += R"(,"max":)";
  append_json_number(out, s.max);
  out += R"(,"unit":")";
  out += metric_unit(s.type);
  out += R"(","source":)";
  append_json_string(out, sources.name(s.source));
  out += '}';
}

void append_sleep_json(std::string& out, const SleepSegment& s, const SourceTable& sources) {
  out += R"({"stage":")";
  out += stage_name(s.stage);
  out += R"(","start":)";
  append_iso_ms(out, s.start_ms);
  out += R"(,"end":)";
  append_iso_ms(out, s.end_ms);
  out += R"(,"tzOffsetMin":)";
  append_json_int(out, s.tz_min);
  out += R"(,"source":)";
  append_json_string(out, sources.name(s.source));
  out += R"(,"night":)";
  append_iso_day(out, s.night);
  out += '}';
}

void append_workout_json(std::string& out, const WorkoutRecord& w, const SourceTable& sources) {
  out += R"({"externalId":null,"name":)";
  append_json_string(out, w.name);
  out += R"(,"source":)";
  append_json_string(out, sources.name(w.source));
  out += R"(,"start":)";
  append_iso_ms(out, w.start_ms);
  out += R"(,"end":)";
  append_iso_ms(out, w.end_ms);
  out += R"(,"tzOffsetMin":)";
  append_json_int(out, w.tz_min);
  out += R"(,"localDate":)";
  append_iso_day(out, w.local_day);
  out += R"(,"durationSec":)";
  append_json_int(out, w.duration_sec);
  const std::pair<std::string_view, double> numbers[] = {
      {"activeEnergyKcal", w.active_kcal}, {"distanceKm", w.distance_km},    {"avgSpeedKmh", w.avg_speed_kmh},
      {"elevationUpM", w.elevation_up_m},  {"stepCount", w.step_count},      {"intensityMet", w.intensity_met},
      {"avgHr", w.avg_hr},                 {"minHr", w.min_hr},              {"maxHr", w.max_hr},
  };
  for (const auto& [key, value] : numbers) {
    out += R"(,")";
    out += key;
    out += R"(":)";
    append_json_number(out, value);
  }
  out += R"(,"hrSeries":null})";
}

void append_activity_json(std::string& out, const DailyActivity& a) {
  out += R"({"date":)";
  append_iso_day(out, a.day);
  const std::pair<std::string_view, double> numbers[] = {
      {"activeEnergyKcal", a.active_kcal}, {"activeEnergyGoal", a.active_goal_kcal},
      {"exerciseMin", a.exercise_min},     {"exerciseGoalMin", a.exercise_goal_min},
      {"standHours", a.stand_hours},       {"standGoalHours", a.stand_goal_hours},
  };
  for (const auto& [key, value] : numbers) {
    out += R"(,")";
    out += key;
    out += R"(":)";
    append_json_number(out, value);
  }
  out += '}';
}

}  // namespace ezt
