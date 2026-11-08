// Unit tests for the telemetry engine. No framework: each CHECK reports and
// counts failures, and the exit code is the number of failures (capped at 1).

#include <cmath>
#include <cstdio>
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

int main() {
  test_pool_reuses_blocks();
  test_pool_resource_routes_by_size();
  test_parser_handles_export_constructs();
  test_parser_recovers_from_garbage();
  test_decode_entities();
  test_dates();
  test_collector_buckets_by_local_hour();
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
