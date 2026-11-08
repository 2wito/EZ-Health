// Unit tests for the telemetry engine. No framework: each CHECK reports and
// counts failures, and the exit code is the number of failures (capped at 1).

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory_resource>
#include <set>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

#include "aggregator.hpp"
#include "health_records.hpp"
#include "memory_pool.hpp"
#include "output.hpp"
#include "record_json.hpp"
#include "wasm_api.h"
#include "xml_parser.hpp"

namespace {

int g_failures = 0;

#define CHECK(cond)                                                     \
  do {                                                                  \
    if (!(cond)) {                                                      \
      std::fprintf(stderr, "%s:%d: CHECK failed: %s\n", __FILE__, __LINE__, #cond); \
      ++g_failures;                                                     \
    }                                                                   \
  } while (0)

bool near(double a, double b, double eps = 1e-9) { return std::fabs(a - b) <= eps; }

using namespace ezt;

// ─── Memory pool ────────────────────────────────────────────────────────────

void test_pool_reuses_blocks() {
  FixedBlockPool pool(24, 4);
  CHECK(pool.block_size() % FixedBlockPool::alignment == 0);

  std::vector<void*> blocks;
  for (int i = 0; i < 10; ++i) blocks.push_back(pool.allocate());
  CHECK(pool.stats().chunks == 3);  // 4 + 4 + 2
  CHECK(std::set<void*>(blocks.begin(), blocks.end()).size() == blocks.size());
  for (void* b : blocks) CHECK(pool.owns(b));

  void* freed = blocks[5];
  pool.deallocate(freed);
  CHECK(pool.allocate() == freed);  // LIFO free list: O(1) reuse
  CHECK(pool.stats().blocks_in_use == 10);
  CHECK(pool.stats().peak_blocks_in_use == 10);

  for (void* b : blocks) pool.deallocate(b);
  CHECK(pool.stats().blocks_in_use == 0);
  CHECK(pool.stats().chunks == 3);  // memory is kept for reuse
  int dummy = 0;
  CHECK(!pool.owns(&dummy));
}

void test_pool_resource_routes_by_size() {
  PoolResource resource(64, 128);
  std::pmr::unordered_map<int, double> map(&resource);
  for (int i = 0; i < 1000; ++i) map[i] = i * 0.5;
  CHECK(map.at(999) == 499.5);
  const PoolStats s = resource.stats();
  CHECK(s.allocations >= 1000);          // one node per element, from the pool
  CHECK(s.upstream_allocations > 0);     // the bucket array is too big for a block
  CHECK(s.upstream_allocations < 50);
  map.clear();
  CHECK(resource.stats().blocks_in_use == 0);
}

// ─── XML parser ─────────────────────────────────────────────────────────────

struct Recorder : XmlHandler {
  std::vector<std::string> events;
  void on_open(const Element& e) override {
    std::string s = "+" + std::string(e.name);
    for (const Attribute& a : e.attributes) s += " " + std::string(a.name) + "=" + std::string(a.value);
    events.push_back(s);
  }
  void on_close(std::string_view name) override { events.push_back("-" + std::string(name)); }
};

void test_parser_handles_export_constructs() {
  const std::string_view xml = R"(<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE HealthData [
<!-- comment with <tags> and > inside -->
<!ELEMENT HealthData (Record)*>
<!ATTLIST Record type CDATA #REQUIRED>
]>
<HealthData locale="en">
 <!-- <Record type="commented-out"/> -->
 <Record type="A" value='1' note="a > b"/>
 <Record   type = "B"  value="2" >
  <MetadataEntry key="k" value="v"/>
 </Record>
 <![CDATA[ <Record type="in-cdata"/> ]]>
</HealthData>)";

  Recorder r;
  const ParseStats stats = XmlStreamParser{}.parse(xml, r);
  const std::vector<std::string> expected{
      "+HealthData locale=en", "+Record type=A value=1 note=a > b", "-Record", "+Record type=B value=2",
      "+MetadataEntry key=k value=v", "-MetadataEntry", "-Record", "-HealthData"};
  CHECK(r.events == expected);
  CHECK(stats.errors == 0);
  CHECK(stats.elements == 4);
}

