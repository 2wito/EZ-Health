#include "wasm_api.h"

#include <algorithm>
#include <string>

#include "health_records.hpp"
#include "record_json.hpp"
#include "xml_parser.hpp"

struct EztSession {
  ezt::HealthExportCollector collector;
  ezt::IncrementalXmlParser parser{collector};
  std::string input;
  std::string output;
  bool finished = false;
};

namespace {

enum Kind : int { kSamples = 0, kSleep = 1, kWorkouts = 2, kActivity = 3 };

template <class Records, class Append>
void page(std::string& out, const Records& records, std::size_t offset, std::size_t limit, Append append) {
  out.assign("[");
  const std::size_t end = std::min(records.size(), offset + std::min(limit, records.size()));
  for (std::size_t i = offset; i < end; ++i) {
    if (i > offset) out += ',';
    append(out, records[i]);
  }
  out += ']';
}

}  // namespace

extern "C" {

EztSession* ezt_create(void) { return new EztSession(); }

void ezt_destroy(EztSession* s) { delete s; }

char* ezt_input(EztSession* s, size_t n) {
  if (s == nullptr) return nullptr;
  s->input.resize(n);
  return s->input.data();
}

int ezt_feed(EztSession* s, size_t n) {
  if (s == nullptr || s->finished || n > s->input.size()) return 2;
  return s->parser.feed(std::string_view(s->input.data(), n)) ? 0 : 1;
}

double ezt_records_read(const EztSession* s) {
  return s == nullptr ? 0 : static_cast<double>(s->collector.stats.records_read);
}

int ezt_finish(EztSession* s) {
  if (s == nullptr || s->finished) return 2;
  const bool ok = s->parser.finish();
  s->collector.finish();
  s->finished = true;
  s->input = std::string();  // give the chunk buffer back

  const ezt::CollectorStats& st = s->collector.stats;
  std::string& out = s->output;
  out.assign(R"({"recordsRead":)");
  ezt::append_json_int(out, static_cast<std::int64_t>(st.records_read));
  out += R"(,"recordsSkipped":)";
  ezt::append_json_int(out, static_cast<std::int64_t>(st.records_skipped));
  out += R"(,"warnings":)";
  ezt::append_json_int(out, static_cast<std::int64_t>(st.warnings + s->parser.stats().errors));
  out += R"(,"workoutsSeen":)";
  ezt::append_json_int(out, static_cast<std::int64_t>(st.workouts_seen));
  out += R"(,"dataFrom":)";
  if (st.has_range()) {
    ezt::append_iso_ms(out, st.data_from_ms);
    out += R"(,"dataTo":)";
    ezt::append_iso_ms(out, st.data_to_ms);
  } else {
    out += R"(null,"dataTo":null)";
  }
  out += '}';
  return ok ? 0 : 1;
}

size_t ezt_count(const EztSession* s, int kind) {
  if (s == nullptr || !s->finished) return 0;
  switch (kind) {
    case kSamples: return s->collector.samples.size();
    case kSleep: return s->collector.sleep.size();
    case kWorkouts: return s->collector.workouts.size();
    case kActivity: return s->collector.activity.size();
    default: return 0;
  }
}

int ezt_page(EztSession* s, int kind, size_t offset, size_t limit) {
  if (s == nullptr || !s->finished) return 2;
  const ezt::HealthExportCollector& c = s->collector;
  switch (kind) {
    case kSamples:
      page(s->output, c.samples, offset, limit,
           [&](std::string& out, const ezt::MetricSample& r) { ezt::append_sample_json(out, r, c.sources); });
      return 0;
    case kSleep:
      page(s->output, c.sleep, offset, limit,
           [&](std::string& out, const ezt::SleepSegment& r) { ezt::append_sleep_json(out, r, c.sources); });
      return 0;
    case kWorkouts:
      page(s->output, c.workouts, offset, limit,
           [&](std::string& out, const ezt::WorkoutRecord& r) { ezt::append_workout_json(out, r, c.sources); });
      return 0;
    case kActivity:
      page(s->output, c.activity, offset, limit,
           [](std::string& out, const ezt::DailyActivity& r) { ezt::append_activity_json(out, r); });
      return 0;
    default:
      return 2;
  }
}

const char* ezt_output(const EztSession* s) { return s == nullptr ? nullptr : s->output.data(); }

size_t ezt_output_size(const EztSession* s) { return s == nullptr ? 0 : s->output.size(); }

}  // extern "C"