void test_parser_recovers_from_garbage() {
  Recorder r;
  const ParseStats stats = XmlStreamParser{}.parse(R"(<HealthData><Record type="A" broken <Record type="B"/></HealthData>)", r);
  CHECK(stats.errors >= 1);
  CHECK(!stats.aborted);
  CHECK(r.events.back() == "-HealthData");

  Recorder r2;
  ParseOptions strict;
  strict.max_errors = 0;
  const ParseStats s2 = XmlStreamParser{strict}.parse("<a b c d>", r2);
  CHECK(s2.aborted);
}

void test_incremental_matches_whole_document() {
  const std::string xml = R"(<?xml version="1.0"?>
<!DOCTYPE HealthData [ <!ATTLIST Record type CDATA #REQUIRED> <!-- ] > --> ]>
<HealthData locale="en"><!-- c --><![CDATA[ <x/> ]]>
 <Record type="A" note="a > b" value='1'/><Record type="B"
   value="2"><MetadataEntry key="k" value="v"/></Record>
 <broken <Record type="C"/>
</HealthData>)";

  Recorder whole;
  const ParseStats expected = XmlStreamParser{}.parse(xml, whole);

  // Every split point, and a three-way split, must give the same events and counts.
  for (std::size_t cut = 0; cut <= xml.size(); ++cut) {
    Recorder r;
    IncrementalXmlParser p(r);
    p.feed(std::string_view(xml).substr(0, cut));
    p.feed(std::string_view(xml).substr(cut));
    p.finish();
    CHECK(r.events == whole.events);
    CHECK(p.stats().errors == expected.errors);
    CHECK(p.stats().elements == expected.elements);
  }
  Recorder bytewise;
  IncrementalXmlParser p(bytewise);
  for (const char c : xml) p.feed(std::string_view(&c, 1));
  p.finish();
  CHECK(bytewise.events == whole.events);

  // A construct that never ends doesn't make every later chunk rescan it.
  Recorder r;
  IncrementalXmlParser endless(r);
  endless.feed("<HealthData><!-- ");
  const std::string filler(1 << 20, 'x');
  for (int i = 0; i < 12; ++i) endless.feed(filler);
  endless.finish();
  CHECK(endless.stats().errors >= 1);
}

void test_decode_entities() {
  CHECK(decode_entities("Itay&apos;s &amp; &lt;Watch&gt;") == "Itay's & <Watch>");
  CHECK(decode_entities("caf&#233; &#x2019;") == "caf\xC3\xA9 \xE2\x80\x99");
  CHECK(decode_entities("R&D &unknown; &") == "R&D &unknown; &");
  CHECK(decode_entities("plain") == "plain");
}

// ─── Dates ──────────────────────────────────────────────────────────────────

void test_dates() {
  const auto t = parse_health_date("2026-10-24 08:05:00 +0300");
  CHECK(t.has_value());
  CHECK(t->tz_min == 180);
  std::string iso;
  append_iso_ms(iso, t->utc_ms);
  CHECK(iso == "\"2026-10-24T05:05:00.000Z\"");

  const LocalParts lp = local_parts(*t);
  CHECK(lp.hour == 8);
  CHECK(lp.weekday == 6);  // Saturday
  CHECK(lp.day == days_from_civil(2026, 10, 24));

  CHECK(parse_health_date("2026-10-24T05:05:00Z")->utc_ms == t->utc_ms);
  CHECK(parse_health_date("2026-10-24 10:35:00 +05:30")->tz_min == 330);
  CHECK(parse_health_date("2026-10-24")->tz_min == 0);
  CHECK(!parse_health_date("2026-13-01 00:00:00 +0000"));
  CHECK(!parse_health_date("yesterday"));
  CHECK(!parse_health_date(""));

  // Before 1970 and leap days round-trip.
  for (const std::int32_t d : {-719468, -1, 0, 11016, 20385, 2932896}) {
    const CivilDate c = civil_from_days(d);
    CHECK(days_from_civil(c.year, c.month, c.day) == d);
  }
  CHECK(days_from_civil(2024, 2, 29) + 1 == days_from_civil(2024, 3, 1));

  // A segment ending at 23:45 belongs to the next night; one ending at 07:00 to that day.
  CHECK(sleep_night(*parse_health_date("2026-10-23 23:45:00 +0300")) == days_from_civil(2026, 10, 24));
  CHECK(sleep_night(*parse_health_date("2026-10-24 07:00:00 +0300")) == days_from_civil(2026, 10, 24));
}

// ─── Collector ──────────────────────────────────────────────────────────────

void test_collector_buckets_by_local_hour() {
  const std::string_view xml = R"(<HealthData>
 <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="W" startDate="2026-10-24 08:05:00 +0300" endDate="x" value="60"/>
 <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="W" startDate="2026-10-24 08:55:00 +0300" endDate="x" value="80"/>
 <Record type="HKQuantityTypeIdentifierActiveEnergyBurned" sourceName="W" unit="kJ" startDate="2026-10-24 08:10:00 +0300" endDate="x" value="41.84"/>
 <Record type="HKQuantityTypeIdentifierActiveEnergyBurned" sourceName="W" unit="kJ" startDate="2026-10-24 08:20:00 +0300" endDate="x" value="41.84"/>
 <Record type="HKQuantityTypeIdentifierOxygenSaturation" sourceName="W" startDate="2026-10-24 08:20:00 +0300" endDate="x" value="0.97"/>
 <Record type="HKQuantityTypeIdentifierDietaryWater" sourceName="W" startDate="2026-10-24 08:20:00 +0300" endDate="x" value="1"/>
 <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="W" startDate="bad" endDate="x" value="1"/>
</HealthData>)";
  HealthExportCollector c;
  XmlStreamParser{}.parse(xml, c);
  c.finish();

  CHECK(c.saw_health_data());
  CHECK(c.stats.records_read == 7);
  CHECK(c.stats.records_skipped == 1);
  CHECK(c.stats.warnings == 1);
  CHECK(c.samples.size() == 3);
  for (const MetricSample& s : c.samples) {
    std::string iso;
    append_iso_ms(iso, s.utc_ms);
    CHECK(iso == "\"2026-10-24T05:00:00.000Z\"");
    if (s.type == MetricType::HeartRate) {
      CHECK(std::isnan(s.qty));
      CHECK(s.min == 60 && s.max == 80 && s.avg == 70);
    } else if (s.type == MetricType::ActiveEnergy) {
      CHECK(near(s.qty, 20.0));  // 2 × 41.84 kJ, summed
    } else {
      CHECK(s.type == MetricType::BloodOxygen);
      CHECK(near(s.qty, 97.0));
    }
  }
  CHECK(c.pool_stats().upstream_allocations < c.pool_stats().allocations + 5);
}

void test_workouts() {
  const std::string_view xml = R"(<HealthData>
 <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="30" durationUnit="min" sourceName="W"
   startDate="2026-10-24 07:00:00 +0300" endDate="2026-10-24 07:30:00 +0300">
  <MetadataEntry key="HKIndoorWorkout" value="1"/>
  <MetadataEntry key="HKElevationAscended" value="4500 cm"/>
  <MetadataEntry key="HKAverageMETs" value="9.5 kcal/hr·kg"/>
  <WorkoutEvent type="x"><MetadataEntry key="HKIndoorWorkout" value="0"/></WorkoutEvent>
  <WorkoutStatistics type="HKQuantityTypeIdentifierDistanceWalkingRunning" sum="5" unit="km"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierActiveEnergyBurned" sum="1255.2" unit="kJ"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" average="150" minimum="120" maximum="171" unit="count/min"/>
 </Workout>
 <Workout workoutActivityType="HKWorkoutActivityTypeTraditionalStrengthTraining" sourceName="W"
   startDate="2026-10-25 18:00:00 +0300" endDate="2026-10-25 18:45:30 +0300" totalEnergyBurned="200" totalEnergyBurnedUnit="Cal"/>
 <Workout workoutActivityType="HKWorkoutActivityTypeYoga" startDate="bad" endDate="bad"/>
</HealthData>)";
  HealthExportCollector c;
  XmlStreamParser{}.parse(xml, c);
  c.finish();

  CHECK(c.stats.workouts_seen == 3);
  CHECK(c.stats.warnings == 1);
  CHECK(c.workouts.size() == 2);
  if (c.workouts.size() != 2) return;

  const WorkoutRecord& run = c.workouts[0];
  CHECK(run.name == "Indoor Run");  // the nested MetadataEntry belongs to WorkoutEvent, not the workout
  CHECK(run.duration_sec == 1800);
  CHECK(near(run.distance_km, 5));
  CHECK(near(run.avg_speed_kmh, 10));  // derived: no RunningSpeed statistic
  CHECK(near(run.active_kcal, 300));
  CHECK(near(run.elevation_up_m, 45));
  CHECK(near(run.intensity_met, 9.5));
  CHECK(run.avg_hr == 150 && run.min_hr == 120 && run.max_hr == 171);
  CHECK(std::isnan(run.step_count));
  CHECK(run.local_day == days_from_civil(2026, 10, 24));

  const WorkoutRecord& lift = c.workouts[1];
  CHECK(lift.name == "Traditional Strength Training");
  CHECK(lift.duration_sec == 2730);  // from the dates
  CHECK(near(lift.active_kcal, 200));
  CHECK(std::isnan(lift.distance_km) && std::isnan(lift.avg_speed_kmh));

  std::string json;
  append_workout_json(json, lift, c.sources);
  CHECK(json.find(R"("name":"Traditional Strength Training")") != std::string::npos);
  CHECK(json.find(R"("hrSeries":null})") != std::string::npos);
}

// ─── C API (the WebAssembly surface) ────────────────────────────────────────

std::string read_file(const char* path) {
  std::string data;
  if (std::FILE* f = std::fopen(path, "rb")) {
    char buf[65536];
    std::size_t n;
    while ((n = std::fread(buf, 1, sizeof buf, f)) > 0) data.append(buf, n);
    std::fclose(f);
  }
  return data;
}

void test_c_api_matches_whole_parse(const char* sample_path) {
  const std::string xml = read_file(sample_path);
  CHECK(!xml.empty());
  if (xml.empty()) return;

  HealthExportCollector whole;
  XmlStreamParser{}.parse(xml, whole);
  whole.finish();

  EztSession* s = ezt_create();
  // Uneven chunks, so tags and multi-byte characters straddle chunk borders.
  std::size_t pos = 0;
  for (std::size_t step = 1; pos < xml.size(); step = step * 7 % 997 + 1) {
    const std::size_t n = std::min(step, xml.size() - pos);
    std::memcpy(ezt_input(s, n), xml.data() + pos, n);
    CHECK(ezt_feed(s, n) == 0);
    pos += n;
  }
  CHECK(ezt_finish(s) == 0);
  const std::string stats(ezt_output(s), ezt_output_size(s));
  CHECK(stats.find(R"("recordsRead":)" + std::to_string(whole.stats.records_read)) != std::string::npos);
  CHECK(ezt_records_read(s) == static_cast<double>(whole.stats.records_read));

  // Paged in twos: the pages joined must equal the whole-document records.
  const auto paged = [&](int kind) {
    std::string joined;
    const std::size_t count = ezt_count(s, kind);
    for (std::size_t off = 0; off < count; off += 2) {
      CHECK(ezt_page(s, kind, off, 2) == 0);
      std::string page(ezt_output(s), ezt_output_size(s));
      if (!joined.empty()) joined += ',';
      joined += page.substr(1, page.size() - 2);
    }
    return joined;
  };
  const auto expected = [](const auto& records, auto append) {
    std::string joined;
    for (const auto& r : records) {
      if (!joined.empty()) joined += ',';
      append(joined, r);
    }
    return joined;
  };
  CHECK(paged(0) == expected(whole.samples, [&](std::string& o, const MetricSample& r) { append_sample_json(o, r, whole.sources); }));
  CHECK(paged(1) == expected(whole.sleep, [&](std::string& o, const SleepSegment& r) { append_sleep_json(o, r, whole.sources); }));
  CHECK(paged(2) == expected(whole.workouts, [&](std::string& o, const WorkoutRecord& r) { append_workout_json(o, r, whole.sources); }));
  CHECK(paged(3) == expected(whole.activity, [](std::string& o, const DailyActivity& r) { append_activity_json(o, r); }));
  CHECK(ezt_count(s, 2) == 2);
  CHECK(ezt_page(s, 9, 0, 1) == 2);
  CHECK(ezt_feed(s, 0) == 2);  // finished sessions refuse more input
  ezt_destroy(s);
}

// ─── Aggregator ─────────────────────────────────────────────────────────────

MetricSample hrv_on(std::int32_t day, double value) {
  return MetricSample{day * kMsPerDay + 12 * kMsPerHour, value, kNull, kNull, kNull, 0, MetricType::HeartRateVariability, 0};
}

void test_rolling_series() {
  std::vector<MetricSample> samples;
  for (std::int32_t d = 0; d < 10; ++d) samples.push_back(hrv_on(d, d + 1));  // 1..10
  samples.push_back(hrv_on(9, 20));                                         // day 9: mean 15
  for (const unsigned threads : {1u, 4u}) {
    AggregatorOptions o;
    o.window_days = 3;
    o.threads = threads;
    const SeriesReport r = daily_series(samples, MetricType::HeartRateVariability, o);
    CHECK(r.days.size() == 10);
    CHECK(r.days[0].rolling == 1);
    CHECK(near(r.days[2].rolling, 2));                  // (1+2+3)/3
    CHECK(near(r.days[9].mean, 15));
    CHECK(near(r.days[9].rolling, (8 + 9 + 15) / 3.0));
    CHECK(r.days[9].readings == 2);
    CHECK(near(r.latest_rolling, r.days[9].rolling));
    CHECK(r.baseline_days == 7);                        // days 0..6
    CHECK(near(r.baseline_mean, 4));
  }
}

SleepSegment seg(SleepStage stage, int start_min, int end_min, std::uint16_t source, std::int32_t night = 100) {
  return SleepSegment{start_min * 60'000LL, end_min * 60'000LL, night, 0, stage, source};
}

void test_sleep_transitions() {
  const std::vector<SleepSegment> segments{
      // Source 0: the better-measured night.
      seg(SleepStage::InBed, 0, 480, 0),
      seg(SleepStage::Core, 0, 60, 0),
      seg(SleepStage::Deep, 60, 120, 0),
      seg(SleepStage::Core, 120, 180, 0),
      seg(SleepStage::Awake, 180, 190, 0),
      seg(SleepStage::Rem, 190, 250, 0),
      seg(SleepStage::Rem, 250, 260, 0),  // same stage again: not a transition
      // Source 1 measured less of the same night and is ignored.
      seg(SleepStage::Asleep, 0, 30, 1),
      seg(SleepStage::Awake, 30, 40, 1),
      // Another night.
      seg(SleepStage::Core, 2000, 2100, 0, 101),
      seg(SleepStage::Rem, 2100, 2160, 0, 101),
  };
  for (const unsigned threads : {1u, 3u}) {
    const SleepReport r = sleep_transitions(segments, threads);
    CHECK(r.nights.size() == 2);
    const NightReport& n = r.nights[0];
    CHECK(n.night == 100 && n.source == 0);
    CHECK(n.transitions == 4);  // core→deep→core→awake→rem
    CHECK(n.awakenings == 1);
    CHECK(near(n.asleep_hours(), 250.0 / 60));
    const auto at = [&](SleepStage a, SleepStage b) {
      return r.transitions[static_cast<std::size_t>(a)][static_cast<std::size_t>(b)];
    };
    CHECK(at(SleepStage::Core, SleepStage::Deep) == 1);
    CHECK(at(SleepStage::Core, SleepStage::Awake) == 1);
    CHECK(at(SleepStage::Core, SleepStage::Rem) == 1);  // night 101
    CHECK(r.total_transitions == 5);
    CHECK(r.total_awakenings == 1);
  }
}

// ─── Output ─────────────────────────────────────────────────────────────────

void test_json_primitives() {
  std::string s;
  append_json_string(s, "a\"b\\c\n\x01 ’");
  CHECK(s == "\"a\\\"b\\\\c\\n\\u0001 ’\"");
  s.clear();
  append_json_number(s, 62.0);
  s += ',';
  append_json_number(s, 0.1);
  s += ',';
  append_json_number(s, kNull);
  CHECK(s == "62,0.1,null");
  s.clear();
  append_iso_ms(s, -1);
  CHECK(s == "\"1969-12-31T23:59:59.999Z\"");
}

}  // namespace

int main(int argc, char** argv) {
  // The repo's sample export; build.sh passes its path.
  const char* sample = argc > 1 ? argv[1] : "../../../scripts/sample-export.xml";
  test_pool_reuses_blocks();
  test_pool_resource_routes_by_size();
  test_parser_handles_export_constructs();
  test_parser_recovers_from_garbage();
  test_incremental_matches_whole_document();
  test_decode_entities();
  test_dates();
  test_collector_buckets_by_local_hour();
  test_workouts();
  test_c_api_matches_whole_parse(sample);
  test_rolling_series();
  test_sleep_transitions();
  test_json_primitives();

  if (g_failures == 0) {
    std::puts("engine_tests: all checks passed");
    return 0;
  }
  std::fprintf(stderr, "engine_tests: %d check(s) failed\n", g_failures);
  return 1;
}
